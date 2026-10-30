// Starts an enhancement job on Replicate (POST) or checks on one (GET ?id=...).
// The Replicate token comes from the REPLICATE_API_TOKEN env var, or from the
// x-replicate-token header that the app sends when the user pasted their own.

const STYLE_MODELS = ["zsxkib/instant-id", "zsxkib/pulid"];
function style(prompt) {
  return { prompt, negative_prompt: "blurry, deformed, extra limbs, low quality, text, watermark" };
}

const MODES = {
  enhance: {
    model: "sczhou/codeformer",
    input: { codeformer_fidelity: 0.7, background_enhance: true, face_upsample: true, upscale: 2 },
  },
  upscale: {
    model: "nightmareai/real-esrgan",
    input: { scale: 4, face_enhance: false },
  },
  faces: {
    model: "tencentarc/gfpgan",
    input: { version: "v1.4", scale: 2 },
  },
  colorize: {
    model: "piddnad/ddcolor",
    input: { model_size: "large" },
  },
  retouch: {
    model: "sczhou/codeformer",
    input: { codeformer_fidelity: 0.3, background_enhance: false, face_upsample: true, upscale: 1 },
  },
  // Selfie styles: one photo in, a restyled portrait out.
  headshot: { model: STYLE_MODELS, input: style("professional studio headshot photo, soft key light, smart business attire, neutral gray backdrop, sharp focus") },
  anime: { model: STYLE_MODELS, input: style("anime style illustration portrait, vibrant colors, clean line art, soft cel shading") },
  watercolor: { model: STYLE_MODELS, input: style("watercolor painting portrait, soft pastel washes, paper texture, delicate brush strokes") },
  fashion: { model: STYLE_MODELS, input: style("high fashion editorial photo, glossy magazine lighting, stylish outfit, studio backdrop") },
  toon3d: { model: "fofr/face-to-many", input: { style: "3D", prompt: "a person" } },
  clay: { model: "fofr/face-to-many", input: { style: "Clay", prompt: "a person" } },
  older: { model: "yuval-alaluf/sam", input: { target_age: "75" } },
  younger: { model: "yuval-alaluf/sam", input: { target_age: "20" } },
  // Mask-based edits: white in the mask marks what to replace.
  erase: { model: ["allenhooo/lama", "zylim0702/remove-object"], input: {}, needsMask: true },
  expand: {
    model: ["black-forest-labs/flux-fill-pro", "black-forest-labs/flux-fill-dev"],
    input: { prompt: "seamlessly continue the photo beyond its edges, matching lighting and scene", output_format: "jpg" },
    needsMask: true,
  },
  // Cut-out of the subject as a transparent PNG; the app also uses it for background blur.
  cutout: {
    model: ["851-labs/background-remover", "cjwbw/rembg", "lucataco/remove-bg"],
    input: { format: "png" },
  },
};

const API = "https://api.replicate.com/v1";
const versionCache = {};

function tokenFrom(req) {
  return process.env.REPLICATE_API_TOKEN || req.headers["x-replicate-token"] || "";
}

async function rep(path, token, init = {}) {
  const res = await fetch(API + path, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers || {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(body.detail || body.title || `Replicate error ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return body;
}

// Looks up the model's latest version and which input key takes the image.
// A list of models means "use the first one that exists".
async function modelInfo(model, token) {
  if (Array.isArray(model)) {
    for (const m of model) {
      try { return await modelInfo(m, token); } catch (e) { if (e.status !== 404) throw e; }
    }
    const err = new Error("This tool's AI model isn't available right now.");
    err.status = 404;
    throw err;
  }
  if (versionCache[model]) return versionCache[model];
  const m = await rep(`/models/${model}`, token);
  const v = m.latest_version;
  const props = v?.openapi_schema?.components?.schemas?.Input?.properties || {};
  const imageKey = ["image", "img", "input_image", "main_face_image", "face_image", "input"].find((k) => k in props) || "image";
  const maskKey = Object.keys(props).find((k) => /mask/i.test(k)) || "mask";
  // Official models have no public version and run through the model's own endpoint.
  const info = { model, version: v?.id || null, imageKey, maskKey, props, open: !v || !Object.keys(props).length };
  versionCache[model] = info;
  return info;
}

async function readJson(req) {
  if (req.body && typeof req.body === "object") return req.body;
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

module.exports = async function handler(req, res) {
  const token = tokenFrom(req);
  if (!token) {
    return res.status(401).json({ error: "No Replicate token yet. Add yours in Settings." });
  }
  try {
    if (req.method === "GET") {
      const id = String(req.query.id || "");
      if (!/^[a-z0-9]+$/i.test(id)) return res.status(400).json({ error: "Bad id" });
      let p;
      try {
        p = await rep(`/predictions/${id}`, token);
      } catch (e) {
        // A brand-new prediction can briefly 404 before Replicate can read it back.
        if (e.status === 404) return res.status(200).json({ status: "starting", output: null, error: null });
        throw e;
      }
      const out = Array.isArray(p.output) ? p.output[p.output.length - 1] : p.output;
      if (p.status !== "starting" && p.status !== "processing") console.log("prediction", id, p.status, p.error || "", out ? "has output" : "no output");
      return res.status(200).json({ status: p.status, output: out || null, error: p.error || null });
    }
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

    const { image, mode, mask } = await readJson(req);
    const cfg = MODES[mode];
    if (!cfg) return res.status(400).json({ error: "Unknown mode" });
    // A data URL from the phone, or an earlier result so tools can be stacked.
    const ok = typeof image === "string" &&
      (image.startsWith("data:image/") || /^https:\/\/([a-z0-9-]+\.)*replicate\.delivery\//.test(image));
    if (!ok) return res.status(400).json({ error: "Send the photo as a data URL" });
    const info = await modelInfo(cfg.model, token);
    // Only pass settings this model version actually accepts.
    const input = { [info.imageKey]: image };
    for (const [k, v] of Object.entries(cfg.input)) if (info.open || k in info.props) input[k] = v;
    if (cfg.needsMask) {
      if (typeof mask !== "string" || !mask.startsWith("data:image/")) return res.status(400).json({ error: "Mark the area first" });
      input[info.maskKey] = mask;
    }

    // Wait up to a minute for the result so most photos finish in one request.
    const p = await rep(info.version ? "/predictions" : `/models/${info.model}/predictions`, token, {
      method: "POST",
      headers: { Prefer: "wait=55" },
      body: JSON.stringify(info.version ? { version: info.version, input } : { input }),
    });
    const out = Array.isArray(p.output) ? p.output[p.output.length - 1] : p.output;
    console.log("started", mode, info.model, p.id, p.status, p.error || "");
    return res.status(200).json({ id: p.id, status: p.status, output: out || null, error: p.error || null });
  } catch (e) {
    console.error("enhance failed", e.status || "", e.message);
    return res.status(e.status && e.status < 500 ? e.status : 502).json({ error: e.message });
  }
};
