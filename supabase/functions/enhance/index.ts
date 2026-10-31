// Runs Glow Studio's AI tools on Replicate with the app owner's token, and enforces
// each user's plan limits. POST starts an edit (counts against the limit);
// GET ?id=... checks on one that is still running, and GET ?request=... finds an edit by the
// app's own request id when the app never heard the job id. Neither GET ever charges.
// Every answer says whether the credit was returned (`refunded`), so the app only claims a
// refund the server confirmed. Needs migration 006 (ai_usage.client_request_id).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { cleanPrompt, ENHANCE_HD, FACE_SHEET, HttpError, lastOutput, MODES, okFaceSheet, okHd, okTiles, rep, startPrediction, TOKEN } from "./pipeline.ts";

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

// Writes how an AI run ended, once, for the admin page's AI quality report (migration 010).
async function finish(id: number, status: string, error: unknown = null) {
  const { error: e } = await admin.from("ai_usage")
    .update({ status, finished_at: new Date().toISOString(), error: error ? String(error).slice(0, 300) : null })
    .eq("id", id).is("status", null);
  if (e) console.error("ai_usage outcome", e.message);
}
const DONE = new Set(["succeeded", "failed", "canceled"]);
// The model's own error (kept as it is for the admin page) in words for the app.
const told = (p: { status: string; error?: unknown }) =>
  p.status === "failed" ? "The AI couldn't edit this photo. Please try again, or try another photo." : p.error ?? null;
// How long a finished Enhance waits for its face sheet (group photos) before it's answered without it.
const FACES_WAIT_MS = 90_000;

// Enhance with a face sheet keeps both Replicate ids in prediction_id as "main.faces". The edit's
// outcome (and any refund) follows the main run only; the face sheet is an extra the app uses if
// it finished. Until it has (or FACES_WAIT_MS passed), a finished main run reads as "processing".
async function withFaces(p: any, facesId: string | undefined) {
  const out = { status: p.status, faces: null as unknown };
  if (!facesId || p.status !== "succeeded") return out;
  try {
    const f = await rep(`/predictions/${facesId}`);
    if (f.status === "succeeded") out.faces = lastOutput(f.output);
    else if (!DONE.has(f.status) && Date.now() - Date.parse(f.created_at) < FACES_WAIT_MS) out.status = "processing";
    else if (f.status === "failed") console.error("face sheet failed", facesId, f.error ?? "");
  } catch (e) { console.error("face sheet check", (e as Error).message); }
  return out;
}

// A tiled Enhance keeps its tile runs as "t1+t2+t3" (then ".faces"). Together they read as one
// edit: failed if any tile failed, finished when all are, and the output is every tile's result
// in order (the phone stitches them).
async function mainRun(ids: string[]) {
  if (ids.length === 1) return await rep(`/predictions/${ids[0]}`);
  const ps = await Promise.all(ids.map((id) => rep(`/predictions/${id}`)));
  const bad = ps.find((p) => p.status === "failed" || p.status === "canceled");
  if (bad) { ps.forEach((p) => { if (!DONE.has(p.status)) rep(`/predictions/${p.id}/cancel`, { method: "POST" }).catch(() => {}); }); return bad; }
  const all = ps.every((p) => p.status === "succeeded");
  return { id: ids.join("+"), status: all ? "succeeded" : ps.some((p) => p.status === "processing" || p.status === "succeeded") ? "processing" : "starting",
    output: all ? ps.map((p) => lastOutput(p.output)) : null, error: null, created_at: ps[0].created_at };
}
const outputOf = (p: any, tiled: boolean) => (tiled ? p.output : lastOutput(p.output));

// Starts a run without waiting. Replicate allows only one new job at a time on a low balance
// (429): wait the few seconds it asks, a few times, before giving up.
async function startNow(cfg: Parameters<typeof startPrediction>[0], image: string, tries = 4) {
  for (let i = 0; ; i++) {
    try { return (await startPrediction(cfg, { image }, false)).p; }
    catch (e) {
      if (!(e instanceof HttpError) || e.status !== 429 || i >= tries - 1) throw e;
      const secs = Math.min(12, Number(/resets in ~?(\d+)s/.exec((e as Error).message)?.[1] ?? 10));
      await new Promise((r) => setTimeout(r, (secs + 1) * 1000));
    }
  }
}

