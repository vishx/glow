// Runs Glow's AI tools on Replicate with the app owner's token, and enforces
// each user's plan limits. POST starts an edit (counts against the limit);
// GET ?id=... checks on one that is still running, and GET ?request=... finds an edit by the
// app's own request id when the app never heard the job id. Neither GET ever charges.
// Every answer says whether the credit was returned (`refunded`), so the app only claims a
// refund the server confirmed. Needs migration 006 (ai_usage.client_request_id).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const STYLE_MODELS = ["zsxkib/instant-id", "zsxkib/pulid"];
function style(prompt: string) {
  return { prompt, negative_prompt: "blurry, deformed, extra limbs, low quality, text, watermark" };
}

// Prompt-based photo edits (smile, light, hair, clothes) on an image-editing model.
const EDIT_MODELS = ["google/nano-banana", "black-forest-labs/flux-kontext-pro"];
const SAME = " Keep the same person: same face, identity, skin tone and age. Keep everything else in the photo the same. Photorealistic.";
function edit(prompt: string, model: string | string[] = EDIT_MODELS) {
  return { model, input: { prompt: prompt + SAME, output_format: "jpg" } };
}
const hair = (style: string) => edit(`Change only the person's hairstyle to ${style}. Keep the same hair color, clothes, pose and background.`);
const outfit = (clothes: string) => edit(`Change only the person's clothes to ${clothes}. Keep the same body shape, pose, hair and background.`);

type Mode = { model: string | string[]; input: Record<string, unknown>; needsMask?: boolean; needsExtra?: boolean };
const MODES: Record<string, Mode> = {
  enhance: { model: "sczhou/codeformer", input: { codeformer_fidelity: 0.7, background_enhance: true, face_upsample: true, upscale: 2 } },
  upscale: { model: "nightmareai/real-esrgan", input: { scale: 4, face_enhance: false } },
  faces: { model: "tencentarc/gfpgan", input: { version: "v1.4", scale: 2 } },
  colorize: { model: "piddnad/ddcolor", input: { model_size: "large" } },
  retouch: { model: "sczhou/codeformer", input: { codeformer_fidelity: 0.3, background_enhance: false, face_upsample: true, upscale: 1 } },
  headshot: { model: STYLE_MODELS, input: style("professional studio headshot photo, soft key light, smart business attire, neutral gray backdrop, sharp focus") },
  anime: { model: STYLE_MODELS, input: style("anime style illustration portrait, vibrant colors, clean line art, soft cel shading") },
  watercolor: { model: STYLE_MODELS, input: style("watercolor painting portrait, soft pastel washes, paper texture, delicate brush strokes") },
  fashion: { model: STYLE_MODELS, input: style("high fashion editorial photo, glossy magazine lighting, stylish outfit, studio backdrop") },
  toon3d: { model: "fofr/face-to-many", input: { style: "3D", prompt: "a person" } },
  clay: { model: "fofr/face-to-many", input: { style: "Clay", prompt: "a person" } },
  older: { model: "yuval-alaluf/sam", input: { target_age: "75" } },
  younger: { model: "yuval-alaluf/sam", input: { target_age: "20" } },
  erase: { model: ["allenhooo/lama", "zylim0702/remove-object"], input: {}, needsMask: true },
  // Enhance: a full professional retouch of color, light, skin and background.
  pro: edit("Edit this photo the way a professional photographer and retoucher would. Correct the white balance and color so skin tones look natural and true. " +
    "Fix the exposure and lighting: brighten and evenly light the face, recover shadows and highlights, add gentle contrast and depth. " +
    "Retouch the skin naturally: soften blemishes and under-eye shadows while keeping real skin texture. Sharpen the eyes and fine detail, and remove noise and blur. " +
    "Clean up the background: remove small distracting clutter, stains and stray objects, even out the color and light, and add a subtle, natural depth of field. " +
    "Do not change the face shape, features, expression, body, clothes or the place."),
  smile: edit("Make the person smile naturally and warmly, with a relaxed, genuine smile that shows a little of the teeth. Change only the mouth and the smile lines around the eyes."),
  relight: edit("Relight the photo with soft, flattering professional studio light on the face: even skin, gentle shadows, a soft catchlight in the eyes. Keep the same pose, clothes and background."),
  golden: edit("Relight the photo with warm golden-hour sunlight coming from the side, with a soft warm glow on the skin and hair. Keep the same pose, clothes and background."),
  hair_waves: hair("long, soft, glossy beach waves"),
  hair_bob: hair("a sleek chin-length bob"),
  hair_pixie: hair("a chic short pixie cut"),
  hair_bangs: hair("long layered hair with soft curtain bangs"),
  hair_curls: hair("big, bouncy, defined curls"),
  hair_bun: hair("an elegant sleek high bun"),
  hair_braids: hair("long, neat box braids"),
  hair_butterfly: hair("a voluminous layered butterfly cut with a glam blowout"),
  outfit: {
    ...edit("Dress the person from the first image in the outfit shown in the second image, matching its colors, fabric and details. Keep the same body shape, pose, hair and background.",
      ["google/nano-banana", "cuuupid/idm-vton"]),
    needsExtra: true,
  },
  gown: outfit("an elegant floor-length evening gown"),
  suit: outfit("a sharp, tailored business suit"),
  sundress: outfit("a light, flowy floral summer dress"),
  street: outfit("trendy streetwear: an oversized jacket, a fitted top and stylish jeans"),
  expand: {
    model: ["black-forest-labs/flux-fill-pro", "black-forest-labs/flux-fill-dev"],
    input: { prompt: "seamlessly continue the photo beyond its edges, matching lighting and scene", output_format: "jpg" },
    needsMask: true,
  },
};

