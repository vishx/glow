// The Glow Studio admin page (/admin) talks to this function. Every request must carry the owner's
// admin key (the ADMIN_KEY secret) in the x-admin-key header; nothing else can reach it.
// POST { action, ...args }. Needs migrations 009 and 010. Every change is written to admin_audit.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const KEY = Deno.env.get("ADMIN_KEY") ?? "";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "x-admin-key, content-type, apikey, authorization",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" } });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Store prices, for the revenue estimate only (RevenueCat has the real numbers).
const WEEKLY = 4.99, YEARLY = 49.99;

async function same(a: string, b: string) {
  // Compare hashes so the time taken says nothing about the key.
  const h = async (s: string) => new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
  const [x, y] = await Promise.all([h(a), h(b)]);
  let d = 0;
  for (let i = 0; i < x.length; i++) d |= x[i] ^ y[i];
  return d === 0;
}
const must = <T>(r: { data: T; error: { message: string } | null }) => {
  if (r.error) throw new Error(r.error.message);
  return r.data;
};
const audit = (action: string, target: string | null, detail: Record<string, unknown> = {}) =>
  admin.from("admin_audit").insert({ action, target, detail }).then(({ error }) => { if (error) console.error("audit", error.message); });
const userId = (v: unknown) => {
  if (typeof v !== "string" || !UUID.test(v)) throw new HttpError("That isn't a Glow Studio account ID.");
  return v.toLowerCase();
};
// Takes a full account ID, or just its first characters (the app's Settings shows the first 8),
// as long as they match exactly one account.
async function findUser(v: unknown) {
  if (typeof v === "string" && UUID.test(v.trim())) return v.trim().toLowerCase();
  const q = typeof v === "string" ? v.trim().toLowerCase() : "";
  if (!/^[0-9a-f-]{6,35}$/.test(q)) throw new HttpError("Enter the account ID, or at least its first 6 characters (Settings in the app shows the first 8).");
  const rows = must(await admin.rpc("admin_users", { p_query: q, p_limit: 2 })) as { user_id: string }[];
  if (!rows.length) throw new HttpError(`No account starts with ${q}.`);
  if (rows.length > 1) throw new HttpError(`More than one account starts with ${q}. Type more of the ID.`);
  return rows[0].user_id;
}
const text = (v: unknown, max = 500) => (typeof v === "string" ? v.trim().slice(0, max) : "");
class HttpError extends Error {}

