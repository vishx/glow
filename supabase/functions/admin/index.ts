// The Glow Studio admin page (/admin) talks to this function. Every request must carry the owner's
// admin key (the ADMIN_KEY secret) in the x-admin-key header; nothing else can reach it.
// POST { action, ...args }. Needs migrations 009 and 010 (017 for the support inbox). Every change is written to admin_audit.
// Two-step login (migration 019): once turned on, every action also needs an x-admin-session token,
// which the page gets by sending a 6-digit authenticator code (or a recovery code) to twoStepLogin.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const KEY = Deno.env.get("ADMIN_KEY") ?? "";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "x-admin-key, x-admin-session, content-type, apikey, authorization",
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
// ---------- Reply emails (Resend) ----------
// Off until the owner adds the RESEND_API_KEY and SUPPORT_EMAIL_FROM secrets (e.g. "Glow Studio <support@yourdomain.com>",
// on a domain verified in Resend). SUPPORT_EMAIL_REPLY_TO is optional; without it the email asks the customer to answer in the app.
const RESEND_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const EMAIL_FROM = Deno.env.get("SUPPORT_EMAIL_FROM") ?? "";
const EMAIL_REPLY_TO = Deno.env.get("SUPPORT_EMAIL_REPLY_TO") ?? "";
const APP_URL = (Deno.env.get("PUBLIC_APP_URL") ?? "https://glow-photo-enhancer.vercel.app").replace(/\/$/, "");
const emailReady = () => !!(RESEND_KEY && EMAIL_FROM);
const esc = (t: string) => t.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
async function sendReplyEmail(to: string, name: string, id: number, body: string): Promise<{ ok: boolean; error: string }> {
  const open = `${APP_URL}/?messages`;
  const footer = EMAIL_REPLY_TO ? "You can reply to this email, or answer in the app: Settings, Your messages."
    : "Please don't reply to this email. To answer, open Glow Studio and go to Settings, Your messages.";
  const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;max-width:560px;margin:0 auto;color:#1a1a1a">
<p style="font-size:13px;color:#8a7a55;letter-spacing:.04em;text-transform:uppercase;margin:0 0 16px">Glow Studio support</p>
<div style="font-size:15px;line-height:1.55;white-space:pre-wrap">${esc(body)}</div>
<p style="margin:28px 0"><a href="${open}" style="background:#d4a64a;color:#111;text-decoration:none;padding:12px 20px;border-radius:999px;font-weight:600;font-size:14px">Open Your messages</a></p>
<p style="font-size:12px;color:#777;line-height:1.5">${footer}<br>Conversation #${id}</p></div>`;
  const textBody = `${body}\n\n${footer}\nOpen Your messages: ${open}\nConversation #${id}`;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: EMAIL_FROM, to: [name ? `${name.replace(/[<>",]/g, "")} <${to}>` : to], subject: `Re: your Glow Studio message (#${id})`,
        html, text: textBody, ...(EMAIL_REPLY_TO ? { reply_to: EMAIL_REPLY_TO } : {}) }),
    });
    if (res.ok) return { ok: true, error: "" };
    const err = await res.json().catch(() => ({}));
    console.error("resend", res.status, err);
    return { ok: false, error: String(err?.message || `Email service error ${res.status}`).slice(0, 200) };
  } catch (e) { return { ok: false, error: String(e).slice(0, 200) }; }
}