// The state of one charged edit, read fresh from Replicate. Free to call any number of times.
async function jobStatus(row: { id: number; prediction_id: string | null; refunded: boolean; status?: string | null }) {
  // Charged, but Replicate hasn't given an id yet (or starting it failed and was refunded).
  if (!row.prediction_id) {
    return row.refunded
      ? { id: null, status: "failed", output: null, error: "The edit couldn't be started.", refunded: true }
      : { id: null, status: "starting", output: null, error: null, refunded: false };
  }
  try {
    const [mainId, facesId] = row.prediction_id.split(".");
    const ids = mainId.split("+"), tiled = ids.length > 1;
    const p = await mainRun(ids);
    let refunded = row.refunded;
    // An edit that fails partway through doesn't count against the limit.
    if ((p.status === "failed" || p.status === "canceled") && !refunded) { await admin.rpc("refund_ai_edit", { p_usage: row.id }); refunded = true; }
    if (DONE.has(p.status) && !row.status) await finish(row.id, p.status, p.error);
    const w = await withFaces(p, facesId);
    return { id: row.prediction_id, status: w.status, output: outputOf(p, tiled), tiles: tiled ? ids.length : undefined, faces: w.faces, error: told(p), refunded };
  } catch (e) {
    // A brand-new prediction can briefly 404 before Replicate can read it back.
    if (e instanceof HttpError && e.status === 404) return { id: row.prediction_id, status: "starting", output: null, error: null, refunded: row.refunded };
    throw e;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (!TOKEN) return json({ error: "Glow Studio's AI isn't set up yet (missing Replicate token)." }, 503);

  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer /, "");
  const { data: { user } } = await admin.auth.getUser(jwt);
  if (!user) return json({ error: "Please reopen the app to sign in again." }, 401);

  try {
    if (req.method === "GET") {
      const q = new URL(req.url).searchParams, id = q.get("id"), request = q.get("request");
      // Only the user who started an edit can check on it.
      let sel = admin.from("ai_usage").select("id, prediction_id, refunded, status").eq("user_id", user.id);
      if (id && /^[a-z0-9]+(\+[a-z0-9]+){0,3}(\.[a-z0-9]+)?$/i.test(id)) sel = sel.eq("prediction_id", id);
      else if (request && UUID.test(request)) sel = sel.eq("client_request_id", request);
      else return json({ error: "Bad id" }, 400);
      const { data: row } = await sel.maybeSingle();
      // For ?request=, 404 means the edit never reached this point, so nothing was charged.
      if (!row) return json({ error: "Not found" }, 404);
      return json(await jobStatus(row));
    }
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

    const { image, mode, mask, extra, prompt, request_id, faces, hd, tiles, from, tool, platform, build } = await req.json().catch(() => ({}));
    const requestId = typeof request_id === "string" && UUID.test(request_id) ? request_id : null;
    // A resent request is the same edit: answer with it instead of charging again.
    if (requestId) {
      const { data: row } = await admin.from("ai_usage").select("id, prediction_id, refunded, status")
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

    // Feature switches (migration 013): a tool switched off on the admin page is refused here, before
    // anything is charged. The Enhance tab (and the camera's AI Enhance) has no switch; an editor tool
    // is checked under its own id and the mode it runs (Glow Up runs Pro edit, for example). Before
    // 013, or if the check itself fails, nothing is blocked.
    const keys = new Set<string>();
    if (!(from === "enhance" && mode === "enhance")) keys.add(`tool:${mode}`);
    if (typeof tool === "string" && /^[a-z0-9_]{1,32}$/.test(tool)) keys.add(`tool:${tool}`);
    const where = { p_user: user.id, p_platform: ["web", "ios", "android"].includes(platform) ? platform : null,
      p_build: Number.isInteger(build) && build > 0 && build < 2147483647 ? build : null };
    const checks = await Promise.all([...keys].map((k) => admin.rpc("feature_on", { p_key: k, ...where }).then((r) => [k, r] as const)));
    const off = checks.find(([, r]) => !r.error && r.data === false);
    if (off) return json({ error: "This tool is taking a short break. Nothing was charged. Please try again later.", feature_off: off[0] }, 403);

    // Every AI edit uses credits (most tools 1, portrait styles 2), so no plan can cost more than it earns.
    const { data: quota, error: qErr } = await admin.rpc("consume_ai_edit", { p_user: user.id, p_mode: mode, p_ip: clientIp(req) }).single();
    if (qErr) throw qErr;
    const usage = { plan: quota.plan, used: quota.used, quota: quota.quota, remaining: quota.remaining, pool: quota.pool };
    if (quota.ok && requestId) {
      const { error: dup } = await admin.from("ai_usage").update({ client_request_id: requestId }).eq("id", quota.usage_id);
      if (dup) {
        // Two copies of the same request raced; keep the first one and return this charge.
        await admin.rpc("refund_ai_edit", { p_usage: quota.usage_id });
        await finish(quota.usage_id, "duplicate");
        const { data: row } = await admin.from("ai_usage").select("id, prediction_id, refunded, status")
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
      if (quota.pool === "blocked") {
        return json({ error: "AI tools are turned off for this account. If you think this is a mistake, use Contact support in Settings.", limit: true, blocked: true, usage }, 403);
      }
      const msg = quota.remaining > 0 ? `This tool uses 2 AI credits and you have ${quota.remaining} left.` : quota.plan === "pro"
        ? "You've used your AI credits for now. They refresh over the next few days."
        : quota.pool === "trial"
        ? "You've used your free premium credits. Go Pro to keep using premium AI tools, or use the everyday AI tools with your daily credits."
        : "You've used today's free AI credits. Go Pro for 40 a week, or come back tomorrow.";
      return json({ error: msg, limit: true, usage }, 429);
    }

    let facesId: string | undefined;
    const dropFaces = () => { if (facesId) rep(`/predictions/${facesId}/cancel`, { method: "POST" }).catch(() => {}); };
    try {
      // Enhance with a face sheet starts the main edit without waiting, so the face sheet can start
      // right after it and both run together; the app follows the job either way.
      // Which Enhance this charge buys: Topaz for Pro and credit-pack credits, tiles for free ones.
      let paid = quota.plan === "pro";
      if (!paid && mode === "enhance" && okHd(hd)) {
        const { data: u } = await admin.from("ai_usage").select("from_bonus").eq("id", quota.usage_id).maybeSingle();
        paid = !!u?.from_bonus;
      }
      let p: any = null, info: any = null, tileIds: string[] = [];
      if (mode === "enhance" && paid && okHd(hd)) {
        // Topaz restores every face itself, so no face sheet. If it turns the photo down at once,
        // the usual Enhance runs instead on the same credit.
        try { ({ p, info } = await startPrediction(ENHANCE_HD, { image: hd })); } catch (e) { console.error("hd start", (e as Error).message); }
        if (p && (p.status === "failed" || p.status === "canceled")) { console.log("hd failed, using Enhance", p.id, p.error ?? ""); p = null; }
        if (p) console.log("started enhance hd", info.model, p.id, p.status);
      }
      const sheet = !p && mode === "enhance" && okFaceSheet(faces);
      if (!p && mode === "enhance" && !paid && okTiles(tiles)) {
        // Every tile starts at once; the edit is one job made of them.
        try {
          for (const t of tiles) tileIds.push((await startNow(cfg, t)).id);
          p = { id: tileIds.join("+"), status: "starting", output: null, error: null };
          info = { model: "nightmareai/real-esrgan (tiles)" };
          console.log("started enhance tiles", p.id);
        } catch (e) {
          tileIds.forEach((id) => rep(`/predictions/${id}/cancel`, { method: "POST" }).catch(() => {}));
          console.error("tiles start", (e as Error).message); tileIds = []; p = null;
        }
      }
      if (!p) ({ p, info } = await startPrediction(cfg, { image, mask, extra, prompt: cleanPrompt(prompt) }, !sheet));
      console.log("started", mode, info.model, p.id, p.status, p.error ?? "");
      if (sheet) await admin.from("ai_usage").update({ prediction_id: p.id }).eq("id", quota.usage_id);   // findable while the sheet starts
      // The face sheet is an extra on the same credit. Replicate allows only one new job at a time
      // on a low balance (429): wait the few seconds it asks once, then go on without it.
      if (sheet && p.status !== "failed" && p.status !== "canceled") {
        for (let i = 0; i < 2 && !facesId; i++) {
          try { facesId = (await startPrediction(FACE_SHEET, { image: faces }, false)).p.id; console.log("face sheet", facesId); }
          catch (e) {
            console.error("face sheet start", (e as Error).message);
            if (!(e instanceof HttpError) || e.status !== 429 || i) break;
            const secs = Math.min(12, Number(/resets in ~?(\d+)s/.exec((e as Error).message)?.[1] ?? 10));
            await new Promise((r) => setTimeout(r, (secs + 1) * 1000));
          }
        }
      }
      const failed = p.status === "failed" || p.status === "canceled";
      if (failed) { dropFaces(); facesId = undefined; }
      const pid = facesId ? `${p.id}.${facesId}` : p.id;
      await admin.from("ai_usage").update({ prediction_id: pid }).eq("id", quota.usage_id);
      if (failed) await admin.rpc("refund_ai_edit", { p_usage: quota.usage_id });
      if (DONE.has(p.status)) await finish(quota.usage_id, p.status, p.error);
      const w = await withFaces(p, facesId);
      return json({ id: pid, status: w.status, output: outputOf(p, tileIds.length > 1), tiles: tileIds.length > 1 ? tileIds.length : undefined,
        hd: info.model === ENHANCE_HD.model || undefined, faces: w.faces, error: told(p), refunded: failed, usage });
    } catch (e) {
      dropFaces();
      await admin.rpc("refund_ai_edit", { p_usage: quota.usage_id });
      await finish(quota.usage_id, "failed", (e as Error).message);
      throw e;
    }
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    console.error("enhance failed", status, (e as Error).message);
    const msg = status === 402 ? "Glow Studio's AI service is temporarily unavailable. Please try again later."
      : status === 429 ? "Glow Studio's AI is busy right now. Please try again in a few seconds. Your credit was returned."
      : (e as Error).message;
    return json({ error: msg }, status >= 500 || status === 402 ? 502 : status);
  }
});
