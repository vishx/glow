// Runs Glow's AI tools on Replicate with the app owner's token, and enforces
// each user's plan limits. POST starts an edit (counts against the limit);
// GET ?id=... checks on one that is still running, and GET ?request=... finds an edit by the
// app's own request id when the app never heard the job id. Neither GET ever charges.
// Every answer says whether the credit was returned (`refunded`), so the app only claims a
// refund the server confirmed. Needs migration 006 (ai_usage.client_request_id).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { cleanPrompt, HttpError, lastOutput, MODES, rep, startPrediction, TOKEN } from "./pipeline.ts";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

// Cloudflare sets cf-connecting-ip itself, so the app can't fake it (x-forwarded-for can be).
const clientIp = (req: Request) =>
  req.headers.get("cf-connecting-ip") || req.headers.get("x-real-ip") || (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || null;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The state of one charged edit, read fresh from Replicate. Free to call any number of times.
async function jobStatus(row: { id: number; prediction_id: string | null; refunded: boolean }) {
  // Charged, but Replicate hasn't given an id yet (or starting it failed and was refunded).
  if (!row.prediction_id) {
    return row.refunded
      ? { id: null, status: "failed", output: null, error: "The edit couldn't be started.", refunded: true }
      : { id: null, status: "starting", output: null, error: null, refunded: false };
  }
  try {
    const p = await rep(`/predictions/${row.prediction_id}`);
    let refunded = row.refunded;
    // An edit that fails partway through doesn't count against the limit.
    if ((p.status === "failed" || p.status === "canceled") && !refunded) { await admin.rpc("refund_ai_edit", { p_usage: row.id }); refunded = true; }
    return { id: p.id, status: p.status, output: lastOutput(p.output), error: p.error ?? null, refunded };
  } catch (e) {
    // A brand-new prediction can briefly 404 before Replicate can read it back.
    if (e instanceof HttpError && e.status === 404) return { id: row.prediction_id, status: "starting", output: null, error: null, refunded: row.refunded };
    throw e;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (!TOKEN) return json({ error: "Glow's AI isn't set up yet (missing Replicate token)." }, 503);

  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer /, "");
  const { data: { user } } = await admin.auth.getUser(jwt);
  if (!user) return json({ error: "Please reopen the app to sign in again." }, 401);

  try {
    if (req.method === "GET") {
      const q = new URL(req.url).searchParams, id = q.get("id"), request = q.get("request");
      // Only the user who started an edit can check on it.
      let sel = admin.from("ai_usage").select("id, prediction_id, refunded").eq("user_id", user.id);
      if (id && /^[a-z0-9]+$/i.test(id)) sel = sel.eq("prediction_id", id);
      else if (request && UUID.test(request)) sel = sel.eq("client_request_id", request);
      else return json({ error: "Bad id" }, 400);
      const { data: row } = await sel.maybeSingle();
      // For ?request=, 404 means the edit never reached this point, so nothing was charged.
      if (!row) return json({ error: "Not found" }, 404);
      return json(await jobStatus(row));
    }
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

    const { image, mode, mask, extra, prompt, request_id } = await req.json().catch(() => ({}));
    const requestId = typeof request_id === "string" && UUID.test(request_id) ? request_id : null;
    // A resent request is the same edit: answer with it instead of charging again.
    if (requestId) {
      const { data: row } = await admin.from("ai_usage").select("id, prediction_id, refunded")
        .eq("user_id", user.id).eq("client_request_id", requestId).maybeSingle();
      if (row) return json(await jobStatus(row));
    }
    const cfg = MODES[mode];
    if (!cfg) return json({ error: "Unknown tool" }, 400);
    const okImage = typeof image === "string" &&
      (image.startsWith("data:image/") || /^https:\/\/([a-z0-9-]+\.)*replicate\.delivery\//.test(image));
    if (!okImage) return json({ error: "Send the photo as a data URL" }, 400);
    if (cfg.needsMask && (typeof mask !== "string" || !mask.startsWith("data:image/"))) return json({ error: "Mark the area first" }, 400);
    if (cfg.needsExtra && (typeof extra !== "string" || !extra.startsWith("data:image/"))) return json({ error: "Pick the outfit photo first" }, 400);

    // Every AI edit uses credits (most tools 1, portrait styles 2), so no plan can cost more than it earns.
    const { data: quota, error: qErr } = await admin.rpc("consume_ai_edit", { p_user: user.id, p_mode: mode, p_ip: clientIp(req) }).single();
    if (qErr) throw qErr;
    const usage = { plan: quota.plan, used: quota.used, quota: quota.quota, remaining: quota.remaining, pool: quota.pool };
    if (quota.ok && requestId) {
      const { error: dup } = await admin.from("ai_usage").update({ client_request_id: requestId }).eq("id", quota.usage_id);
      if (dup) {
        // Two copies of the same request raced; keep the first one and return this charge.
        await admin.rpc("refund_ai_edit", { p_usage: quota.usage_id });
        const { data: row } = await admin.from("ai_usage").select("id, prediction_id, refunded")
          .eq("user_id", user.id).eq("client_request_id", requestId).maybeSingle();
        if (row) return json(await jobStatus(row));
        throw dup;
      }
    }
    // IP addresses are only needed for today's free limit; clear older ones now and then.
    if (Math.random() < 0.05) {
      admin.from("ai_usage").update({ ip: null }).not("ip", "is", null)
        .lt("created_at", new Date(Date.now() - 2 * 864e5).toISOString()).then(() => {});
    }
    if (!quota.ok) {
      const msg = quota.remaining > 0 ? `This tool uses 2 AI credits and you have ${quota.remaining} left.` : quota.plan === "pro"
        ? "You've used your AI credits for now. They refresh over the next few days."
        : quota.pool === "trial"
        ? "You've used your 3 free tries of the premium AI tools. Go Pro to keep using them; the other AI tools stay free every day."
        : "You've used today's free AI credits. Go Pro for 40 a week, or come back tomorrow.";
      return json({ error: msg, limit: true, usage }, 429);
    }

    try {
      const { p, info } = await startPrediction(cfg, { image, mask, extra, prompt: cleanPrompt(prompt) });
      console.log("started", mode, info.model, p.id, p.status, p.error ?? "");
      await admin.from("ai_usage").update({ prediction_id: p.id }).eq("id", quota.usage_id);
      const failed = p.status === "failed" || p.status === "canceled";
      if (failed) await admin.rpc("refund_ai_edit", { p_usage: quota.usage_id });
      return json({ id: p.id, status: p.status, output: lastOutput(p.output), error: p.error ?? null, refunded: failed, usage });
    } catch (e) {
      await admin.rpc("refund_ai_edit", { p_usage: quota.usage_id });
      throw e;
    }
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    console.error("enhance failed", status, (e as Error).message);
    const msg = status === 402 ? "Glow's AI service is temporarily unavailable. Please try again later." : (e as Error).message;
    return json({ error: msg }, status >= 500 || status === 402 ? 502 : status);
  }
});
