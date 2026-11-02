// GET: the signed-in user's plan and how many AI edits they have left.
// POST { support }: a message from the app's Contact support form (needs migration 009; 016 saves name and email on the account).
// POST { supportList }: the person's own support conversations with every reply (marks replies seen).
// POST { supportReply: { id, message } }: the person answers back in a conversation (reopens it).
// POST { supportRate: { id, rating } }: thumbs up (1) or down (-1) on a closed conversation.
// (These three need migration 017.)
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
    if (body?.supportList) return json(await supportList(user.id));
    if (body?.supportReply) return supportFollowUp(user.id, body.supportReply);
    if (body?.supportRate) {
      const id = Math.trunc(Number(body.supportRate.id)), rating = Number(body.supportRate.rating) > 0 ? 1 : -1;
      const { error } = await admin.from("support_requests").update({ rating, rating_at: new Date().toISOString() }).eq("id", id).eq("user_id", user.id);
      return error ? json({ error: "Couldn't save that. Please try again." }, 500) : json({ rated: true });
    }
    const s = body?.support;
    const message = typeof s?.message === "string" ? s.message.trim().slice(0, 4000) : "";
    if (!message) return json({ error: "Write a message first." }, 400);
    const email = typeof s.email === "string" && /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/.test(s.email.trim()) ? s.email.trim() : null;
    const name = typeof s.name === "string" ? s.name.trim().replace(/\s+/g, " ").slice(0, 120) || null : null;
    const topic = ["billing", "ai", "bug", "privacy", "other"].includes(s.topic) ? s.topic : "other";
    // A handful a day is plenty for a real person; more is someone flooding the inbox.
    const { count } = await admin.from("support_requests").select("id", { count: "exact", head: true })
      .eq("user_id", user.id).gte("created_at", new Date(Date.now() - 864e5).toISOString());
    if ((count ?? 0) >= 5) return json({ error: "We've got your messages. We'll reply as soon as we can." }, 429);
    const ctx = s.context && typeof s.context === "object" ? s.context : {};
    const context = Object.fromEntries(Object.entries(ctx).slice(0, 12).map(([k, v]) => [String(k).slice(0, 40), String(v).slice(0, 200)]));
    let { error } = await admin.from("support_requests").insert({ user_id: user.id, email, name, topic, message, context });
    // Before migration 016 there's no name column: send the message without it.
    if (error && /name/i.test(error.message)) ({ error } = await admin.from("support_requests").insert({ user_id: user.id, email, topic, message, context }));
    if (error) return json({ error: "Couldn't send your message. Please try again." }, 500);
    // The name and email are saved on the account (migration 016), so the admin page shows who it
    // belongs to and can find it by name or email. The latest ones replace earlier ones.
    if (name || email) {
      await admin.from("profiles").upsert({ id: user.id }, { onConflict: "id", ignoreDuplicates: true });
      const patch: Record<string, unknown> = { contact_updated_at: new Date().toISOString() };
      if (name) patch.contact_name = name;
      if (email) patch.contact_email = email;
      const { error: cErr } = await admin.from("profiles").update(patch).eq("id", user.id);
      if (cErr) console.error("contact", cErr.message);
    }
    return json({ sent: true });
  }

  // Pricing v2 (migration 007): the database works out the balance, including the free plan's
  // one-time premium trial. Before 007 is applied this RPC doesn't exist and the old rules below apply.
  const v2 = await admin.rpc("ai_allowance", { p_user: user.id }).maybeSingle();
  if (!v2.error && v2.data) {
    const a = v2.data as { plan: string; period: string | null; used: number; quota: number; remaining: number; trial_left: number; ads_left: number; bonus?: number; blocked?: boolean };
    // select("*") so this keeps working before migration 015 adds plan_trial.
    const { data: pe } = await admin.from("profiles").select("*").eq("id", user.id).maybeSingle();
    return json({ plan: a.plan, period: a.period, expires: a.plan === "pro" ? pe?.plan_expires_at : null, used: a.used, quota: a.quota,
      inTrial: a.plan === "pro" && !!pe?.plan_trial,
      remaining: a.remaining, trialLeft: a.plan === "pro" ? undefined : a.trial_left, adsLeft: a.ads_left,
      bonus: a.bonus ?? 0, blocked: a.blocked ?? false, support: await supportUnread(user.id), v: 2 });
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

// ---------- Support conversations (migration 017) ----------
type Req = { id: number; topic: string; message: string; status: string; created_at: string; last_reply_at: string | null; user_seen_at: string | null; rating: number | null };
// How many conversations have a reply the person hasn't seen, and whether they have any at all
// (the app shows "Your messages" in Settings only then). Quietly nothing before migration 017.
async function supportUnread(uid: string) {
  const { data, error } = await admin.from("support_requests").select("last_reply_at, user_seen_at").eq("user_id", uid).limit(50);
  if (error || !data) return { any: false, unread: 0 };
  const unread = data.filter((r) => r.last_reply_at && (!r.user_seen_at || r.last_reply_at > r.user_seen_at)).length;
  return { any: data.length > 0, unread };
}

async function supportList(uid: string) {
  const { data: reqs, error } = await admin.from("support_requests")
    .select("id, topic, message, status, created_at, last_reply_at, user_seen_at, rating").eq("user_id", uid).order("created_at", { ascending: false }).limit(20);
  if (error) return { conversations: [], unavailable: true };
  const ids = (reqs as Req[]).map((r) => r.id);
  // Private notes are never sent to the app.
  const { data: msgs } = ids.length
    ? await admin.from("support_messages").select("request_id, author, body, created_at").in("request_id", ids).neq("author", "note").order("created_at")
    : { data: [] };
  const now = new Date().toISOString();
  const unseen = (reqs as Req[]).filter((r) => r.last_reply_at && (!r.user_seen_at || r.last_reply_at > r.user_seen_at)).map((r) => r.id);
  if (unseen.length) await admin.from("support_requests").update({ user_seen_at: now }).in("id", unseen);
  return {
    conversations: (reqs as Req[]).map((r) => ({
      id: r.id, topic: r.topic, status: r.status, created_at: r.created_at, rating: r.rating, unread: unseen.includes(r.id),
      messages: [{ from: "you", body: r.message, at: r.created_at },
        ...(msgs ?? []).filter((m) => m.request_id === r.id).map((m) => ({ from: m.author === "admin" ? "support" : "you", body: m.body, at: m.created_at }))],
    })),
  };
}

async function supportFollowUp(uid: string, b: { id?: unknown; message?: unknown }) {
  const id = Math.trunc(Number(b?.id));
  const message = typeof b?.message === "string" ? b.message.trim().slice(0, 4000) : "";
  if (!message) return json({ error: "Write a message first." }, 400);
  const { data: r } = await admin.from("support_requests").select("id").eq("id", id).eq("user_id", uid).maybeSingle();
  if (!r) return json({ error: "That conversation isn't on this account." }, 404);
  // Same limit as new messages: plenty for a real conversation, not enough to flood the inbox.
  const since = new Date(Date.now() - 864e5).toISOString();
  const { count } = await admin.from("support_messages").select("id", { count: "exact", head: true }).eq("request_id", id).eq("author", "customer").gte("created_at", since);
  if ((count ?? 0) >= 10) return json({ error: "We've got your messages. We'll reply as soon as we can." }, 429);
  const now = new Date().toISOString();
  const { error } = await admin.from("support_messages").insert({ request_id: id, author: "customer", body: message, via: "app" });
  if (error) return json({ error: "Couldn't send your message. Please try again." }, 500);
  await admin.from("support_requests").update({ status: "open", closed_at: null, last_customer_at: now, updated_at: now, rating: null, rating_at: null }).eq("id", id);
  return json(await supportList(uid));
}
