// GET: the signed-in user's plan and how many AI edits they have left.
// DELETE: permanently deletes the user's account and data (required by the App Store).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, DELETE, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer /, "");
  const { data: { user } } = await admin.auth.getUser(jwt);
  if (!user) return json({ error: "Not signed in" }, 401);

  if (req.method === "DELETE") {
    const { error } = await admin.auth.admin.deleteUser(user.id);
    if (error) return json({ error: error.message }, 500);
    return json({ deleted: true });
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