const actions: Record<string, (a: Record<string, unknown>) => Promise<unknown>> = {
  async overview(a) {
    const days = Math.min(90, Math.max(1, Number(a.days) || 14));
    // Old diagnostics aren't kept (privacy policy); also runs nightly through pg_cron.
    admin.rpc("purge_old_diagnostics").then(({ error }) => { if (error) console.error("purge", error.message); });
    const since30 = new Date(Date.now() - 30 * 864e5).toISOString();
    const [daily, tools, plans, heavy, support, errors, features, funnel, quality, subs, packs] = await Promise.all([
      admin.rpc("admin_daily", { p_days: days }),
      admin.rpc("admin_tools", { p_days: 7 }),
      admin.rpc("admin_plans").single(),
      admin.rpc("admin_heavy_users", { p_limit: 10 }),
      admin.from("support_requests").select("id", { count: "exact", head: true }).eq("status", "open"),
      admin.from("app_errors").select("id", { count: "exact", head: true }).gte("created_at", new Date(Date.now() - 864e5).toISOString()),
      admin.rpc("admin_features", { p_days: 7 }),
      admin.rpc("admin_funnel", { p_days: 7 }),
      admin.rpc("admin_ai_quality", { p_days: 7 }),
      admin.from("subscription_events").select("price_usd").gte("created_at", since30).neq("environment", "SANDBOX").not("price_usd", "is", null).limit(10000),
      admin.rpc("admin_credit_packs", { p_days: 30 }),
    ]);
    const p = must(plans) as { pro_weekly: number; pro_yearly: number };
    const monthly = p.pro_weekly * WEEKLY * 52 / 12 + p.pro_yearly * YEARLY / 12;
    const real = (must(subs) as { price_usd: number }[]).reduce((t, r) => t + Number(r.price_usd), 0);
    return {
      daily: must(daily), tools: must(tools), plans: p, heavy: must(heavy),
      openSupport: support.count ?? 0, errors24h: errors.count ?? 0,
      features: must(features), funnel: must(funnel), aiQuality: must(quality),
      // Before migration 012 there are no packs to report.
      creditPacks: packs.error ? [] : packs.data,
      revenue: {
        monthlyGross: Math.round(monthly * 100) / 100, last30: Math.round(real * 100) / 100,
        note: "Last 30 days is what RevenueCat reported (subscriptions, renewals and credit packs minus refunds, before store fees). The monthly figure is an estimate from active Pro plans at list price.",
      },
    };
  },

  // Each account also says whether it's a tester, so the Users and Features pages always agree.
  async users(a) {
    const rows = must(await admin.rpc("admin_users", { p_query: text(a.q, 36), p_limit: 50 })) as { user_id: string }[];
    const ids = rows.map((r) => r.user_id);
    const { data: t } = ids.length ? await admin.from("feature_testers").select("user_id, label").in("user_id", ids) : { data: [] };
    const testers = new Map((t ?? []).map((r: { user_id: string; label: string | null }) => [r.user_id, r.label ?? ""]));
    return rows.map((r) => ({ ...r, tester: testers.has(r.user_id), tester_label: testers.get(r.user_id) ?? null }));
  },

  async user(a) {
    const id = userId(a.user);
    const [auth, profile, allowance, usage, ads, support, events, errors, subs, tester] = await Promise.all([
      admin.auth.admin.getUserById(id),
      admin.from("profiles").select("*").eq("id", id).maybeSingle(),
      admin.rpc("ai_allowance", { p_user: id }).maybeSingle(),
      admin.from("ai_usage").select("id, mode, cost, created_at, refunded, from_bonus, prediction_id, ip, status, finished_at, error").eq("user_id", id).order("created_at", { ascending: false }).limit(50),
      admin.from("ad_rewards").select("id", { count: "exact", head: true }).eq("user_id", id),
      admin.from("support_requests").select("id, topic, message, status, created_at").eq("user_id", id).order("created_at", { ascending: false }).limit(10),
      admin.from("app_events").select("name, props, platform, created_at").eq("user_id", id).order("created_at", { ascending: false }).limit(30),
      admin.from("app_errors").select("message, build, platform, created_at").eq("user_id", id).order("created_at", { ascending: false }).limit(20),
      admin.from("subscription_events").select("type, product_id, period_type, store, environment, price_usd, cancel_reason, created_at").eq("user_id", id).order("created_at", { ascending: false }).limit(30),
      admin.from("feature_testers").select("label, created_at").eq("user_id", id).maybeSingle(),
    ]);
    if (!auth.data?.user) throw new HttpError("No account with that ID (it may have been deleted).");
    const u = auth.data.user;
    return {
      account: { id: u.id, created_at: u.created_at, last_seen: u.last_sign_in_at, anonymous: u.is_anonymous ?? !u.email },
      profile: profile.data, allowance: allowance.data, usage: must(usage), ads: ads.count ?? 0,
      support: support.data ?? [], events: events.data ?? [], errors: errors.data ?? [], subscriptions: subs.data ?? [],
      tester: tester.data ?? null,
    };
  },

  // Bonus credits: positive to give, negative to take back. Used after the plan's own credits.
  async grant(a) {
    const id = userId(a.user), n = Math.trunc(Number(a.credits));
    if (!n || Math.abs(n) > 500) throw new HttpError("Give between 1 and 500 credits (or take back with a minus).");
    must(await admin.from("profiles").upsert({ id }, { onConflict: "id", ignoreDuplicates: true }));
    const { data: p } = await admin.from("profiles").select("bonus_credits").eq("id", id).single();
    const next = Math.max(0, (p?.bonus_credits ?? 0) + n);
    must(await admin.from("profiles").update({ bonus_credits: next }).eq("id", id));
    await audit("grant", id, { credits: n, balance: next, reason: text(a.reason) });
    return { bonus_credits: next };
  },

  // Free Pro (for a goodwill gesture, a reviewer or a tester). It ends on its own; a real
  // store purchase later overwrites it through the RevenueCat webhook.
  async setPro(a) {
    const id = userId(a.user), days = Math.trunc(Number(a.days));
    must(await admin.from("profiles").upsert({ id }, { onConflict: "id", ignoreDuplicates: true }));
    if (days > 0) {
      if (days > 366) throw new HttpError("Give at most 366 days of Pro.");
      const until = new Date(Date.now() + days * 864e5).toISOString();
      must(await admin.from("profiles").update({ plan: "pro", plan_expires_at: until, plan_period: "weekly" }).eq("id", id));
      await audit("set_pro", id, { days, until, reason: text(a.reason) });
      return { plan: "pro", until };
    }
    must(await admin.from("profiles").update({ plan: "free", plan_expires_at: null }).eq("id", id));
    await audit("remove_pro", id, { reason: text(a.reason) });
    return { plan: "free" };
  },

  async block(a) {
    const id = userId(a.user), on = a.blocked !== false, reason = text(a.reason);
    must(await admin.from("profiles").upsert({ id }, { onConflict: "id", ignoreDuplicates: true }));
    must(await admin.from("profiles").update({ blocked_at: on ? new Date().toISOString() : null, blocked_reason: on ? reason || null : null }).eq("id", id));
    await audit(on ? "block_user" : "unblock_user", id, { reason });
    return { blocked: on };
  },

  async blockIp(a) {
    const ip = text(a.ip, 64), on = a.blocked !== false, reason = text(a.reason);
    if (!/^[0-9a-f:.]{3,64}$/i.test(ip)) throw new HttpError("That isn't an IP address.");
    if (on) must(await admin.from("blocked_ips").upsert({ ip, reason: reason || null }));
    else must(await admin.from("blocked_ips").delete().eq("ip", ip));
    await audit(on ? "block_ip" : "unblock_ip", ip, { reason });
    return { blocked: on };
  },

  async blockedIps() {
    return must(await admin.from("blocked_ips").select("*").order("created_at", { ascending: false }).limit(200));
  },

  // Gives back the credits of one AI run (the money side of refunds is Apple's or Google's).
  async refund(a) {
    const usage = Math.trunc(Number(a.usage));
    if (!usage) throw new HttpError("Pick an AI run to refund.");
    const { data: row } = await admin.from("ai_usage").select("user_id, mode, cost, refunded").eq("id", usage).maybeSingle();
    if (!row) throw new HttpError("No such AI run.");
    if (row.refunded) return { refunded: true, already: true };
    must(await admin.rpc("refund_ai_edit", { p_usage: usage }));
    await audit("refund_run", row.user_id, { usage, mode: row.mode, cost: row.cost, reason: text(a.reason) });
    return { refunded: true };
  },

  async support(a) {
    const status = a.status === "closed" ? "closed" : a.status === "all" ? null : "open";
    let q = admin.from("support_requests").select("*").order("created_at", { ascending: false }).limit(100);
    if (status) q = q.eq("status", status);
    return must(await q);
  },

  async supportUpdate(a) {
    const id = Math.trunc(Number(a.id));
    const status = a.status === "open" ? "open" : "closed";
    const patch: Record<string, unknown> = { status };
    if (typeof a.note === "string") patch.note = text(a.note, 2000) || null;
    must(await admin.from("support_requests").update(patch).eq("id", id));
    await audit("support_" + status, String(id), {});
    return { id, status };
  },

  async errors() {
    return must(await admin.from("app_errors").select("*").order("created_at", { ascending: false }).limit(100));
  },

  // Every RevenueCat event: purchases, renewals, trials, cancellations, refunds, billing issues.
  async subscriptions(a) {
    let q = admin.from("subscription_events").select("*").order("created_at", { ascending: false }).limit(200);
    if (a.type) q = q.eq("type", text(a.type, 40));
    return must(await q);
  },

  async deletions() {
    return must(await admin.from("account_deletions").select("*").order("created_at", { ascending: false }).limit(100));
  },

  async audit() {
    return must(await admin.from("admin_audit").select("*").order("created_at", { ascending: false }).limit(100));
  },

  // ---------- Feature switches (migration 013) ----------
  // Every switch the owner has set (a switch with no row follows the app's built-in default), the
  // tester accounts, and last week's AI runs per tool so a rollout can be checked before it grows.
  async features() {
    const [flags, testers, quality] = await Promise.all([
      admin.from("feature_flags").select("*").order("key"),
      admin.from("feature_testers").select("*").order("created_at"),
      admin.rpc("admin_ai_quality", { p_days: 7 }),
    ]);
    return { flags: must(flags), testers: must(testers), quality: quality.error ? [] : quality.data };
  },

  // { key, status: off|testers|rollout|on, percent, platforms, min_build, note } sets a switch;
  // { key, reset: true } removes it, so the app's built-in default applies again.
  async setFeature(a) {
    const key = text(a.key, 64);
    if (!/^[a-z0-9:_.-]{1,64}$/.test(key)) throw new HttpError("That isn't a feature switch.");
    const { data: before } = await admin.from("feature_flags").select("*").eq("key", key).maybeSingle();
    if (a.reset === true) {
      must(await admin.from("feature_flags").delete().eq("key", key));
      await audit("feature_reset", key, { before });
      return { key, reset: true };
    }
    const status = String(a.status);
    if (!["off", "testers", "rollout", "on"].includes(status)) throw new HttpError("Pick Off, Testers, Rollout or On.");
    const percent = status === "rollout" ? Math.trunc(Number(a.percent)) : status === "on" ? 100 : 0;
    if (status === "rollout" && !(percent >= 1 && percent <= 99)) throw new HttpError("A rollout is between 1% and 99% of people (use On for everyone).");
    const platforms = Array.isArray(a.platforms) && a.platforms.length ? [...new Set(a.platforms.map(String))] : null;
    if (platforms && !platforms.every((p) => ["web", "ios", "android"].includes(p))) throw new HttpError("Platforms are web, ios and android.");
    if (platforms && platforms.length === 3) platforms.length = 0;
    const minBuild = a.min_build == null || a.min_build === "" ? null : Math.trunc(Number(a.min_build));
    if (minBuild !== null && !(minBuild > 0 && minBuild < 2147483647)) throw new HttpError("The minimum build is a whole number, such as 202610311.");
    const row = { key, status, percent, platforms: platforms && platforms.length ? platforms : null, min_build: minBuild,
      note: text(a.note, 500) || null, updated_at: new Date().toISOString() };
    must(await admin.from("feature_flags").upsert(row));
    await audit("feature", key, { ...row, before });
    return row;
  },

  async addTester(a) {
    const id = await findUser(a.user), label = text(a.label, 80) || null;
    must(await admin.from("feature_testers").upsert({ user_id: id, label }));
    await audit("tester_add", id, { label });
    return { user_id: id, label };
  },

  async removeTester(a) {
    const id = userId(a.user);
    must(await admin.from("feature_testers").delete().eq("user_id", id));
    await audit("tester_remove", id, {});
    return { removed: true };
  },
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (KEY.length < 24) return json({ error: "The admin key isn't set up yet. Add an ADMIN_KEY secret (at least 24 characters) in Supabase." }, 503);
  if (!(await same(req.headers.get("x-admin-key") ?? "", KEY))) {
    await new Promise((r) => setTimeout(r, 800)); // slows down guessing
    return json({ error: "Wrong admin key." }, 401);
  }
  const body = await req.json().catch(() => ({}));
  const run = actions[body?.action];
  if (!run) return json({ error: "Unknown action" }, 400);
  try {
    return json(await run(body));
  } catch (e) {
    const msg = (e as Error).message;
    console.error("admin", body.action, msg);
    // Before migrations 009 and 010 the report functions and tables don't exist yet.
    if (/function .* does not exist|relation .* does not exist|column .* does not exist|schema cache/i.test(msg)) {
      if (/feature/i.test(body.action) || /tester/i.test(body.action)) return json({ error: "Run migration 013 (feature switches) in the Supabase SQL editor first.", detail: msg }, 409);
      return json({ error: "Run migration 010 (and 009 before it) in the Supabase SQL editor first.", detail: msg }, 409);
    }
    return json({ error: msg }, e instanceof HttpError ? 400 : 500);
  }
});