// ---------- Two-step login (migration 019) ----------
// TOTP (RFC 6238): 6 digits, 30 seconds, SHA-1, the standard every authenticator app reads.
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function b32enc(bytes: Uint8Array) {
  let bits = 0, val = 0, out = "";
  for (const b of bytes) { val = ((val << 8) | b) & 0xffff; bits += 8; while (bits >= 5) { out += B32[(val >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits > 0) out += B32[(val << (5 - bits)) & 31];
  return out;
}
function b32dec(s: string): Uint8Array<ArrayBuffer> {
  let bits = 0, val = 0; const out: number[] = [];
  for (const c of s.toUpperCase().replace(/[^A-Z2-7]/g, "")) { val = ((val << 5) | B32.indexOf(c)) & 0xffff; bits += 5; if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; } }
  return new Uint8Array(out);
}
async function hotp(secret: Uint8Array<ArrayBuffer>, counter: number) {
  const buf = new ArrayBuffer(8), v = new DataView(buf);
  v.setUint32(0, Math.floor(counter / 2 ** 32)); v.setUint32(4, counter >>> 0);
  const k = await crypto.subtle.importKey("raw", secret, { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const hm = new Uint8Array(await crypto.subtle.sign("HMAC", k, buf));
  const o = hm[hm.length - 1] & 15;
  const n = ((hm[o] & 127) << 24) | (hm[o + 1] << 16) | (hm[o + 2] << 8) | hm[o + 3];
  return String(n % 1_000_000).padStart(6, "0");
}
// The code now, or the one just before or after (phones' clocks drift a little).
async function totpOk(secretB32: string, code: string, at = Date.now()) {
  if (!/^\d{6}$/.test(code)) return false;
  const t = Math.floor(at / 30000), key = b32dec(secretB32);
  for (const d of [0, -1, 1]) if (await hotp(key, t + d) === code) return true;
  return false;
}
const sha = async (t: string) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t)))].map((b) => b.toString(16).padStart(2, "0")).join("");
const randomHex = (n: number) => [...crypto.getRandomValues(new Uint8Array(n))].map((b) => b.toString(16).padStart(2, "0")).join("");
type Sec = { totp_secret: string | null; pending_secret: string | null; enabled_at: string | null; recovery_hashes: string[] };
// null before migration 019 (two-step login then simply isn't available, and the key alone works).
// Any other read error throws: a database hiccup must not let the key alone through (fail closed).
async function security(): Promise<Sec | null> {
  const { data, error } = await admin.from("admin_security").select("*").eq("id", 1).maybeSingle();
  if (error) {
    if (error.code === "42P01" || /does not exist|schema cache/i.test(error.message)) return null;
    throw new Error("Couldn't check two-step login right now. Try again in a moment.");
  }
  return (data as Sec | null) ?? { totp_secret: null, pending_secret: null, enabled_at: null, recovery_hashes: [] };
}
async function sessionOk(token: string | null) {
  if (!token || !/^[0-9a-f]{64}$/.test(token)) return false;
  const hash = await sha(token);
  const { data } = await admin.from("admin_sessions").select("expires_at, last_used_at").eq("token_hash", hash).maybeSingle();
  if (!data || new Date(data.expires_at).getTime() < Date.now()) return false;
  if (Date.now() - new Date(data.last_used_at).getTime() > 3600e3) admin.from("admin_sessions").update({ last_used_at: new Date().toISOString() }).eq("token_hash", hash).then(() => {});
  return true;
}
async function newSession(remember: boolean, device: string) {
  const token = randomHex(32), days = remember ? 30 : 0.5;
  const expires = new Date(Date.now() + days * 864e5).toISOString();
  must(await admin.from("admin_sessions").insert({ token_hash: await sha(token), expires_at: expires, device: device.slice(0, 160) || null }));
  admin.from("admin_sessions").delete().lt("expires_at", new Date().toISOString()).then(() => {});
  return { token, expires };
}
// 5 wrong codes in 10 minutes stops further tries for a while, so a stolen admin key can't guess the code.
async function tooManyTries() {
  const { count } = await admin.from("admin_login_attempts").select("id", { count: "exact", head: true }).eq("ok", false).gte("created_at", new Date(Date.now() - 10 * 60e3).toISOString());
  return (count ?? 0) >= 5;
}
const recoveryNorm = (c: string) => c.toLowerCase().replace(/[^a-z0-9]/g, "");
let currentDevice = "";

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

