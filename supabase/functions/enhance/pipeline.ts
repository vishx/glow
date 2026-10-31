// Glow Studio's AI pipeline: which Replicate model and settings each tool uses, and how an edit is
// started. Shared by the enhance function and tools/demo/generate.ts, so the sample's prepared
// results are made with exactly the settings users get.

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

export type Mode = { model: string | string[]; input: Record<string, unknown>; needsMask?: boolean; needsExtra?: boolean; userPrompt?: string };
export const MODES: Record<string, Mode> = {
  // Enhance (the app's one-tap flow and the Restore tool): Real-ESRGAN sharpens and doubles the
  // whole photo, and its GFPGAN pass restores the faces. CodeFormer was used before 2026-10-30 but
  // its license (S-Lab 1.0) doesn't allow commercial use.
  enhance: { model: "nightmareai/real-esrgan", input: { scale: 2, face_enhance: true } },
  upscale: { model: "nightmareai/real-esrgan", input: { scale: 4, face_enhance: false } },
  faces: { model: "tencentarc/gfpgan", input: { version: "v1.4", scale: 2 } },
  colorize: { model: "piddnad/ddcolor", input: { model_size: "large" } },
  // AI Retouch: GFPGAN v1.3, the softer, more natural version (Face repair uses v1.4). Scale 2,
  // because at scale 1 this model returns half the input's size.
  retouch: { model: "tencentarc/gfpgan", input: { version: "v1.3", scale: 2 } },
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
  // Generative fill: repaints only the masked area. The user's short prompt (if any) is put
  // inside userPrompt; with no prompt it continues the surrounding scene.
  fill: {
    model: ["black-forest-labs/flux-fill-pro", "black-forest-labs/flux-fill-dev"],
    input: { prompt: "fill the marked area so it blends naturally with the rest of the photo, matching lighting, perspective and texture", output_format: "jpg" },
    needsMask: true,
    userPrompt: "{p}, blending naturally with the rest of the photo, matching lighting, perspective and texture",
  },
  // Background scene: repaints only the background (the mask is everything but the person,
  // made on the phone), so she keeps her own face, hair and clothes.
  bgscene: {
    model: ["black-forest-labs/flux-fill-pro", "black-forest-labs/flux-fill-dev"],
    input: { prompt: "a clean professional photo studio backdrop, soft natural light, photorealistic, matching the person's lighting and perspective", output_format: "jpg" },
    needsMask: true,
    userPrompt: "{p}, a photorealistic background behind the person, matching their lighting, perspective and camera focus, no extra people",
  },
  // Describe / Glow Up "your words": her own request, as a careful photo edit. The phone puts her
  // own face back if the model moved it.
  custom: { ...edit("Make this photo look its best"), userPrompt: "Edit this photo: {p}." + SAME },
  // HD cutout: a matting model whose edge follows single hair strands. The phone applies the
  // result to the full-size photo and adds the background.
  bgcut: { model: ["men1scus/birefnet", "851-labs/background-remover", "lucataco/remove-bg"], input: {} },
};

// A user prompt is plain text: one line, at most 200 characters, no control characters.
export function cleanPrompt(v: unknown): string {
  if (typeof v !== "string") return "";
  return v.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 200);
}

// REPLICATE_API_BASE is only set for tools/demo/generate.ts runs; the deployed function uses Replicate directly.
export const API = Deno.env.get("REPLICATE_API_BASE") ?? "https://api.replicate.com/v1";
export const TOKEN = Deno.env.get("REPLICATE_API_TOKEN") ?? "";

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export async function rep(path: string, init: RequestInit = {}) {
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

const versionCache: Record<string, ModelInfo> = {};
// Looks up the model's latest version and input names. A list means "first one that exists".
export async function modelInfo(model: string | string[]): Promise<ModelInfo> {
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

export const lastOutput = (o: unknown) => (Array.isArray(o) ? o[o.length - 1] : o) ?? null;

// Starts one edit on Replicate and waits up to a minute for it. Charging is the caller's job.
export async function startPrediction(cfg: Mode, { image, mask, extra, prompt }: { image: string; mask?: string; extra?: string; prompt?: string }) {
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
  if (cfg.userPrompt && prompt) input.prompt = cfg.userPrompt.replace("{p}", prompt);
  // Wait up to a minute so most edits finish in one request.
  const p = await rep(info.version ? "/predictions" : `/models/${info.model}/predictions`, {
    method: "POST",
    headers: { Prefer: "wait=55" },
    body: JSON.stringify(info.version ? { version: info.version, input } : { input }),
  });
  return { p, info };
}
