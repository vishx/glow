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

const PRO_PROMPT = "Edit this photo the way a professional photographer and photo retoucher would finish it for delivery. " +
  "Correct the white balance so whites look neutral and skin tones look natural and true. " +
  "Fix the exposure: brighten and evenly light the faces and people, recover highlights and shadows, add gentle contrast and a clean, polished, natural color grade. " +
  "Retouch skin lightly: reduce blemishes, shine and under-eye shadows while keeping real skin texture. Remove noise and sharpen the eyes and fine detail. " +
  "Tidy the background: reduce small distractions and give it a subtle, natural depth of field so the people stand out. " +
  "Keep every person exactly as they are: the same face, identity, facial features, face shape, expression, age, skin tone, hair, body, pose and clothes. " +
  "Keep the same framing, composition and place. Photorealistic. Do not add objects or text.";

export type Mode = { model: string | string[]; input: Record<string, unknown>; needsMask?: boolean; needsExtra?: boolean; userPrompt?: string; garment?: string; category?: string };
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
  // Pro Edit (Enhance's second choice and the editor's Pro edit): the photo finished the way a
  // photographer and retoucher would. Chosen 2026-10-31 after a side-by-side test of 7 edit models on
  // the owner's event photo (tools/pro-edit-test): Nano Banana 2 gave the most natural pro look and,
  // with the phone's face-true finish (engine.js proFinish), kept faces at ArcFace 0.96-0.98.
  // 1K is enough: the phone puts the photo's own fine detail back. Falls back to Nano Banana, then
  // FLUX Kontext, on the same credit.
  pro: { model: ["google/nano-banana-2", "google/nano-banana", "black-forest-labs/flux-kontext-pro"],
    input: { prompt: PRO_PROMPT, output_format: "jpg", resolution: "1K", aspect_ratio: "match_input_image" } },
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
  // Try on (2026-10-31 redesign): one tool, three sources. The phone sends the outfit photo
  // (`extra`), or words (`prompt`: an idea from the app's list, or her own description), and
  // which part to change (`part`). tryOnMode() below builds the instruction. Nano Banana 2 keeps
  // the garment's print and cut most faithfully; then Nano Banana, then IDM-VTON (photo only).
  // The phone puts her own face back if the model moved it.
  outfit: {
    model: ["google/nano-banana-2", "google/nano-banana", "cuuupid/idm-vton"],
    input: { prompt: "", output_format: "jpg", resolution: "1K", aspect_ratio: "match_input_image" },
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

// Try on: what to change, as the phone names it.
export const TRY_PARTS = ["auto", "top", "bottom", "full"] as const;
const PART_RULE: Record<string, string> = {
  auto: "Change only the clothing items shown in the outfit; any of the person's own clothes the outfit doesn't cover stay exactly as they are.",
  top: "Change only the person's top layer (shirt, blouse, sweater or jacket). Keep their own trousers, skirt and shoes exactly as they are.",
  bottom: "Change only the person's trousers, skirt or shorts. Keep their own top and shoes exactly as they are.",
  full: "Change the person's whole outfit, from the neckline down, including shoes where they are visible.",
};
const VTON_CATEGORY: Record<string, string> = { top: "upper_body", bottom: "lower_body", full: "dresses" };
const TRY_KEEP = " Keep the same body shape and size, the same pose, hands, hair and background, and the same framing. " +
  "The clothes must fit the person's body and pose naturally, with realistic folds, shadows and the photo's own light." + SAME;
// The try-on edit for one request: a photo of the outfit (`extra`) or words for it (`words`).
export function tryOnMode(base: Mode, part: unknown, words: string, hasPhoto: boolean): Mode {
  const p = TRY_PARTS.includes(part as any) ? part as string : "auto";
  const prompt = hasPhoto
    ? "The first image is a photo of a person. The second image shows an outfit (it may be a product photo, a screenshot or worn by someone else). " +
      "Dress the person from the first image in that outfit. Copy the garments exactly: color, pattern, print, fabric, cut, length, neckline, sleeves and details. " +
      "Ignore the second image's person, face, body, pose and background. " + (words ? `The outfit: ${words}. ` : "") + PART_RULE[p] + TRY_KEEP
    : `Dress the person in ${words}. ` + PART_RULE[p === "auto" ? "full" : p] + TRY_KEEP;
  const input: Record<string, unknown> = { ...base.input, prompt };
  // Words alone need an image-edit model; the try-on model only works from an outfit photo.
  const models = (Array.isArray(base.model) ? base.model : [base.model]).filter((m) => hasPhoto || m !== "cuuupid/idm-vton");
  return { ...base, model: models, input, needsExtra: hasPhoto, garment: words || "outfit", category: VTON_CATEGORY[p] };
}

// Enhance's second pass for group photos and small faces (2026-10-31). The phone finds every face
// on the full-size photo, cuts each one out at its real resolution and lays them out on one sheet;
// GFPGAN restores every face on the sheet in a single run, and the phone puts them back. GFPGAN
// only restores faces it is very sure of (score 0.97 or more), so the small, soft faces of a wide
// shot are skipped in the main pass; enlarged on the sheet they are found. No extra credit.
export const FACE_SHEET: Mode = { model: "tencentarc/gfpgan", input: { version: "v1.4", scale: 2 } };
export const FACE_SHEET_MAX = { bytes: 2_400_000, side: 1536, pixels: 1_600_000 };

// Width and height of a JPEG or PNG data URL, read from its header (no decoding).
export function imageSize(dataUrl: string): [number, number] | null {
  const comma = dataUrl.indexOf(",");
  if (comma < 0) return null;
  let bin: string;
  try { bin = atob(dataUrl.slice(comma + 1, comma + 1 + 65536 - (65536 % 4))); } catch { return null; }
  const b = (i: number) => bin.charCodeAt(i);
  if (b(0) === 0x89 && bin.slice(1, 4) === "PNG") return [(b(16) << 24 | b(17) << 16 | b(18) << 8 | b(19)) >>> 0, (b(20) << 24 | b(21) << 16 | b(22) << 8 | b(23)) >>> 0];
  if (b(0) !== 0xff || b(1) !== 0xd8) return null;
  for (let i = 2; i + 9 < bin.length;) {
    if (b(i) !== 0xff) { i++; continue; }
    const m = b(i + 1), len = b(i + 2) << 8 | b(i + 3);
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return [b(i + 7) << 8 | b(i + 8), b(i + 5) << 8 | b(i + 6)];
    i += 2 + len;
  }
  return null;
}
// Sharper Enhance (owner's choice 2026-10-31, after a side-by-side test on a 12 MP phone photo):
// - Pro and credit-pack charges run Topaz (topazlabs/image-upscale, $0.05 for up to 24 MP out):
//   the most faithful and crisp result. The phone sends `hd`, up to ~3 MP; Topaz doubles it.
// - Free charges run Real-ESRGAN on 2-4 overlapping tiles of a ~3 MP copy (`tiles`, each under the
//   ~1 MP that fits its GPU), started together on one credit; the phone stitches them back.
// Either way the charge is still one "enhance" credit, so the database needs no change.
export const ENHANCE_HD: Mode = { model: "topazlabs/image-upscale", input: { enhance_model: "Standard V2", upscale_factor: "2x", face_enhancement: true, output_format: "jpg" } };
export const HD_MAX = { side: 2600, pixels: 3_300_000 };
export const TILE_MAX = { count: 4, side: 1400, pixels: 1_000_000 };
const okImg = (v: unknown, max: { side: number; pixels: number }): v is string => {
  if (typeof v !== "string" || !/^data:image\/(jpeg|png);base64,/.test(v) || v.length > 6_000_000) return false;
  const wh = imageSize(v);
  return !!wh && wh[0] >= 16 && wh[1] >= 16 && Math.max(...wh) <= max.side && wh[0] * wh[1] <= max.pixels;
};
export const okHd = (v: unknown): v is string => okImg(v, HD_MAX);
export const okTiles = (v: unknown): v is string[] =>
  Array.isArray(v) && v.length >= 2 && v.length <= TILE_MAX.count && v.every((t) => okImg(t, TILE_MAX));

export function okFaceSheet(v: unknown): v is string {
  if (typeof v !== "string" || !/^data:image\/(jpeg|png);base64,/.test(v) || v.length > FACE_SHEET_MAX.bytes * 1.37) return false;
  const wh = imageSize(v);
  return !!wh && wh[0] >= 64 && wh[1] >= 64 && Math.max(...wh) <= FACE_SHEET_MAX.side && wh[0] * wh[1] <= FACE_SHEET_MAX.pixels;
}

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
  "google/nano-banana-2": { image: "image_input", list: true, official: true },
  "black-forest-labs/flux-kontext-pro": { image: "input_image", official: true },
  "cuuupid/idm-vton": { image: "human_img" },
  "topazlabs/image-upscale": { image: "image", official: true },
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
// A tool with a list of models falls back to the next one when a model is missing or turns the
// photo down at once (Nano Banana sometimes answers "Failed to generate image." within seconds
// for an ordinary photo), so one charge still gets a result. An edit still running after the
// wait is returned as it is and never started twice.
// `wait = false` starts it and answers at once (Enhance's face sheet runs alongside the main edit).
export async function startPrediction(cfg: Mode, args: { image: string; mask?: string; extra?: string; prompt?: string }, wait = true) {
  const models = Array.isArray(cfg.model) ? cfg.model : [cfg.model];
  let last: { p: any; info: ModelInfo } | null = null, missing: unknown = null;
  for (const model of models) {
    let info: ModelInfo;
    try { info = await modelInfo(model); } catch (e) {
      if (e instanceof HttpError && e.status === 404) { missing = e; continue; }
      throw e;
    }
    const p = await runOn(info, cfg, args, wait);
    last = { p, info };
    if (p.status !== "failed") return last;
    console.log("model failed, trying the next", model, p.id, p.error ?? "");
  }
  if (last) return last;
  throw missing ?? new HttpError(404, "This tool's AI model isn't available right now.");
}

async function runOn(info: ModelInfo, cfg: Mode, { image, mask, extra, prompt }: { image: string; mask?: string; extra?: string; prompt?: string }, wait = true) {
  const images = cfg.needsExtra ? [image, extra] : [image];
  const input: Record<string, unknown> = { [info.imageKey]: info.imageList ? images : image };
  for (const [k, v] of Object.entries(cfg.input)) if (info.open || k in info.props) input[k] = v;
  // Try-on models without an image list take the clothes as their own input.
  if (cfg.needsExtra && !info.imageList) {
    input[["garm_img", "garment_image", "cloth_image"].find((k) => k in info.props) ?? "garm_img"] = extra;
    input.garment_des = cfg.garment ?? "outfit";
    if (cfg.category && "category" in info.props) input.category = cfg.category;
  }
  if (cfg.needsMask) input[info.maskKey] = mask;
  if (cfg.userPrompt && prompt) input.prompt = cfg.userPrompt.replace("{p}", prompt);
  // Wait up to a minute so most edits finish in one request.
  return await rep(info.version ? "/predictions" : `/models/${info.model}/predictions`, {
    method: "POST",
    headers: wait ? { Prefer: "wait=55" } : {},
    body: JSON.stringify(info.version ? { version: info.version, input } : { input }),
  });
}