// Where and on what the person last used Glow Studio: the newest of their app events, support
// messages (which carry platform, build and device) and app errors.
type Row = Record<string, unknown>;
function deviceOf(events: Row[], support: Row[], err: Row | null) {
  const s = support.find((r) => r.context && typeof r.context === "object" && Object.keys(r.context as object).length);
  const c = (s?.context ?? {}) as Record<string, string>;
  const e = events.find((r) => r.platform);
  return {
    platform: (e?.platform as string) || c.platform || (err?.platform as string) || null,
    build: c.build || (err?.build as string) || null,
    device: c.device || null,
    seen: (e?.created_at as string) || (s?.created_at as string) || null,
  };
}
// Pro given from this page (not bought): the newest "set_pro" in the change log whose end date is
// the plan's end date. A store purchase later moves the end date, so it stops matching.
function giftOf(p: Row | null, log: Row[]) {
  if (!p || p.plan !== "pro" || !p.plan_expires_at) return null;
  const g = log.find((r) => r.action === "set_pro");
  const until = (g?.detail as Row | undefined)?.until as string | undefined;
  if (!until || Math.abs(new Date(until).getTime() - new Date(String(p.plan_expires_at)).getTime()) > 120000) return null;
  return { until, given_at: g!.created_at, reason: (g!.detail as Row).reason ?? "" };
}

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
    // plan "pro": look through up to 200 newest accounts and keep only active Pro (the Overview "Pro now" card opens this).
    const pro = a.plan === "pro";
    let rows = must(await admin.rpc("admin_users", { p_query: text(a.q, 100), p_limit: pro ? 200 : 50 })) as { user_id: string; plan?: string }[];
    if (pro) rows = rows.filter((r) => r.plan === "pro");
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
      admin.from("support_requests").select("id, topic, message, status, created_at, context").eq("user_id", id).order("created_at", { ascending: false }).limit(10),
      admin.from("app_events").select("name, props, platform, created_at").eq("user_id", id).order("created_at", { ascending: false }).limit(30),
      admin.from("app_errors").select("message, build, platform, created_at").eq("user_id", id).order("created_at", { ascending: false }).limit(20),
      admin.from("subscription_events").select("type, product_id, period_type, store, environment, price_usd, cancel_reason, created_at").eq("user_id", id).order("created_at", { ascending: false }).limit(30),
      admin.from("feature_testers").select("label, created_at").eq("user_id", id).maybeSingle(),
    ]);
    const [log, lastErr] = await Promise.all([
      admin.from("admin_audit").select("*").eq("target", id).order("created_at", { ascending: false }).limit(30),
      admin.from("app_errors").select("build, platform, created_at").eq("user_id", id).not("build", "is", null).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    ]);
    if (!auth.data?.user) throw new HttpError("No account with that ID (it may have been deleted).");
    const u = auth.data.user;
    return {
      account: { id: u.id, created_at: u.created_at, last_seen: u.last_sign_in_at, anonymous: u.is_anonymous ?? !u.email },
      profile: profile.data, allowance: allowance.data, usage: must(usage), ads: ads.count ?? 0,
      support: support.data ?? [], events: events.data ?? [], errors: errors.data ?? [], subscriptions: subs.data ?? [],
      tester: tester.data ?? null, log: log.data ?? [], device: deviceOf(events.data ?? [], support.data ?? [], lastErr.data),
      gift: giftOf(profile.data, log.data ?? []),
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

  // Name and email for an account, typed by the owner (for example from an email the customer sent
  // outside the app). Contact support fills these in by itself. Empty clears them.
  async setContact(a) {
    const id = userId(a.user), name = text(a.name, 120).replace(/\s+/g, " ") || null, email = text(a.email, 200) || null;
    if (email && !/^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/.test(email)) throw new HttpError("That email address doesn't look right.");
    must(await admin.from("profiles").upsert({ id }, { onConflict: "id", ignoreDuplicates: true }));
    must(await admin.from("profiles").update({ contact_name: name, contact_email: email, contact_updated_at: new Date().toISOString() }).eq("id", id));
    await audit("set_contact", id, { name, email });
    return { contact_name: name, contact_email: email };
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

  // ---------- Support inbox (migration 017) ----------
  // The list: open (needs a reply), pending (waiting on the customer), closed or all, newest activity
  // first, with each customer's plan so paying customers stand out. q searches name, email and the message.
  async support(a) {
    const status = ["open", "pending", "closed"].includes(String(a.status)) ? String(a.status) : a.status === "all" ? null : "open";
    let q = admin.from("support_requests").select("*").order("updated_at", { ascending: false }).limit(200);
    if (status) q = q.eq("status", status);
    const term = text(a.q, 100).replace(/[%,()]/g, " ").trim();
    if (term) {
      if (/^\d+$/.test(term)) q = q.eq("id", Number(term));
      else q = q.or(`name.ilike.%${term}%,email.ilike.%${term}%,message.ilike.%${term}%`);
    }
    const rows = must(await q) as { id: number; user_id: string | null }[];
    const ids = [...new Set(rows.map((r) => r.user_id).filter(Boolean))] as string[];
    const reqIds = rows.map((r) => r.id);
    const [profiles, msgs, stats] = await Promise.all([
      ids.length ? admin.from("profiles").select("id, plan, plan_expires_at, plan_period, blocked_at, contact_name, contact_email").in("id", ids) : { data: [] },
      reqIds.length ? admin.from("support_messages").select("request_id, author, body, created_at").in("request_id", reqIds).neq("author", "note").order("created_at", { ascending: false }).limit(2000) : { data: [] },
      admin.rpc("admin_support_stats", { p_days: 30 }).maybeSingle(),
    ]);
    const prof = new Map((profiles.data ?? []).map((p: { id: string }) => [p.id, p]));
    const last = new Map<number, { author: string; body: string; created_at: string }>();
    const count = new Map<number, number>();
    for (const m of (msgs.data ?? []) as { request_id: number; author: string; body: string; created_at: string }[]) {
      if (!last.has(m.request_id)) last.set(m.request_id, m);
      count.set(m.request_id, (count.get(m.request_id) ?? 0) + 1);
    }
    const now = Date.now();
    return {
      rows: rows.map((r) => {
        const p = r.user_id ? prof.get(r.user_id) as Record<string, unknown> | undefined : undefined;
        const pro = p?.plan === "pro" && (!p.plan_expires_at || new Date(String(p.plan_expires_at)).getTime() > now);
        return { ...r, plan: pro ? "pro" : "free", plan_period: pro ? p?.plan_period ?? null : null, blocked: !!p?.blocked_at,
          contact_name: p?.contact_name ?? null, contact_email: p?.contact_email ?? null, last: last.get(r.id) ?? null, replies: count.get(r.id) ?? 0 };
      }),
      stats: stats.error ? null : stats.data,
      emailReady: emailReady(),
    };
  },

  // One conversation with everything needed to answer it without leaving the page: the messages and
  // notes, and the customer's plan, credits, recent AI runs, errors, purchases, other messages and change log.
  async supportThread(a) {
    const id = Math.trunc(Number(a.id));
    const { data: r } = await admin.from("support_requests").select("*").eq("id", id).maybeSingle();
    if (!r) throw new HttpError("That support message doesn't exist any more.");
    const uid = r.user_id as string | null;
    const [msgs, customer, others, log] = await Promise.all([
      admin.from("support_messages").select("*").eq("request_id", id).order("created_at"),
      uid ? actions.user({ user: uid }).catch(() => null) : Promise.resolve(null),
      uid ? admin.from("support_requests").select("id, topic, message, status, created_at").eq("user_id", uid).neq("id", id).order("created_at", { ascending: false }).limit(10) : { data: [] },
      uid ? admin.from("admin_audit").select("*").eq("target", uid).order("created_at", { ascending: false }).limit(20) : { data: [] },
    ]);
    const messages = must(msgs) as { attachments?: string[] }[];
    // Screenshots (migration 018) as links that work for an hour.
    const paths = [...((r.attachments as string[] | undefined) ?? []), ...messages.flatMap((m) => m.attachments ?? [])];
    let files: Record<string, string> = {};
    if (paths.length) {
      const { data } = await admin.storage.from("support-files").createSignedUrls(paths, 3600);
      files = Object.fromEntries((data ?? []).filter((x) => x.signedUrl && x.path).map((x) => [x.path!, x.signedUrl as string]));
    }
    return { request: r, messages, files, customer, others: others.data ?? [], log: log.data ?? [], emailReady: emailReady() };
  },

  // A reply. It's shown to the customer in the app (Settings > Your messages). With sendEmail it's also
  // emailed to them through Resend (when RESEND_API_KEY and SUPPORT_EMAIL_FROM are set); via "email"
  // without that records that the admin page opened a mail to them instead.
  // Status after: pending (waiting on them) by default, or closed.
  async supportReply(a) {
    const id = Math.trunc(Number(a.id)), body = text(a.body, 4000);
    if (!body) throw new HttpError("Write a reply first.");
    const status = a.status === "closed" ? "closed" : a.status === "open" ? "open" : "pending";
    const { data: r } = await admin.from("support_requests").select("*").eq("id", id).maybeSingle();
    if (!r) throw new HttpError("That support message doesn't exist any more.");
    let via = a.via === "email" ? "email" : "app";
    let emailed: boolean | null = null, emailError = "";
    if (a.sendEmail && emailReady()) {
      const { data: p } = r.user_id ? await admin.from("profiles").select("*").eq("id", r.user_id).maybeSingle() : { data: null };
      const to = String(p?.contact_email || r.email || "");
      const name = String(p?.contact_name || r.name || "");
      if (to) {
        ({ ok: emailed, error: emailError } = await sendReplyEmail(to, name, id, body));
        if (emailed) via = "email";
      } else { emailed = false; emailError = "No email on this account."; }
    }
    const now = new Date().toISOString();
    const row: Record<string, unknown> = { request_id: id, author: "admin", body, via };
    if (emailed !== null) row.email_status = emailed ? "sent" : "failed";
    let ins = await admin.from("support_messages").insert(row);
    if (ins.error && /email_status/.test(ins.error.message)) { delete row.email_status; ins = await admin.from("support_messages").insert(row); }
    must(ins);
    const patch: Record<string, unknown> = { status, last_reply_at: now, updated_at: now, closed_at: status === "closed" ? now : null };
    if (!r.first_reply_at) patch.first_reply_at = now;
    must(await admin.from("support_requests").update(patch).eq("id", id));
    await audit("support_reply", r.user_id ?? String(id), { request: id, via, status, chars: body.length, emailed });
    return { id, status, emailed, emailError };
  },

  // A private note on the conversation, never shown to the customer.
  async supportNote(a) {
    const id = Math.trunc(Number(a.id)), body = text(a.body, 4000);
    if (!body) throw new HttpError("Write a note first.");
    must(await admin.from("support_messages").insert({ request_id: id, author: "note", body }));
    must(await admin.from("support_requests").update({ updated_at: new Date().toISOString() }).eq("id", id));
    return { id };
  },

  // Status, priority, topic and tags. "note" is the older one-line note (kept for messages closed before 017).
  async supportUpdate(a) {
    const id = Math.trunc(Number(a.id));
    const patch: Record<string, unknown> = {};
    if (a.status !== undefined) {
      const status = ["open", "pending", "closed"].includes(String(a.status)) ? String(a.status) : "closed";
      patch.status = status;
      patch.closed_at = status === "closed" ? new Date().toISOString() : null;
    }
    if (a.priority !== undefined) patch.priority = a.priority === "high" ? "high" : "normal";
    if (a.topic !== undefined) {
      if (!["billing", "ai", "bug", "privacy", "other"].includes(String(a.topic))) throw new HttpError("Pick a topic.");
      patch.topic = a.topic;
    }
    if (Array.isArray(a.tags)) patch.tags = [...new Set(a.tags.map((t) => text(t, 30).toLowerCase()).filter(Boolean))].slice(0, 10);
    if (typeof a.note === "string") patch.note = text(a.note, 2000) || null;
    if (!Object.keys(patch).length) throw new HttpError("Nothing to change.");
    let res = await admin.from("support_requests").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id);
    // Before migration 017: only status and note exist.
    if (res.error && /column|check constraint/i.test(res.error.message) && (patch.status === "open" || patch.status === "closed")) {
      res = await admin.from("support_requests").update({ status: patch.status, ...(patch.note !== undefined ? { note: patch.note } : {}) }).eq("id", id);
    }
    must(res);
    if (patch.status) await audit("support_" + patch.status, String(id), typeof a.note === "string" && a.note ? { note: text(a.note, 200) } : {});
    return { id, ...patch };
  },

  async macros() {
    return must(await admin.from("support_macros").select("*").order("sort").order("id"));
  },

  async saveMacro(a) {
    const title = text(a.title, 80), body = text(a.body, 4000);
    if (!title || !body) throw new HttpError("A saved reply needs a name and the reply text.");
    const id = Math.trunc(Number(a.id)) || null;
    const row = { title, body, sort: Math.trunc(Number(a.sort)) || 0, updated_at: new Date().toISOString() };
    if (id) must(await admin.from("support_macros").update(row).eq("id", id));
    else must(await admin.from("support_macros").insert(row));
    return { saved: true };
  },

  async deleteMacro(a) {
    must(await admin.from("support_macros").delete().eq("id", Math.trunc(Number(a.id))));
    return { deleted: true };
  },

  // Small counts for the tab badges, checked every minute while the admin page is open.
  async badges() {
    const [open, unanswered, errors] = await Promise.all([
      admin.from("support_requests").select("id", { count: "exact", head: true }).eq("status", "open"),
      admin.from("support_requests").select("id", { count: "exact", head: true }).eq("status", "open").is("first_reply_at", null),
      admin.from("app_errors").select("id", { count: "exact", head: true }).gte("created_at", new Date(Date.now() - 864e5).toISOString()),
    ]);
    const { data: newest } = await admin.from("support_requests").select("id, created_at").order("created_at", { ascending: false }).limit(1).maybeSingle();
    return { openSupport: open.count ?? 0, unanswered: unanswered.error ? null : unanswered.count ?? 0, errors24h: errors.count ?? 0, newestSupport: newest ?? null };
  },

  // Accounts blocked from AI tools (the Blocking page lists them next to blocked addresses).
  async blockedUsers() {
    return must(await admin.from("profiles").select("id, blocked_at, blocked_reason, contact_name, contact_email").not("blocked_at", "is", null).order("blocked_at", { ascending: false }).limit(200));
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

  // ---------- Two-step login (migration 019) ----------
  async twoStepStatus() {
    const sec = await security();
    if (!sec) return { available: false, enabled: false };
    const { count } = await admin.from("admin_sessions").select("token_hash", { count: "exact", head: true }).gt("expires_at", new Date().toISOString());
    return { available: true, enabled: !!sec.enabled_at, since: sec.enabled_at, recoveryLeft: sec.recovery_hashes.length, devices: count ?? 0 };
  },

  // Step 1 of turning it on: a new secret for the authenticator app (scan the QR code or type the key).
  async twoStepSetup() {
    const sec = await security();
    if (!sec) throw new HttpError("Run migration 019 (two-step login) in the Supabase SQL editor first.");
    if (sec.enabled_at) throw new HttpError("Two-step login is already on.");
    const secret = b32enc(crypto.getRandomValues(new Uint8Array(20)));
    must(await admin.from("admin_security").update({ pending_secret: secret, updated_at: new Date().toISOString() }).eq("id", 1));
    return { secret, uri: `otpauth://totp/Glow%20Studio:admin?secret=${secret}&issuer=Glow%20Studio&algorithm=SHA1&digits=6&period=30` };
  },

  // Step 2: the first code from the app proves it's set up. Turns it on and returns 8 recovery codes, shown once.
  async twoStepConfirm(a) {
    const sec = await security();
    if (!sec?.pending_secret) throw new HttpError("Start the setup again.");
    if (!(await totpOk(sec.pending_secret, text(a.code, 10).replace(/\s/g, "")))) throw new HttpError("That code didn't match. Check the time on your phone and try the newest code.");
    const recovery = Array.from({ length: 8 }, () => { const x = randomHex(5); return `${x.slice(0, 5)}-${x.slice(5)}`; });
    must(await admin.from("admin_security").update({ totp_secret: sec.pending_secret, pending_secret: null, enabled_at: new Date().toISOString(),
      recovery_hashes: await Promise.all(recovery.map((c) => sha(recoveryNorm(c)))), updated_at: new Date().toISOString() }).eq("id", 1));
    await audit("two_step_on", null, {});
    return { ...(await newSession(a.remember === true, currentDevice)), recovery };
  },

  // The second step of signing in: a code from the app, or one of the recovery codes (each works once).
  async twoStepLogin(a) {
    const sec = await security();
    if (!sec?.enabled_at || !sec.totp_secret) return { notNeeded: true };
    if (await tooManyTries()) throw new HttpError("Too many wrong codes. Wait 10 minutes and try again.");
    const code = text(a.code, 20);
    let ok = await totpOk(sec.totp_secret, code.replace(/\s/g, "")), usedRecovery = false;
    if (!ok && recoveryNorm(code).length === 10) {
      const hash = await sha(recoveryNorm(code));
      if (sec.recovery_hashes.includes(hash)) {
        ok = usedRecovery = true;
        must(await admin.from("admin_security").update({ recovery_hashes: sec.recovery_hashes.filter((x) => x !== hash) }).eq("id", 1));
      }
    }
    await admin.from("admin_login_attempts").insert({ ok });
    if (!ok) throw new HttpError("That code didn't match. Use the newest code in your authenticator app.");
    if (usedRecovery) await audit("two_step_recovery_used", null, { left: sec.recovery_hashes.length - 1 });
    return { ...(await newSession(a.remember === true, currentDevice)), recoveryLeft: sec.recovery_hashes.length - (usedRecovery ? 1 : 0) };
  },

  // Signs every browser out of the admin page (they'll need a new code). Needs a signed-in session.
  async twoStepSignOutAll() {
    must(await admin.from("admin_sessions").delete().neq("token_hash", ""));
    await audit("two_step_sign_out_all", null, {});
    return { done: true };
  },

  // Turns it off. Needs a signed-in session and a current code.
  async twoStepOff(a) {
    const sec = await security();
    if (!sec?.totp_secret) return { enabled: false };
    if (!(await totpOk(sec.totp_secret, text(a.code, 10).replace(/\s/g, "")))) throw new HttpError("That code didn't match.");
    must(await admin.from("admin_security").update({ totp_secret: null, pending_secret: null, enabled_at: null, recovery_hashes: [], updated_at: new Date().toISOString() }).eq("id", 1));
    must(await admin.from("admin_sessions").delete().neq("token_hash", ""));
    await audit("two_step_off", null, {});
    return { enabled: false };
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
  currentDevice = (req.headers.get("user-agent") ?? "").replace(/\s*\([^)]*\)\s*/, " ").trim();
  // Two-step login: with it on, everything except checking the code needs a signed-in session.
  if (body.action !== "twoStepStatus" && body.action !== "twoStepLogin") {
    let sec: Sec | null;
    try { sec = await security(); } catch (e) { return json({ error: (e as Error).message }, 503); }
    if (sec?.enabled_at && !(await sessionOk(req.headers.get("x-admin-session")))) {
      return json({ error: "Enter the 6-digit code from your authenticator app.", needCode: true }, 403);
    }
  }
  try {
    return json(await run(body));
  } catch (e) {
    const msg = (e as Error).message;
    console.error("admin", body.action, msg);
    // Before migrations 009 and 010 the report functions and tables don't exist yet.
    if (/function .* does not exist|relation .* does not exist|column .* does not exist|schema cache/i.test(msg)) {
      if (/support|macro/i.test(body.action)) return json({ error: "Run migration 017 (support inbox) in the Supabase SQL editor first.", detail: msg }, 409);
      if (/feature/i.test(body.action) || /tester/i.test(body.action)) return json({ error: "Run migration 013 (feature switches) in the Supabase SQL editor first.", detail: msg }, 409);
      return json({ error: "Run migration 010 (and 009 before it) in the Supabase SQL editor first.", detail: msg }, 409);
    }
    return json({ error: msg }, e instanceof HttpError ? 400 : 500);
  }
});
