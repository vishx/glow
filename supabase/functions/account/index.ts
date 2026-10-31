// GET: the signed-in user's plan and how many AI edits they have left.
// POST { support }: a message from the app's Contact support form (needs migration 009).
// DELETE: permanently deletes the user's account and data (required by the App Store).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer /, "");
  const { data: { user } } = await admin.auth.getUser(jwt);
  if (!user) return json({ error: "Not signed in" }, 401);

  if (req.method === "DELETE") {
    // Count the deletion for the admin page, keeping nothing that points back to the person.
    const [{ data: p }, { count: runs }] = await Promise.all([
      admin.from("profiles").select("plan, plan_expires_at").eq("id", user.id).maybeSingle(),
      admin.from("ai_usage").select("id", { count: "exact", head: true }).eq("user_id", user.id),
    ]);
    // AI runs are kept for cost reports but lose the link to the person (migration 010).
    await admin.from("ai_usage").update({ ip: null }).eq("user_id", user.id);
    await admin.from("subscription_events").update({ user_id: null }).eq("user_id", user.id);
    const { error } = await admin.auth.admin.deleteUser(user.id);
    if (error) return json({ error: error.message }, 500);
    const pro = p?.plan === "pro" && (!p.plan_expires_at || new Date(p.plan_expires_at) > new Date());
    const { error: logError } = await admin.from("account_deletions").insert({
      plan: pro ? "pro" : "free", ai_runs: runs ?? 0,
      account_age_days: Math.floor((Date.now() - new Date(user.created_at).getTime()) / 864e5),
    });
    if (logError) console.error("deletion log", logError.message);
    return json({ deleted: true });
  }

  if (req.method === "POST") {
    const body = await req.json().catch(() => ({}));
    const s = body?.support;
    const message = typeof s?.message === "string" ? s.message.trim().slice(0, 4000) : "";
    if (!message) return json({ error: "Write a message first." }, 400);
    const email = typeof s.email === "string" && /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/.test(s.email.trim()) ? s.email.trim() : null;
    const topic = ["billing", "ai", "bug", "privacy", "other"].includes(s.topic) ? s.topic : "other";
    // A handful a day is plenty for a real person; more is someone flooding the inbox.
    const { count } = await admin.from("support_requests").select("id", { count: "exact", head: true })
      .eq("user_id", user.id).gte("created_at", new Date(Date.now() - 864e5).toISOString());
    if ((count ?? 0) >= 5) return json({ error: "We've got your messages. We'll reply as soon as we can." }, 429);
    const ctx = s.context && typeof s.context === "object" ? s.context : {};
    const context = Object.fromEntries(Object.entries(ctx).slice(0, 12).map(([k, v]) => [String(k).slice(0, 40), String(v).slice(0, 200)]));
    const { error } = await admin.from("support_requests").insert({ user_id: user.id, email, topic, message, context });
    if (error) return json({ error: "Couldn't send your message. Please try again." }, 500);
    return json({ sent: true });
  }

  // Pricing v2 (migration 007): the database works out the balance, including the free plan's
  // one-time premium trial. Before 007 is applied this RPC doesn't exist and the old rules below apply.
  const v2 = await admin.rpc("ai_allowance", { p_user: user.id }).maybeSingle();
  if (!v2.error && v2.data) {
    const a = v2.data as { plan: string; period: string | null; used: number; quota: number; remaining: number; trial_left: number; ads_left: number; bonus?: number; blocked?: boolean };
    const { data: pe } = await admin.from("profiles").select("plan_expires_at").eq("id", user.id).maybeSingle();
    return json({ plan: a.plan, period: a.period, expires: a.plan === "pro" ? pe?.plan_expires_at : null, used: a.used, quota: a.quota,
      remaining: a.remaining, trialLeft: a.plan === "pro" ? undefined : a.trial_left, adsLeft: a.ads_left,
      bonus: a.bonus ?? 0, blocked: a.blocked ?? false, v: 2 });
  }
  const { data: p } = await admin.from("profiles").select("plan, plan_expires_at").eq("id", user.id).maybeSingle();
  const pro = p?.plan === "pro" && !!p.plan_expires_at && new Date(p.plan_expires_at) > new Date();
  const since = pro ? new Date(Date.now() - 7 * 864e5) : new Date(new Date().toISOString().slice(0, 10));
  // Each AI edit uses its cost in credits (most 1, portrait styles 2).
  const rows = admin.from("ai_usage").select("cost").eq("user_id", user.id).eq("refunded", false).gte("created_at", since.toISOString());
  let { data: usage, error } = await rows;
  if (error) ({ data: usage } = await admin.from("ai_usage").select("id").eq("user_id", user.id).eq("refunded", false)
    .gte("created_at", since.toISOString())); // before migration 005
  const count = (usage ?? []).reduce((n: number, r: { cost?: number }) => n + (r.cost ?? 1), 0);
  // Free users get one extra edit per rewarded ad they finish, up to 3 a day.
  const { count: ads } = pro ? { count: 0 } : await admin.from("ad_rewards").select("id", { count: "exact", head: true })
    .eq("user_id", user.id).gte("created_at", since.toISOString());
  const bonus = Math.min(ads ?? 0, 3);
  const quota = pro ? 40 : 3 + bonus, used = count ?? 0;
  return json({ plan: pro ? "pro" : "free", expires: pro ? p?.plan_expires_at : null, used, quota, remaining: Math.max(0, quota - used), adsLeft: pro ? 0 : 3 - bonus });
});