const API = "https://api.replicate.com/v1";
const TOKEN = Deno.env.get("REPLICATE_API_TOKEN") ?? "";
const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const versionCache: Record<string, ModelInfo> = {};

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

async function rep(path: string, init: RequestInit = {}) {
  const res = await fetch(API + path, {
    ...init,
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new HttpError(res.status, body.detail || body.title || `Replicate error ${res.status}`);
  return body;
}

type ModelInfo = { model: string; version: string | null; imageKey: string; maskKey: string; props: Record<string, any>; open: boolean; imageList: boolean };
// Input names for models whose schema we already know (official models may not publish one).
// Official models run through the model's own endpoint, not a version id.
const KNOWN: Record<string, { image: string; list?: boolean; official?: boolean }> = {
  "google/nano-banana": { image: "image_input", list: true, official: true },
  "black-forest-labs/flux-kontext-pro": { image: "input_image", official: true },
  "cuuupid/idm-vton": { image: "human_img" },
};

// Looks up the model's latest version and input names. A list means "first one that exists".
async function modelInfo(model: string | string[]): Promise<ModelInfo> {
  if (Array.isArray(model)) {
    for (const m of model) {
      try { return await modelInfo(m); } catch (e) { if (!(e instanceof HttpError) || e.status !== 404) throw e; }
    }
    throw new HttpError(404, "This tool's AI model isn't available right now.");
  }
  if (versionCache[model]) return versionCache[model];
  const m = await rep(`/models/${model}`);
  const v = m.latest_version;
  const props = v?.openapi_schema?.components?.schemas?.Input?.properties ?? {};
  const imageKey = KNOWN[model]?.image ??
    ["image", "img", "input_image", "image_input", "main_face_image", "face_image", "human_img", "input"].find((k) => k in props) ?? "image";
  const maskKey = Object.keys(props).find((k) => /mask/i.test(k)) ?? "mask";
  const imageList = KNOWN[model]?.list ?? props[imageKey]?.type === "array";
  // Official models have no public version and run through the model's own endpoint.
  return (versionCache[model] = { model, version: KNOWN[model]?.official ? null : v?.id ?? null, imageKey, maskKey, props, imageList, open: !v || !Object.keys(props).length });
}

// Cloudflare sets cf-connecting-ip itself, so the app can't fake it (x-forwarded-for can be).
const clientIp = (req: Request) =>
  req.headers.get("cf-connecting-ip") || req.headers.get("x-real-ip") || (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || null;
const lastOutput = (o: unknown) => (Array.isArray(o) ? o[o.length - 1] : o) ?? null;
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

    const { image, mode, mask, extra, request_id } = await req.json().catch(() => ({}));
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
    const usage = { plan: quota.plan, used: quota.used, quota: quota.quota, remaining: quota.remaining };
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
      const msg = quota.remaining > 0 ? `This style uses 2 AI credits and you have ${quota.remaining} left.` : quota.plan === "pro"
        ? "You've used this week's 40 AI credits. They refresh over the next few days."
        : "You've used today's free AI credits. Go Pro for 40 a week, or come back tomorrow.";
      return json({ error: msg, limit: true, usage }, 429);
    }

    try {
      const info = await modelInfo(cfg.model);
      const images = cfg.needsExtra ? [image, extra] : [image];
      const input: Record<string, unknown> = { [info.imageKey]: info.imageList ? images : image };
      for (const [k, v] of Object.entries(cfg.input)) if (info.open || k in info.props) input[k] = v;
      // Try-on models without an image list take the clothes as their own input.
      if (cfg.needsExtra && !info.imageList) {
        input[["garm_img", "garment_image", "cloth_image"].find((k) => k in info.props) ?? "garm_img"] = extra;
        input.garment_des = "outfit";
      }
      if (cfg.needsMask) input[info.maskKey] = mask;
      // Wait up to a minute so most edits finish in one request.
      const p = await rep(info.version ? "/predictions" : `/models/${info.model}/predictions`, {
        method: "POST",
        headers: { Prefer: "wait=55" },
        body: JSON.stringify(info.version ? { version: info.version, input } : { input }),
      });
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
