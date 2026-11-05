// Glow Studio image engine: everything that changes pixels. Runs on the device
// (canvas, WebGL, MediaPipe); AI edits are started from app.js.

const BG_LABELS = { bgblur: "Blur background", bgremove: "Remove background", bgwhite: "White background",
  bgblush: "Blush background", bgsky: "Sky background" };
const BG_FILLS = {
  bgwhite: (ctx, w, h) => { ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, w, h); },
  bgblush: (ctx, w, h) => gradient(ctx, w, h, ["#ffd6e0", "#ffb3c7", "#f7a1c4"]),
  bgsky: (ctx, w, h) => gradient(ctx, w, h, ["#cfe9ff", "#9fd3ff", "#6fb8ff"]),
};
// On-phone filters: a canvas filter chain (at most 4 steps, so the native camera can draw it),
// an optional soft-light color wash, and optional film effects (fx, all 0..1):
//   fade: lifts the blacks (a white layer); leak: a warm light leak from the right edge;
//   vignette: darker corners; grain: film grain; date: an orange date stamp, bottom right.
// Ids never change (saved looks and edits refer to them); names may.
const FILTERS = [
  { id: "none", name: "None", f: "none" },
  { id: "glow", name: "Glow", f: "brightness(1.05) contrast(0.96) saturate(1.04)", wash: "rgba(255,150,175,0.24)", fx: { fade: 0.02 } },
  { id: "film", name: "Film", f: "contrast(0.93) saturate(0.95) sepia(0.14) brightness(1.03)", wash: "rgba(255,160,80,0.22)",
    fx: { fade: 0.06, grain: 0.35, vignette: 0.14 } },
  { id: "warm", name: "Golden", f: "saturate(1.14) contrast(1.04) brightness(1.03)", wash: "rgba(255,150,40,0.18)", fx: { vignette: 0.1 } },
  { id: "soft", name: "Soft", f: "brightness(1.09) contrast(0.88) saturate(0.92)", wash: "rgba(255,240,236,0.10)", fx: { fade: 0.04 } },
  { id: "matte", name: "Matte", f: "contrast(0.86) saturate(0.8) brightness(1.02)", wash: "rgba(120,140,150,0.10)", fx: { fade: 0.1, grain: 0.15 } },
  { id: "clear", name: "Clear", f: "contrast(1.1) saturate(1.1)", wash: "rgba(70,150,190,0.10)" },
  { id: "vivid", name: "Vivid", f: "saturate(1.38) contrast(1.1)" },
  { id: "cool", name: "Cool", f: "saturate(0.95) brightness(1.02)", wash: "rgba(80,140,255,0.18)" },
  { id: "digicam", name: "Digicam", f: "contrast(1.06) saturate(1.12) brightness(1.02) hue-rotate(-4deg)", wash: "rgba(90,170,255,0.10)",
    fx: { grain: 0.2 } },
  { id: "disposable", name: "Disposable", f: "saturate(1.18) contrast(1.08) sepia(0.1)", wash: "rgba(255,150,70,0.14)",
    fx: { fade: 0.04, grain: 0.5, vignette: 0.28, leak: 0.35, date: 1 } },
  { id: "instant", name: "Instant", f: "contrast(0.9) saturate(0.88) sepia(0.15) brightness(1.03)", wash: "rgba(255,200,150,0.14)",
    fx: { fade: 0.07, grain: 0.2, vignette: 0.18 } },
  { id: "mono", name: "Mono", f: "grayscale(1) contrast(1.15)", fx: { grain: 0.15 } },
  { id: "noir", name: "Noir", f: "grayscale(1) contrast(1.4) brightness(0.95)", fx: { grain: 0.25, vignette: 0.25 } },
];
// A filter at strength t (0..1): every step, the wash and the effects move toward "no change".
const FILTER_ID = { brightness: 1, contrast: 1, saturate: 1, grayscale: 0, sepia: 0, "hue-rotate": 0 };
function scaleFilter(flt, t = 1) {
  if (!flt || t >= 1) return flt;
  t = Math.max(0, t);
  const f = flt.f === "none" ? "none" : flt.f.replace(/([a-z-]+)\(([-\d.]+)(deg)?\)/g, (m, fn, v, u) => {
    const id = FILTER_ID[fn] ?? 0; return `${fn}(${Math.round((id + (parseFloat(v) - id) * t) * 1e4) / 1e4}${u || ""})`;
  });
  const wash = flt.wash && flt.wash.replace(/,\s*([\d.]+)\)$/, (m, a) => `,${Math.round(parseFloat(a) * t * 1e4) / 1e4})`);
  const fx = flt.fx && Object.fromEntries(Object.entries(flt.fx).map(([k, v]) => [k, k === "date" ? (t > 0 ? v : 0) : v * t]));
  return { ...flt, f, wash, fx };
}
// The film grain: one fixed tile of soft gray noise (the same every time, so a photo and its
// preview match), drawn with "overlay" so mid-gray changes nothing.
let grainTileC = null;
function grainTile() {
  if (grainTileC) return grainTileC;
  const n = 128, c = newCanvas(n, n), x = c.getContext("2d"), img = x.createImageData(n, n);
  let s = 1234567;
  const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  for (let i = 0; i < n * n; i++) {
    const v = Math.max(0, Math.min(255, Math.round(128 + ((rnd() + rnd() + rnd()) / 3 - 0.5) * 255 * 0.55)));
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255;
  }
  x.putImageData(img, 0, 0);
  grainTileC = c;
  return c;
}
// Grain cells are this fraction of the photo's short side, so grain looks the same at any size.
const GRAIN_CELL = 1 / 900;
function filterDate(when = Date.now()) {
  const d = new Date(when), p = (n) => String(n).padStart(2, "0");
  return `'${p(d.getFullYear() % 100)} ${p(d.getMonth() + 1)} ${p(d.getDate())}`;
}
// Draws a filter's effects on top of an already filtered picture (w x h) in ctx.
function paintFx(ctx, w, h, fx, when) {
  if (!fx) return;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (fx.fade > 0) { ctx.globalCompositeOperation = "source-over"; ctx.fillStyle = `rgba(255,255,255,${fx.fade})`; ctx.fillRect(0, 0, w, h); }
  if (fx.leak > 0) {
    const R = Math.max(w, h) * 0.7, g = ctx.createRadialGradient(w * 1.02, h * 0.18, 0, w * 1.02, h * 0.18, R);
    g.addColorStop(0, `rgba(255,120,40,${fx.leak})`); g.addColorStop(0.45, `rgba(255,70,90,${fx.leak * 0.45})`); g.addColorStop(1, "rgba(255,70,90,0)");
    ctx.globalCompositeOperation = "screen"; ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  }
  if (fx.vignette > 0) {
    // Same as CSS radial-gradient(ellipse farthest-corner, transparent 55%, black v 100%).
    ctx.globalCompositeOperation = "source-over";
    ctx.translate(w / 2, h / 2); ctx.scale(w / 2 * Math.SQRT2, h / 2 * Math.SQRT2);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    g.addColorStop(0.55, "rgba(0,0,0,0)"); g.addColorStop(1, `rgba(0,0,0,${fx.vignette})`);
    ctx.fillStyle = g; ctx.fillRect(-1, -1, 2, 2);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }
  if (fx.grain > 0) {
    const cell = Math.max(1, Math.min(w, h) * GRAIN_CELL), pat = ctx.createPattern(grainTile(), "repeat");
    ctx.globalCompositeOperation = "overlay"; ctx.globalAlpha = Math.min(1, fx.grain);
    ctx.scale(cell, cell); ctx.fillStyle = pat; ctx.fillRect(0, 0, w / cell, h / cell);
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1;
  }
  if (fx.date) {
    const s = Math.round(Math.min(w, h) * 0.042), m = Math.round(Math.min(w, h) * 0.05);
    ctx.globalCompositeOperation = "source-over";
    ctx.font = `bold ${s}px "Courier New", ui-monospace, monospace`; ctx.textAlign = "right"; ctx.textBaseline = "alphabetic";
    ctx.shadowColor = "rgba(255,70,0,0.85)"; ctx.shadowBlur = s * 0.35;
    ctx.fillStyle = "rgba(255,160,70,0.95)"; ctx.fillText(filterDate(when), w - m, h - m);
  }
  ctx.restore();
}
// A filter on a canvas that already holds the plain picture: chain, then wash, then effects.
function paintFilter(ctx, w, h, flt, draw, when) {
  drawWith(ctx, flt.f, draw);
  if (flt.wash) { ctx.globalCompositeOperation = "soft-light"; ctx.fillStyle = flt.wash; ctx.fillRect(0, 0, w, h); ctx.globalCompositeOperation = "source-over"; }
  paintFx(ctx, w, h, flt.fx, when);
}

function gradient(ctx, w, h, stops) {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  stops.forEach((c, i) => g.addColorStop(i / (stops.length - 1), c));
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
}

function loadImg(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (!src.startsWith("data:") && !src.startsWith("blob:")) img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Couldn't load the image."));
    img.src = src;
  });
}

// The working size for previews. Saving raises it for a moment to redo each step at full size.
let IMG_MAX = 2048;
function canvasFor(img, maxSide = IMG_MAX) {
  const s = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement("canvas");
  c.width = Math.round(img.naturalWidth * s); c.height = Math.round(img.naturalHeight * s);
  return c;
}

// Opens a picked photo at up to 2048px on the long side (the browser applies the
// photo's own rotation). AI uploads are shrunk separately in uploadable().
async function loadAndShrink(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImg(url);
    const c = canvasFor(img, 2048);
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.9);
  } catch { throw new Error("Couldn't read that photo."); }
  finally { URL.revokeObjectURL(url); }
}

async function shrinkData(dataUrl, maxSide = 2048) {
  // Keeps PNG (and its transparency) as PNG.
  const img = await loadImg(dataUrl);
  if (Math.max(img.naturalWidth, img.naturalHeight) <= maxSide) return dataUrl;
  const c = canvasFor(img, maxSide);
  c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
  return isPng(dataUrl) ? c.toDataURL("image/png") : c.toDataURL("image/jpeg", 0.92);
}

// Expand: pad the photo on every side and ask the model to fill the new border.
async function expandInputs(src) {
  const img = await loadImg(src), base = canvasFor(img, 1024);
  const pw = Math.round(base.width * 0.2), ph = Math.round(base.height * 0.15);
  const c = document.createElement("canvas"), m = document.createElement("canvas");
  c.width = m.width = base.width + pw * 2; c.height = m.height = base.height + ph * 2;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#808080"; ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(img, pw, ph, base.width, base.height);
  const mctx = m.getContext("2d");
  mctx.fillStyle = "#fff"; mctx.fillRect(0, 0, m.width, m.height);
  mctx.fillStyle = "#000"; mctx.fillRect(pw + 6, ph + 6, base.width - 12, base.height - 12);
  // Where the photo sits in the padded picture (0-1), so the result can get the photo's own
  // full-size pixels back in the middle (app.js settleJob).
  return { image: c.toDataURL("image/jpeg", 0.92), mask: m.toDataURL("image/png"),
    place: { l: pw / c.width, t: ph / c.height, w: base.width / c.width, h: base.height / c.height } };
}
// Expand's result at the photo's own resolution: the AI's new border scaled up, and the full-size
// photo (every earlier step redone at full size) put back exactly in the middle. Capped at 16 MP.
async function expandComposite(photo, ai, place) {
  const [p, a] = await Promise.all([loadImg(photo), loadImg(ai)]);
  let W = p.naturalWidth / place.w, H = p.naturalHeight / place.h;
  const k = Math.min(1, Math.sqrt(16e6 / (W * H)));
  W = Math.round(W * k); H = Math.round(H * k);
  const c = document.createElement("canvas"); c.width = W; c.height = H;
  const x = c.getContext("2d"); x.imageSmoothingQuality = "high";
  x.drawImage(a, 0, 0, W, H);
  x.drawImage(p, Math.round(place.l * W), Math.round(place.t * H), Math.round(place.w * W), Math.round(place.h * H));
  return c.toDataURL("image/jpeg", 0.95);
}

// Replicate URLs can be passed straight through; big client-made images get shrunk first.
// Enhance (Real-ESRGAN with face repair) works at 4x inside its GPU before resizing, so memory
// follows the pixel count: a ~1.2 MP photo ran it out of memory on 2026-10-31. Enhance gets at
// most 1280px on the long side and 0.9 MP (a 4:3 phone photo becomes 1095x821, a 3:4 one
// 821x1095; the result comes back twice that), and a retry after a memory error 1024px / 0.6 MP.
const AI_MAX_SIDE = { enhance: 1280, upscale: 1024 };
const AI_MAX_PIXELS = { enhance: 900_000, upscale: 600_000 };
const AI_RETRY = { side: 1024, pixels: 600_000 };
const aiMaxSide = (mode) => AI_MAX_SIDE[mode] || 1600;
const aiMaxPixels = (mode) => AI_MAX_PIXELS[mode] || Infinity;
// A model's own error (a Python traceback, "CUDA out of memory") means nothing to her; say it plainly.
const isOutOfMemory = (e) => /out of memory|CUDA|OOM/i.test(String(e || ""));
function aiErrorText(e, fallback = "The AI couldn't finish this photo. Please try again.") {
  const t = String(e || "").trim();
  if (!t || isOutOfMemory(t) || t.length > 140 || /Traceback|Error:|\.py\b|GiB|torch/i.test(t)) return fallback;
  return t;
}
async function uploadable(src, maxSide = 1600, maxPixels = Infinity) {
  if (!src.startsWith("data:")) return src;
  const img = await loadImg(src);
  const w = img.naturalWidth, h = img.naturalHeight;
  if (Math.max(w, h) <= maxSide && w * h <= maxPixels && src.length < 1_500_000) return src;
  const k = Math.min(1, maxSide / Math.max(w, h), Math.sqrt(maxPixels / (w * h)));
  const c = document.createElement("canvas"); c.width = Math.max(1, Math.floor(w * k)); c.height = Math.max(1, Math.floor(h * k));
  c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.9);
}
// Background tools run on the phone with MediaPipe's selfie model, so they're free and private.
const MP_CDN = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";
const MP_MODEL = "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite";
let visionPromise = null, segmenterPromise = null;
function visionLib() {
  if (!visionPromise) visionPromise = (async () => {
    // The phone app ships these files inside the app; the web version loads them from a CDN.
    const base = native ? new URL("vendor/mediapipe", location.href).href : MP_CDN;
    const vision = await import(`${base}/vision_bundle.mjs`);
    return { vision, fileset: await vision.FilesetResolver.forVisionTasks(`${base}/wasm`) };
  })().catch((e) => { visionPromise = null; throw e; });
  return visionPromise;
}
function segmenter() {
  if (!segmenterPromise) segmenterPromise = (async () => {
    const { vision, fileset } = await visionLib();
    return vision.ImageSegmenter.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: native ? "vendor/selfie_segmenter.tflite" : MP_MODEL },
      runningMode: "IMAGE", outputConfidenceMasks: true, outputCategoryMask: false,
    });
  })().catch(() => { segmenterPromise = null; throw new Error("Couldn't load the background tool. Check your connection and try again."); });
  return segmenterPromise;
}
// ---------- One-tap Eraser (2026-11-02, idea 2) ----------
// Tap to select: MediaPipe's interactive segmenter ("magic touch") outlines the thing under the
// finger. Find distractions: its object detector lists people and clutter; the main subject (the
// biggest, most central person) is kept and the rest are offered for removal. Both run on the phone.
const MAGIC_MODEL = "https://storage.googleapis.com/mediapipe-models/interactive_segmenter/magic_touch/float32/1/magic_touch.tflite";
const OBJECT_MODEL = "https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/float16/1/efficientdet_lite0.tflite";
let magicPromise = null, objectsPromise = null;
function magicFinder() {
  if (!magicPromise) magicPromise = (async () => {
    const { vision, fileset } = await visionLib();
    return vision.InteractiveSegmenter.createFromOptions(fileset, { baseOptions: { modelAssetPath: native ? "vendor/magic_touch.tflite" : MAGIC_MODEL }, outputConfidenceMasks: true, outputCategoryMask: false });
  })().catch(() => { magicPromise = null; throw new Error("Couldn't load tap to select. Check your connection, or paint over it instead."); });
  return magicPromise;
}
function objectFinder() {
  if (!objectsPromise) objectsPromise = (async () => {
    const { vision, fileset } = await visionLib();
    return vision.ObjectDetector.createFromOptions(fileset, { baseOptions: { modelAssetPath: native ? "vendor/efficientdet_lite0.tflite" : OBJECT_MODEL }, scoreThreshold: 0.3, maxResults: 25, runningMode: "IMAGE" });
  })().catch(() => { objectsPromise = null; throw new Error("Couldn't load distraction finder. Check your connection."); });
  return objectsPromise;
}
// A mask (white where selected, clear elsewhere) at the picture's size, for a tap at (x, y), 0..1.
async function magicSelect(src, x, y) {
  const [seg, img] = await Promise.all([magicFinder(), loadImg(src)]);
  const c = canvasFor(img, 1024); c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
  const res = seg.segment(c, { keypoint: { x, y } }), m = res.confidenceMasks && res.confidenceMasks[0];
  if (!m) { if (res.close) res.close(); throw new Error("Nothing found there. Tap right on it, or paint over it."); }
  const conf = m.getAsFloat32Array(), mc = newCanvas(m.width, m.height), mx = mc.getContext("2d"), px = mx.createImageData(m.width, m.height);
  let on = 0;
  for (let i = 0; i < conf.length; i++) { const v = conf[i] > 0.5 ? 255 : 0; px.data[i * 4] = px.data[i * 4 + 1] = px.data[i * 4 + 2] = 255; px.data[i * 4 + 3] = v; if (v) on++; }
  if (res.close) res.close();
  if (on < conf.length * 0.0005) throw new Error("Nothing found there. Tap right on it, or paint over it.");
  if (on > conf.length * 0.6) throw new Error("That selected most of the photo. Tap a smaller thing, or paint over it.");
  mx.putImageData(px, 0, 0);
  // A little larger than the thing itself, so its edge and shadow go too.
  const W = img.naturalWidth, H = img.naturalHeight, out = newCanvas(W, H), o = out.getContext("2d");
  const grow = Math.max(3, Math.round(Math.max(W, H) / 150));
  o.filter = `blur(${grow}px)`; o.drawImage(mc, 0, 0, W, H); o.filter = "none";
  const d = o.getImageData(0, 0, W, H); for (let i = 3; i < d.data.length; i += 4) d.data[i] = d.data[i] > 20 ? 255 : 0; o.putImageData(d, 0, 0);
  return out;
}
const CLUTTER = new Set(["bottle", "cup", "wine glass", "backpack", "handbag", "suitcase", "umbrella", "chair", "bench", "car", "truck", "bus",
  "bicycle", "motorcycle", "traffic light", "fire hydrant", "stop sign", "parking meter", "bird", "potted plant", "trash can", "remote", "tv", "laptop"]);
// Distractions: { label, x, y, w, h } (0..1). People much smaller than the main subject, and clutter
// that doesn't overlap the main subject (so a cup in her hand stays).
async function findDistractions(src) {
  const [det, img] = await Promise.all([objectFinder(), loadImg(src)]);
  const c = canvasFor(img, 1024); c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
  const W = c.width, H = c.height, list = (det.detect(c).detections || []).map((d) => {
    const b = d.boundingBox, cat = (d.categories && d.categories[0]) || {};
    return { label: cat.categoryName || "", score: cat.score || 0, x: b.originX / W, y: b.originY / H, w: b.width / W, h: b.height / H };
  });
  const people = list.filter((d) => d.label === "person").sort((a, b) => b.w * b.h - a.w * a.h);
  const main = people[0], area = (d) => d.w * d.h;
  const overlap = (a, b) => { const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)), iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)); return (ix * iy) / Math.max(1e-6, area(a)); };
  // Everyone about as big as the main subject is part of the photo (a couple, a group).
  const keep = people.filter((p) => main && area(p) >= area(main) * 0.35);
  return list.filter((d) => d.score >= 0.35 && !keep.includes(d) && (d.label === "person" || CLUTTER.has(d.label))
    && !keep.some((k) => overlap(d, k) > 0.5) && area(d) < 0.3);
}
// A box as a mask: the selected outline at its middle, or the box itself if that finds nothing.
async function distractionMask(src, d) {
  try {
    const m = await magicSelect(src, d.x + d.w / 2, d.y + d.h / 2);
    return m;
  } catch {
    const img = await loadImg(src), W = img.naturalWidth, H = img.naturalHeight, c = newCanvas(W, H), x = c.getContext("2d");
    x.fillStyle = "#fff"; x.fillRect(d.x * W, d.y * H, d.w * W, d.h * H); return c;
  }
}

// ---------- Cutout quality ----------
// The segmenter's mask is coarse (256 px). It is refined against the photo itself with a guided
// filter, so the edge follows the real outline (hair strands, shoulders) instead of a blocky,
// blurred guess, and the old background's color is taken out of the edge pixels so no halo is left.
function boxSum(src, w, h, r) {   // mean over a (2r+1)² window, via a summed-area table
  const S = new Float64Array((w + 1) * (h + 1)), out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) { let row = 0; for (let x = 0; x < w; x++) { row += src[y * w + x]; S[(y + 1) * (w + 1) + x + 1] = S[y * (w + 1) + x + 1] + row; } }
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1);
      out[y * w + x] = (S[y1 * (w + 1) + x1] - S[y0 * (w + 1) + x1] - S[y1 * (w + 1) + x0] + S[y0 * (w + 1) + x0]) / ((y1 - y0) * (x1 - x0));
    }
  }
  return out;
}
function guided(I, p, w, h, r, eps) {
  const n = w * h, Ip = new Float32Array(n), II = new Float32Array(n);
  for (let i = 0; i < n; i++) { Ip[i] = I[i] * p[i]; II[i] = I[i] * I[i]; }
  const mI = boxSum(I, w, h, r), mp = boxSum(p, w, h, r), mIp = boxSum(Ip, w, h, r), mII = boxSum(II, w, h, r);
  const A = new Float32Array(n), B = new Float32Array(n);
  for (let i = 0; i < n; i++) { const a = (mIp[i] - mI[i] * mp[i]) / (mII[i] - mI[i] * mI[i] + eps); A[i] = a; B[i] = mp[i] - a * mI[i]; }
  const mA = boxSum(A, w, h, r), mB = boxSum(B, w, h, r), q = new Float32Array(n);
  for (let i = 0; i < n; i++) q[i] = Math.max(0, Math.min(1, mA[i] * I[i] + mB[i]));
  return q;
}
// The subject's alpha (0–1 per pixel) at the canvas's size.
const matteCache = new Map();
let cutoutCache = {};
async function matte(src, c) {
  const key = src + "|" + c.width;
  if (matteCache.has(key)) return matteCache.get(key);
  // A photo that is already cut out (an HD cutout, or a transparent PNG) keeps its own edges.
  const own = c.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, c.width, c.height).data;
  let clear = 0; for (let i = 3; i < own.length; i += 4 * 7) if (own[i] < 250) clear++;
  if (clear > own.length / (4 * 7) * 0.02) {
    const alpha = new Float32Array(c.width * c.height);
    for (let i = 0; i < alpha.length; i++) alpha[i] = own[i * 4 + 3] / 255;
    matteCache.set(key, alpha); return alpha;
  }
  const seg = await segmenter();
  const result = seg.segment(detectCopy(c));
  const m = result.confidenceMasks[0], conf = m.getAsFloat32Array();
  const mc = newCanvas(m.width, m.height), mctx = mc.getContext("2d"), px = mctx.createImageData(m.width, m.height);
  for (let i = 0; i < conf.length; i++) { px.data[i * 4] = px.data[i * 4 + 1] = px.data[i * 4 + 2] = Math.max(0, Math.min(255, ((conf[i] - 0.2) / 0.6) * 255)); px.data[i * 4 + 3] = 255; }
  mctx.putImageData(px, 0, 0);
  if (result.close) result.close();
  // Work at up to 1400 px, then scale the alpha back up smoothly.
  const k = Math.min(1, 1400 / Math.max(c.width, c.height)), w = Math.round(c.width * k), h = Math.round(c.height * k);
  const g = newCanvas(w, h), gx = g.getContext("2d", { willReadFrequently: true });
  gx.drawImage(c, 0, 0, w, h); const gd = gx.getImageData(0, 0, w, h).data;
  gx.imageSmoothingQuality = "high"; gx.drawImage(mc, 0, 0, w, h); const md = gx.getImageData(0, 0, w, h).data;
  const I = new Float32Array(w * h), p = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) { I[i] = lum(gd[i * 4], gd[i * 4 + 1], gd[i * 4 + 2]) / 255; p[i] = md[i * 4] / 255; }
  // Two passes: a wide one to snap the outline, a fine one for hair.
  let q = guided(I, p, w, h, Math.max(6, Math.round(w / 90)), 1e-3);
  q = guided(I, q, w, h, Math.max(2, Math.round(w / 300)), 4e-4);
  const ac = newCanvas(w, h), ax = ac.getContext("2d"), ad = ax.createImageData(w, h);
  for (let i = 0; i < w * h; i++) { const a = smoothstep(0.08, 0.92, q[i]); ad.data[i * 4 + 3] = Math.round(a * 255); }
  ax.putImageData(ad, 0, 0);
  const out = newCanvas(c.width, c.height), ox = out.getContext("2d", { willReadFrequently: true });
  ox.imageSmoothingQuality = "high"; ox.drawImage(ac, 0, 0, c.width, c.height);
  const ab = ox.getImageData(0, 0, c.width, c.height).data, alpha = new Float32Array(c.width * c.height);
  for (let i = 0; i < alpha.length; i++) alpha[i] = ab[i * 4 + 3] / 255;
  matteCache.set(key, alpha); if (matteCache.size > 3) matteCache.delete(matteCache.keys().next().value);
  return alpha;
}
// The photo's background with the subject removed and filled from the background around it
// (a blur that ignores the subject's pixels), so nothing of her bleeds into it.
function cleanBackground(c, alpha, radius) {
  const W = c.width, H = c.height, t = newCanvas(W, H), tx = t.getContext("2d", { willReadFrequently: true });
  tx.drawImage(c, 0, 0); const d = tx.getImageData(0, 0, W, H);
  for (let i = 0; i < alpha.length; i++) d.data[i * 4 + 3] = Math.round((1 - alpha[i]) ** 2 * 255);
  tx.putImageData(d, 0, 0);
  const b = newCanvas(W, H), bx = b.getContext("2d", { willReadFrequently: true });
  drawWith(bx, `blur(${Math.max(2, Math.round(radius))}px)`, (y) => y.drawImage(t, 0, 0));
  const bd = bx.getImageData(0, 0, W, H);   // un-premultiplied: the average of the background only
  for (let i = 0; i < alpha.length; i++) bd.data[i * 4 + 3] = 255;
  bx.putImageData(bd, 0, 0);
  return b;
}
// The subject alone, with the old background's color taken out of her edge pixels.
function subjectLayer(c, alpha) {
  const W = c.width, H = c.height, B = cleanBackground(c, alpha, Math.max(W, H) / 60).getContext("2d").getImageData(0, 0, W, H).data;
  const x = c.getContext("2d", { willReadFrequently: true }), d = x.getImageData(0, 0, W, H), D = d.data;
  for (let i = 0; i < alpha.length; i++) {
    const a = alpha[i], j = i * 4;
    if (a > 0.02 && a < 0.98) for (let ch = 0; ch < 3; ch++) D[j + ch] = Math.max(0, Math.min(255, (D[j + ch] - (1 - a) * B[j + ch]) / a));
    D[j + 3] = Math.round(a * 255) * (D[j + 3] / 255);
  }
  const out = newCanvas(W, H); out.getContext("2d").putImageData(d, 0, 0);
  return out;
}
async function cutout(src) {
  if (cutoutCache[src]) return cutoutCache[src];
  const img = await loadImg(src), c = canvasFor(img), ctx = c.getContext("2d");
  ctx.drawImage(img, 0, 0, c.width, c.height);
  return (cutoutCache[src] = subjectLayer(c, await matte(src, c)).toDataURL("image/png"));
}

// Face retouch: MediaPipe finds 478 points on each face, on the phone, and the
// tools below reshape or touch up just those areas. Free and private.
const FACE_MODEL = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";
let faceFinderPromise = null;
function faceFinder() {
  if (!faceFinderPromise) faceFinderPromise = (async () => {
    const { vision, fileset } = await visionLib();
    return vision.FaceLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: native ? "vendor/face_landmarker.task" : FACE_MODEL }, runningMode: "IMAGE", numFaces: 8,
    });
  })().catch(() => { faceFinderPromise = null; throw new Error("Couldn't load the face tools. Check your connection and try again."); });
  return faceFinderPromise;
}

const FACE = {
  oval: [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109],
  eyeL: [33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246],
  eyeR: [362, 382, 381, 380, 374, 373, 390, 249, 263, 466, 388, 387, 386, 385, 384, 398],
  browL: [70, 63, 105, 66, 107, 55, 65, 52, 53, 46],
  browR: [300, 293, 334, 296, 336, 285, 295, 282, 283, 276],
  lipsOut: [61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 409, 270, 269, 267, 0, 37, 39, 40, 185],
  lipsIn: [78, 95, 88, 178, 87, 14, 317, 402, 318, 324, 308, 415, 310, 311, 312, 13, 82, 81, 80, 191],
  jaw: [132, 172, 150, 361, 397, 379],
};
// Upper eyelids, from the inner corner to the outer corner.
const UPPER_L = [133, 173, 157, 158, 159, 160, 161, 246, 33], UPPER_R = [362, 398, 384, 385, 386, 387, 388, 466, 263];
// Curated shades per tool (a range for fair, medium and deep skin). Any other color can be
// chosen with the color picker; those are kept per tool in faceSet.custom.
const SHADES = {
  flips: ["#b5485d", "#c2185b", "#e0565b", "#d4787d", "#c48a7a", "#a0522d", "#c0392b", "#8e2443", "#6d2b3d"],
  fblush: ["#ff7f98", "#ff9a8b", "#e86a8a", "#f4a28c", "#c2496b", "#d9826b"],
  fbrows: ["#3b2a20", "#5a4030", "#7a6a5c", "#9a6a45", "#1c1a1a"],
  fshadow: ["#b07a6a", "#8a5a3c", "#c9a46a", "#3a3036", "#8c5a8f", "#5a6d8a", "#d49a9a", "#4f6b4a"],
  fliner: ["#111111", "#3b2a20", "#1f2d55", "#3d5a3a", "#5a2a4a"],
  flashes: ["#141012", "#3b2a20", "#1f2d55"],
  feyecolor: ["#7a5a2e", "#4f7a45", "#4a78b5", "#7d8a96", "#b07a2a", "#2f5f6a", "#6c4fa0"],
  fcontour: ["#7a5240", "#5e3d30", "#8a6a5a"],
  fhighlight: ["#fff1dc", "#ffe0e6", "#f3d9a8"],
  fbronzer: ["#b9734a", "#a85f3a", "#c98a5c"],
  hcolor: ["#8d3b1f", "#b5562a", "#c9a063", "#6b5a4e", "#1b1714", "#d97a9b", "#9b84c9"],
};
// Style choices per tool: [label, value]; the first is the default.
const STYLES = {
  fblemish: [["Keep freckles", "keep"], ["Freckles too", "all"]],
  flips: [["Satin", "satin"], ["Matte", "matte"], ["Gloss", "gloss"], ["Shimmer", "shimmer"], ["Ombré", "ombre"]],
  fblush: [["Apples", "apples"], ["Lifted", "lifted"], ["Sun-kissed", "sun"]],
  fbrows: [["Natural", "natural"], ["Soft", "soft"], ["Bold", "bold"]],
  fshadow: [["Soft", "soft"], ["Smokey", "smokey"], ["Shimmer", "shimmer"], ["Halo", "halo"]],
  fliner: [["Wing", "wing"], ["Classic", "classic"], ["Cat eye", "cat"], ["Smudged", "smudge"], ["Tightline", "tight"]],
  flashes: [["Natural", "natural"], ["Volume", "volume"], ["Wispy", "wispy"], ["Doll", "doll"]],
  fskin: [["Matte", "matte"], ["Dewy glow", "dewy"]],
  fglam: [["Natural", "natural"], ["Clean girl", "clean"], ["Soft glam", "soft"], ["Latte", "latte"], ["Date night", "night"],
    ["Bold red", "red"], ["Bridal", "bridal"], ["My look", "mine"]],
};
// The Looks: each is a list of [tool, strength, shade, style], scaled by the Looks slider.
const LOOKS = {
  natural: [["fblemish", 0.6, null, "keep"], ["fundereye", 0.5], ["fbrows", 0.5, "#5a4030", "natural"], ["flashes", 0.45, "#3b2a20", "natural"],
    ["fblush", 0.35, "#f4a28c", "apples"], ["flips", 0.35, "#d4787d", "satin"]],
  clean: [["fskin", 0.6, null, "dewy"], ["fbrows", 0.6, "#5a4030", "soft"], ["flashes", 0.5, "#3b2a20", "natural"], ["fhighlight", 0.4, "#fff1dc"],
    ["fblush", 0.4, "#ff9a8b", "lifted"], ["flips", 0.45, "#c48a7a", "gloss"]],
  soft: [["fblemish", 0.7, null, "keep"], ["ftone", 0.5], ["fbrows", 0.7, "#3b2a20", "natural"], ["fshadow", 0.6, "#b07a6a", "soft"],
    ["fliner", 0.5, "#3b2a20", "wing"], ["flashes", 0.7, "#141012", "volume"], ["fcontour", 0.45, "#7a5240"], ["fhighlight", 0.45, "#fff1dc"],
    ["fblush", 0.45, "#e86a8a", "lifted"], ["flips", 0.55, "#b5485d", "satin"]],
  latte: [["fbronzer", 0.6, "#b9734a"], ["fshadow", 0.6, "#8a5a3c", "soft"], ["fliner", 0.5, "#3b2a20", "smudge"], ["flashes", 0.6, "#3b2a20", "wispy"],
    ["fcontour", 0.4, "#7a5240"], ["fblush", 0.3, "#d9826b", "sun"], ["flips", 0.55, "#a0522d", "satin"]],
  night: [["fshadow", 0.8, "#3a3036", "smokey"], ["fliner", 0.7, "#111111", "wing"], ["flashes", 0.9, "#141012", "volume"], ["fcontour", 0.5, "#5e3d30"],
    ["fhighlight", 0.4, "#fff1dc"], ["fblush", 0.35, "#c2496b", "lifted"], ["flips", 0.6, "#8e2443", "satin"]],
  red: [["fblemish", 0.6, null, "keep"], ["ftone", 0.5], ["fbrows", 0.6, "#3b2a20", "natural"], ["fliner", 0.8, "#111111", "cat"],
    ["flashes", 0.8, "#141012", "volume"], ["fhighlight", 0.35, "#fff1dc"], ["fblush", 0.25, "#e0565b", "lifted"], ["flips", 0.75, "#c0392b", "matte"]],
  bridal: [["fblemish", 0.7, null, "keep"], ["ftone", 0.5], ["fskin", 0.5, null, "dewy"], ["fbrows", 0.6, "#5a4030", "soft"],
    ["fshadow", 0.45, "#d49a9a", "shimmer"], ["fliner", 0.4, "#3b2a20", "classic"], ["flashes", 0.8, "#141012", "doll"],
    ["fhighlight", 0.5, "#fff1dc"], ["fblush", 0.45, "#ff7f98", "apples"], ["flips", 0.5, "#d4787d", "satin"]],
};
// Tools that count as makeup for "Save my look".
const MAKEUP_TOOLS = ["flips", "fblush", "fbrows", "fshadow", "fliner", "flashes", "feyecolor", "fcontour", "fhighlight", "fbronzer", "fskin", "ftone"];
const FACE_DEFAULTS = { fauto: 50, fsmooth: 50, fblemish: 60, fundereye: 50, fteeth: 50, feyes: 40, fbigeyes: 35, fslim: 35, fnose: 35, flips: 45, fblush: 40,
  fbrows: 45, fshadow: 45, fliner: 50, fglam: 60, flashes: 55, feyecolor: 60, fcontour: 40, fhighlight: 45, fbronzer: 35, fskin: 50, ftone: 50,
  bwaist: 45, bhips: 40, barms: 40, bslimlegs: 40, blegs: 40, bposture: 60, btailor: 50, hcolor: 60 };
let faceSet = { amt: { ...FACE_DEFAULTS }, shade: Object.fromEntries(Object.entries(SHADES).map(([k, v]) => [k, v[0]])),
  style: {}, custom: {}, mine: null };
const STYLE_DEFAULTS = Object.fromEntries(Object.entries(STYLES).map(([k, v]) => [k, v[0][1]]));
Object.assign(faceSet.style, STYLE_DEFAULTS);
try { const s = JSON.parse(store.get("glowFace") || "{}"); Object.assign(faceSet.amt, s.amt); Object.assign(faceSet.shade, s.shade); } catch {}

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const mean = (pts) => [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const smoothstep = (a, b, v) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };
function newCanvas(w, h) { const c = document.createElement("canvas"); c.width = w; c.height = h; return c; }
function tracePoly(ctx, pts) { ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); }
// Canvas filters (blur, brightness, contrast, saturate...) are not in every browser: Safari and
// some phone web views ignore ctx.filter, which would leave every mask hard-edged and every
// soft layer sharp, so edits would show lines and patches. drawWith() draws through the filter
// when the browser has it, and otherwise draws to a layer and applies the same filter here.
const FILTER_OK = (() => { try { const x = document.createElement("canvas").getContext("2d"); x.filter = "blur(2px)"; return x.filter === "blur(2px)"; } catch { return false; } })();
function drawWith(ctx, f, draw) {
  if (!f || f === "none") { draw(ctx); return; }
  if (FILTER_OK && !globalThis.__glowSoftFilter) { ctx.filter = f; draw(ctx); ctx.filter = "none"; return; }
  const layer = newCanvas(ctx.canvas.width, ctx.canvas.height), lx = layer.getContext("2d", { willReadFrequently: true });
  for (const k of ["fillStyle", "strokeStyle", "lineWidth", "lineCap", "lineJoin"]) lx[k] = ctx[k];
  draw(lx);
  softFilter(lx, f);
  ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(layer, 0, 0); ctx.restore();
}
// The CSS filter functions Glow Studio uses, done on the pixels (premultiplied blur, as browsers do).
function softFilter(x, f) {
  const W = x.canvas.width, H = x.canvas.height, img = x.getImageData(0, 0, W, H), d = img.data;
  for (const [, name, arg] of f.matchAll(/([a-z-]+)\(([^)]*)\)/g)) {
    const v = parseFloat(arg);
    if (name === "blur") { boxBlurRGBA(d, W, H, v); continue; }
    let m = null;   // a 3×3 color matrix, plus an offset for contrast
    let off = 0;
    if (name === "brightness") m = [v, 0, 0, 0, v, 0, 0, 0, v];
    else if (name === "contrast") { m = [v, 0, 0, 0, v, 0, 0, 0, v]; off = 127.5 * (1 - v); }
    else if (name === "saturate" || name === "grayscale") {
      const s = name === "saturate" ? v : 1 - Math.min(1, v);
      m = [0.213 + 0.787 * s, 0.715 - 0.715 * s, 0.072 - 0.072 * s, 0.213 - 0.213 * s, 0.715 + 0.285 * s, 0.072 - 0.072 * s, 0.213 - 0.213 * s, 0.715 - 0.715 * s, 0.072 + 0.928 * s];
    } else if (name === "sepia") {
      const k = 1 - Math.min(1, v);
      m = [0.393 + 0.607 * k, 0.769 - 0.769 * k, 0.189 - 0.189 * k, 0.349 - 0.349 * k, 0.686 + 0.314 * k, 0.168 - 0.168 * k, 0.272 - 0.272 * k, 0.534 - 0.534 * k, 0.131 + 0.869 * k];
    } else if (name === "hue-rotate") {
      const a = (v * Math.PI) / 180, c = Math.cos(a), sn = Math.sin(a);
      m = [0.213 + c * 0.787 - sn * 0.213, 0.715 - c * 0.715 - sn * 0.715, 0.072 - c * 0.072 + sn * 0.928,
        0.213 - c * 0.213 + sn * 0.143, 0.715 + c * 0.285 + sn * 0.14, 0.072 - c * 0.072 - sn * 0.283,
        0.213 - c * 0.213 - sn * 0.787, 0.715 - c * 0.715 + sn * 0.715, 0.072 + c * 0.928 + sn * 0.072];
    }
    if (!m) continue;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i], g = d[i + 1], b = d[i + 2];
      d[i] = m[0] * r + m[1] * g + m[2] * b + off; d[i + 1] = m[3] * r + m[4] * g + m[5] * b + off; d[i + 2] = m[6] * r + m[7] * g + m[8] * b + off;
    }
  }
  x.putImageData(img, 0, 0);
}
// A Gaussian blur of standard deviation `sigma`, as three box blurs, on premultiplied RGBA.
function boxBlurRGBA(d, W, H, sigma) {
  if (!(sigma > 0.3)) return;
  const n = W * H, ch = [0, 1, 2, 3].map(() => new Float32Array(n)), tmp = new Float32Array(Math.max(W, H));
  for (let i = 0; i < n; i++) { const a = d[i * 4 + 3] / 255; ch[3][i] = a; for (let k = 0; k < 3; k++) ch[k][i] = d[i * 4 + k] * a; }
  const r = Math.max(1, Math.round((Math.sqrt(4 * sigma * sigma + 1) - 1) / 2));   // three passes of width 2r+1 ≈ the Gaussian
  const pass = (a, len, count, step, stride) => {
    for (let line = 0; line < count; line++) {
      const o = line * stride;
      for (let rep = 0; rep < 3; rep++) {
        let sum = 0;
        for (let k = -r; k <= r; k++) sum += a[o + Math.min(len - 1, Math.max(0, k)) * step];
        for (let j = 0; j < len; j++) {
          tmp[j] = sum / (2 * r + 1);
          sum += a[o + Math.min(len - 1, j + r + 1) * step] - a[o + Math.max(0, j - r) * step];
        }
        for (let j = 0; j < len; j++) a[o + j * step] = tmp[j];
      }
    }
  };
  for (const a of ch) { pass(a, W, H, 1, W); pass(a, H, W, W, 1); }
  for (let i = 0; i < n; i++) {
    const a = ch[3][i]; d[i * 4 + 3] = a * 255;
    for (let k = 0; k < 3; k++) d[i * 4 + k] = a > 0.001 ? ch[k][i] / a : 0;
  }
}
// A soft-edged white-on-transparent mask.
function softMask(w, h, feather, draw) {
  const m = newCanvas(w, h), ctx = m.getContext("2d", { willReadFrequently: true });
  ctx.fillStyle = "#fff";
  drawWith(ctx, `blur(${Math.max(1, Math.round(feather))}px)`, draw); return m;
}
// Paints `layer` onto ctx only where the mask is white.
function blendMasked(ctx, layer, mask, alpha) {
  const t = newCanvas(layer.width, layer.height), tc = t.getContext("2d");
  tc.drawImage(layer, 0, 0); tc.globalCompositeOperation = "destination-in"; tc.drawImage(mask, 0, 0);
  ctx.save(); ctx.globalAlpha = clamp01(alpha); ctx.drawImage(t, 0, 0); ctx.restore();
}
function filtered(src, f) { const c = newCanvas(src.width, src.height), x = c.getContext("2d", { willReadFrequently: true }); drawWith(x, f, (y) => y.drawImage(src, 0, 0)); return c; }
function box(c, cx, cy, r) {
  const x0 = Math.max(0, Math.floor(cx - r)), y0 = Math.max(0, Math.floor(cy - r));
  return { x0, y0, w: Math.min(c.width, Math.ceil(cx + r)) - x0, h: Math.min(c.height, Math.ceil(cy + r)) - y0 };
}

// Warps pixels around `c` (radius r). `map(dx, dy, d)` returns where each pixel
// should be read from, relative to c. Bilinear sampling keeps it smooth.
function warp(ctx, c, r, map) {
  const b = box(ctx.canvas, c[0], c[1], r); if (b.w < 2 || b.h < 2) return;
  const src = ctx.getImageData(b.x0, b.y0, b.w, b.h), out = ctx.createImageData(b.w, b.h), s = src.data, o = out.data;
  for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) {
    const dx = b.x0 + x - c[0], dy = b.y0 + y - c[1], d = Math.hypot(dx, dy), i = (y * b.w + x) * 4;
    let sx = x, sy = y;
    if (d < r) { const [mx, my] = map(dx, dy, d); sx = mx + c[0] - b.x0; sy = my + c[1] - b.y0; }
    sx = Math.max(0, Math.min(b.w - 1.001, sx)); sy = Math.max(0, Math.min(b.h - 1.001, sy));
    const x1 = sx | 0, y1 = sy | 0, fx = sx - x1, fy = sy - y1, j = (y1 * b.w + x1) * 4, k = j + b.w * 4;
    for (let ch = 0; ch < 4; ch++) {
      o[i + ch] = (s[j + ch] * (1 - fx) + s[j + 4 + ch] * fx) * (1 - fy) + (s[k + ch] * (1 - fx) + s[k + 4 + ch] * fx) * fy;
    }
  }
  ctx.putImageData(out, b.x0, b.y0);
}
// Magnify (s > 0) the area around c, fading out to nothing at radius r.
function bulge(ctx, c, r, s) {
  warp(ctx, c, r, (dx, dy, d) => { const t = 1 - (d / r) ** 2, k = 1 - s * t * t; return [dx * k, dy * k]; });
}
// Push the area around c by vector m (a liquify stroke).
function push(ctx, c, r, m) {
  const mm = m[0] * m[0] + m[1] * m[1];
  warp(ctx, c, r, (dx, dy, d) => { const e = ((r * r - d * d) / (r * r - d * d + mm)) ** 2; return [dx - e * m[0], dy - e * m[1]]; });
}

// ---------- Face reshape: Eye size, Face shape, Nose ----------
// Each tool builds one smooth displacement field per face and moves every pixel once.
// A field says, for each output pixel, how far away its colour is read from. The fields
// fade to exactly zero at the edge of their area (so there is no seam), and they change
// slowly enough that neighbouring pixels never cross (so nothing folds, doubles or tears).
// The slider's 0–100 maps onto the gentle ranges below; 0 leaves the photo untouched.
const RESHAPE_MAX = { fslim: 0.1, fnose: 0.2, fbigeyes: 0.13 };
const RESHAPE_TOOLS = Object.keys(RESHAPE_MAX);

// Applies `field(x, y)` -> [dx, dy] or null inside box `bx`, in strips so a full-size photo
// never needs one huge pixel buffer. `maxD` is the largest offset the field returns.
function fieldWarp(ctx, bx, maxD, field) {
  if (bx.w < 2 || bx.h < 2) return;
  const W = ctx.canvas.width, H = ctx.canvas.height, m = Math.ceil(maxD) + 2, STRIP = 256;
  const dst = newCanvas(bx.w, bx.h), dctx = dst.getContext("2d");
  for (let y0 = bx.y0; y0 < bx.y0 + bx.h; y0 += STRIP) {
    const h = Math.min(STRIP, bx.y0 + bx.h - y0);
    const sx0 = Math.max(0, bx.x0 - m), sy0 = Math.max(0, y0 - m), sw = Math.min(W, bx.x0 + bx.w + m) - sx0, sh = Math.min(H, y0 + h + m) - sy0;
    const s = ctx.getImageData(sx0, sy0, sw, sh).data, out = dctx.createImageData(bx.w, h), o = out.data;
    for (let y = 0; y < h; y++) for (let x = 0; x < bx.w; x++) {
      const X = bx.x0 + x, Y = y0 + y, i = (y * bx.w + x) * 4, f = field(X, Y);
      let sx = X - sx0, sy = Y - sy0;
      if (f) { sx = Math.max(0, Math.min(sw - 1.001, sx + f[0])); sy = Math.max(0, Math.min(sh - 1.001, sy + f[1])); }
      const x1 = sx | 0, y1 = sy | 0, fx = sx - x1, fy = sy - y1, j = (y1 * sw + x1) * 4, k = j + sw * 4;
      if (!fx && !fy) { o[i] = s[j]; o[i + 1] = s[j + 1]; o[i + 2] = s[j + 2]; o[i + 3] = s[j + 3]; continue; }
      for (let ch = 0; ch < 4; ch++) o[i + ch] = (s[j + ch] * (1 - fx) + s[j + 4 + ch] * fx) * (1 - fy) + (s[k + ch] * (1 - fx) + s[k + 4 + ch] * fx) * fy;
    }
    dctx.putImageData(out, 0, y0 - bx.y0);
  }
  ctx.clearRect(bx.x0, bx.y0, bx.w, bx.h); ctx.drawImage(dst, bx.x0, bx.y0);
}
// A face-aligned frame: x runs across the face, y down it (from `o` toward `p`), so tilted
// heads are handled the same as upright ones.
function faceAxes(o, p) {
  const L = dist(o, p), d = [(p[0] - o[0]) / L, (p[1] - o[1]) / L], a = [d[1], -d[0]];
  return { o, L, a, d,
    to: (x, y) => { const rx = x - o[0], ry = y - o[1]; return [rx * a[0] + ry * a[1], rx * d[0] + ry * d[1]]; },
    back: (u, v) => [u * a[0] + v * d[0], u * a[1] + v * d[1]],
    // The image box around frame rectangle u0..u1 × v0..v1.
    box(ctx, u0, u1, v0, v1) {
      const cs = [[u0, v0], [u1, v0], [u0, v1], [u1, v1]].map(([u, v]) => { const q = this.back(u, v); return [q[0] + o[0], q[1] + o[1]]; });
      const xs = cs.map((c) => c[0]), ys = cs.map((c) => c[1]), W = ctx.canvas.width, H = ctx.canvas.height;
      const x0 = Math.max(0, Math.floor(Math.min(...xs))), y0 = Math.max(0, Math.floor(Math.min(...ys)));
      return { x0, y0, w: Math.min(W, Math.ceil(Math.max(...xs)) + 1) - x0, h: Math.min(H, Math.ceil(Math.max(...ys)) + 1) - y0 };
    } };
}
// Bell profiles: 0 at t=0, 1 at t=1, back to 0 at t=out, with zero slope at all three.
const bell = (t, out) => (t < 1 ? smoothstep(0, 1, t) : 1 - smoothstep(1, out, t));

// Face shape: narrows the lower cheeks and jaw toward the face's centre line. Strongest
// along the jaw, gentler at the chin, nothing at the cheekbones or below the neck. Each
// side follows its own outline, so a turned face narrows naturally on both sides.
function slimField(ctx, P, s) {
  const F = faceAxes(P[168], P[152]), oval = FACE.oval.map((i) => { const [u, v] = F.to(...P[i]); return [u, v / F.L]; });
  const V0 = -0.4, STEP = 0.02, N = 101, side = [new Float64Array(N), new Float64Array(N)];
  for (let k = 0; k < N; k++) {
    const v = V0 + k * STEP;
    oval.forEach((p, n) => {
      const q = oval[(n + 1) % oval.length];
      if ((p[1] - v) * (q[1] - v) > 0 || p[1] === q[1]) return;
      const u = p[0] + ((v - p[1]) / (q[1] - p[1])) * (q[0] - p[0]);
      if (u < 0) side[0][k] = Math.max(side[0][k], -u); else side[1][k] = Math.max(side[1][k], u);
    });
  }
  const jaw = side.map((t) => Math.max(...t.slice(Math.round((0.3 - V0) / STEP), Math.round((0.8 - V0) / STEP))));
  if (!(jaw[0] > 0 && jaw[1] > 0)) return null;
  // Never narrower than half the jaw (the chin tip and the neck), then smoothed twice.
  side.forEach((t, n) => { for (let k = 0; k < N; k++) t[k] = Math.max(t[k], jaw[n] * 0.5); for (let r = 0; r < 2; r++) boxBlur1(t, 3); });
  const hwAt = (t, v) => { const k = Math.max(0, Math.min(N - 1.001, (v - V0) / STEP)), i = k | 0; return t[i] + (t[i + 1] - t[i]) * (k - i); };
  const fv = (v) => smoothstep(0.12, 0.6, v) * (1 - 0.55 * smoothstep(0.75, 1, v)) * (1 - smoothstep(1, 1.35, v));
  const reach = 1.7, maxW = Math.max(...jaw) * 1.2;
  return {
    box: F.box(ctx, -reach * maxW, reach * maxW, 0.12 * F.L, 1.35 * F.L), maxD: s * maxW,
    at(x, y) {
      const [u, vp] = F.to(x, y), v = vp / F.L;
      if (v <= 0.12 || v >= 1.35) return null;
      const hw = hwAt(side[u < 0 ? 0 : 1], v), t = Math.abs(u) / hw;
      if (t >= reach) return null;
      const b = Math.sign(u) * s * hw * fv(v) * bell(t, reach); // read from further out
      return b ? [b * F.a[0], b * F.a[1]] : null;
    } };
}
function boxBlur1(t, r) {
  const c = Float64Array.from(t);
  for (let k = 0; k < t.length; k++) { let sum = 0, n = 0; for (let j = k - r; j <= k + r; j++) if (j >= 0 && j < t.length) { sum += c[j]; n++; } t[k] = sum / n; }
}
// Nose: narrows the nostril wings toward the nose's centre line, with a lighter touch up
// the bridge, fading out before the inner eye corners, the cheeks and the upper lip.
function noseField(ctx, P, s) {
  const F = faceAxes(P[168], P[2]), wing = [129, 358, 64, 294, 49, 279, 48, 278, 98, 327, 102, 331];
  const w = [0, 0]; let vAla = 0;
  for (const i of wing) { const [u, v] = F.to(...P[i]); w[u < 0 ? 0 : 1] = Math.max(w[u < 0 ? 0 : 1], Math.abs(u)); }
  for (const i of [129, 358, 64, 294]) vAla += F.to(...P[i])[1] / F.L / 4;
  if (!(w[0] > 0 && w[1] > 0)) return null;
  const vLip = F.to(...P[0])[1] / F.L, vEnd = Math.max(vLip, vAla + 0.3), reach = 2;
  const fv = (v) => smoothstep(-0.25, vAla, v) * (1 - smoothstep(vAla, vEnd, v));
  const maxW = Math.max(...w);
  return {
    box: F.box(ctx, -reach * maxW, reach * maxW, -0.25 * F.L, vEnd * F.L), maxD: s * maxW,
    at(x, y) {
      const [u, vp] = F.to(x, y), v = vp / F.L;
      if (v <= -0.25 || v >= vEnd) return null;
      const hw = w[u < 0 ? 0 : 1] * (0.6 + 0.4 * smoothstep(0, vAla, v)), t = Math.abs(u) / hw;
      if (t >= reach) return null;
      const b = Math.sign(u) * s * hw * fv(v) * bell(t, reach);
      return b ? [b * F.a[0], b * F.a[1]] : null;
    } };
}
// Eye size: a gentle magnify inside an oval that follows the eye's tilt. The oval stops
// short of the brow, and the effect fades smoothly to nothing at its edge.
function eyeField(ctx, P, s) {
  const parts = [[FACE.eyeL, FACE.browL], [FACE.eyeR, FACE.browR]].map(([eye, brow]) => {
    const c = mean(eye.map((i) => P[i])), A = P[eye[0]], B = P[eye[8]], ew = dist(A, B);
    const e = [(B[0] - A[0]) / ew, (B[1] - A[1]) / ew], gap = dist(c, mean(brow.map((i) => P[i])));
    return { c, e, ra: ew * 0.95, rb: Math.min(ew * 0.8, gap * 0.85) };
  });
  const xs = parts.flatMap((p) => [p.c[0] - p.ra, p.c[0] + p.ra]), ys = parts.flatMap((p) => [p.c[1] - p.ra, p.c[1] + p.ra]);
  const W = ctx.canvas.width, H = ctx.canvas.height, x0 = Math.max(0, Math.floor(Math.min(...xs))), y0 = Math.max(0, Math.floor(Math.min(...ys)));
  return {
    box: { x0, y0, w: Math.min(W, Math.ceil(Math.max(...xs)) + 1) - x0, h: Math.min(H, Math.ceil(Math.max(...ys)) + 1) - y0 },
    maxD: s * Math.max(...parts.map((p) => p.ra)) * 0.4,
    at(x, y) {
      for (const p of parts) {
        const dx = x - p.c[0], dy = y - p.c[1], u = dx * p.e[0] + dy * p.e[1], v = -dx * p.e[1] + dy * p.e[0];
        const r2 = (u / p.ra) ** 2 + (v / p.rb) ** 2;
        if (r2 < 1) { const g = s * (1 - r2) ** 2; return [-dx * g, -dy * g]; }
      }
      return null;
    } };
}
const RESHAPE_FIELDS = { fslim: slimField, fnose: noseField, fbigeyes: eyeField };
function reshapeFace(ctx, P, toolId, amt) {
  const s = clamp01(amt) * RESHAPE_MAX[toolId];
  if (!s) return;
  const f = RESHAPE_FIELDS[toolId](ctx, P, s);
  if (f) fieldWarp(ctx, f.box, f.maxD, (x, y) => f.at(x, y));
}
// Reshaping needs landmarks it can trust: a guessed outline would bend the wrong pixels.
// Returns why a face can't be reshaped, or "" when it can.
function reshapeProblem(P, W, H) {
  const faceW = dist(P[234], P[454]);
  if (faceW < Math.max(70, Math.min(W, H) * 0.06)) return "The face is too small in this photo to reshape well. Try a closer photo.";
  const out = FACE.oval.filter((i) => P[i][0] < -W * 0.01 || P[i][0] > W * 1.01 || P[i][1] < -H * 0.01 || P[i][1] > H * 1.01).length;
  if (out > 2) return "Part of the face is outside the photo, so it can't be reshaped safely.";
  const l = dist(P[1], P[234]), r = dist(P[1], P[454]);
  if (Math.min(l, r) / Math.max(l, r) < 0.35) return "The face is turned too far to the side to reshape safely. Try a more front-facing photo.";
  return "";
}

// Per-pixel pass inside a mask: fn(r, g, b, maskAlpha, i) edits rgb in place.
function pixelPass(ctx, mask, bx, fn) {
  const img = ctx.getImageData(bx.x0, bx.y0, bx.w, bx.h), m = mask.getContext("2d").getImageData(bx.x0, bx.y0, bx.w, bx.h).data, d = img.data;
  for (let i = 0; i < d.length; i += 4) { const a = m[i + 3] / 255; if (a > 0.01) fn(d, i, a, bx.x0 + ((i >> 2) % bx.w), bx.y0 + (((i >> 2) / bx.w) | 0)); }
  ctx.putImageData(img, bx.x0, bx.y0);
}
const lum = (r, g, b) => r * 0.3 + g * 0.59 + b * 0.11;
const rgbOf = (hex) => [1, 3, 5].map((k) => parseInt(hex.slice(k, k + 2), 16));
// A repeatable sparkle pattern (same picture at preview and at full size).
const sparkle = (x, y) => { const h = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453; return h - Math.floor(h); };
// Average brightness of the masked pixels, so a new color keeps the area's own light and texture.
function maskedMean(ctx, mask, bx) {
  const d = ctx.getImageData(bx.x0, bx.y0, bx.w, bx.h).data, m = mask.getContext("2d").getImageData(bx.x0, bx.y0, bx.w, bx.h).data;
  let s = 0, n = 0;
  for (let i = 0; i < d.length; i += 4) { const a = m[i + 3] / 255; if (a > 0.5) { s += lum(d[i], d[i + 1], d[i + 2]) * a; n += a; } }
  return n ? s / n : 128;
}
// A soft oval of color, rotated by `ang`, painted with the given blend mode.
function dab(ctx, c, rx, ry, ang, color, alpha, mode) {
  const [r, g, b] = rgbOf(color);
  ctx.save(); ctx.globalCompositeOperation = mode; ctx.globalAlpha = clamp01(alpha);
  ctx.translate(c[0], c[1]); ctx.rotate(ang); ctx.scale(1, ry / rx);
  const gr = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
  // A smooth bell-shaped falloff (many stops), so no ring shows where the gradient bends.
  for (let k = 0; k <= 10; k++) { const t = k / 10; gr.addColorStop(t, `rgba(${r},${g},${b},${(Math.exp(-3.2 * t * t) * (1 - t * t)).toFixed(3)})`); }
  ctx.fillStyle = gr; ctx.fillRect(-rx, -rx, rx * 2, rx * 2); ctx.restore();
}
// A color moved to a given brightness by mixing toward black or white, so its hue holds and no
// channel clips (scaling would turn a pink neon as it brightens).
function toneTo(r, g, b, target) {
  const l = lum(r, g, b), t = Math.max(0, Math.min(255, target));
  if (t <= l) { const k = t / Math.max(1, l); return [r * k, g * k, b * k]; }
  const k = (t - l) / Math.max(1, 255 - l); return [r + (255 - r) * k, g + (255 - g) * k, b + (255 - b) * k];
}
const norm = (v) => { const l = Math.hypot(v[0], v[1]) || 1; return [v[0] / l, v[1] / l]; };
const lerpPt = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

function faceOps(ctx, P, amt, toolId) {
  const W = ctx.canvas.width, H = ctx.canvas.height;
  const pts = (idx) => idx.map((i) => P[i]);
  const faceW = dist(P[234], P[454]), faceC = mean(pts(FACE.oval));
  const up = norm([P[10][0] - P[152][0], P[10][1] - P[152][1]]);   // forehead direction, so tilted faces work
  const eyes = [FACE.eyeL, FACE.eyeR].map((e) => ({ poly: pts(e), w: dist(P[e[0]], P[e[8]]), c: mean(pts(e)) }));
  // Irises (MediaPipe's points 468–477), when the model gave them.
  const irises = P.length >= 478 ? [468, 473].map((k) => ({ c: P[k], r: [1, 2, 3, 4].reduce((s, j) => s + dist(P[k], P[k + j]), 0) / 4 })) : [];
  const faceBox = box(ctx.canvas, faceC[0], faceC[1], faceW * 0.9);
  const ovalMask = () => softMask(W, H, faceW / 30, (m) => { tracePoly(m, pts(FACE.oval)); m.fill(); });
  const skinMask = () => softMask(W, H, faceW / 40, (m) => {
    tracePoly(m, pts(FACE.oval)); m.fill();
    m.globalCompositeOperation = "destination-out";
    for (const e of eyes) { m.beginPath(); m.ellipse(e.c[0], e.c[1], e.w * 0.75, e.w * 0.45, 0, 0, 7); m.fill(); }
    for (const br of [FACE.browL, FACE.browR]) { m.lineWidth = faceW / 22; tracePoly(m, pts(br)); m.fill(); m.strokeStyle = "#fff"; m.stroke(); }
    tracePoly(m, pts(FACE.lipsOut)); m.fill();
    m.beginPath(); m.ellipse(P[2][0], P[2][1] - faceW * 0.02, faceW * 0.09, faceW * 0.05, 0, 0, 7); m.fill(); // nostrils
  });
  const style = (id) => faceSet.style[id] || STYLES[id][0][1];
  const shade = (id) => faceSet.shade[id] || SHADES[id][0];
  // Paints soft color onto the face only (never the hair or background).
  const onFace = (paint) => {
    const layer = newCanvas(W, H), l = layer.getContext("2d");
    l.drawImage(ctx.canvas, 0, 0); paint(l);
    blendMasked(ctx, layer, ovalMask(), 1);
  };
  // The visible part of each iris: its circle, clipped by the eyelids.
  const irisMask = (grow = 1) => softMask(W, H, faceW / 300, (m) => {
    eyes.forEach((e, k) => {
      const ir = irises[k]; if (!ir) return;
      m.save(); tracePoly(m, e.poly); m.clip(); m.beginPath(); m.arc(ir.c[0], ir.c[1], ir.r * grow, 0, 7); m.fill(); m.restore();
    });
  });
  // Upper lids from inner to outer corner, with each eye's own axis and "up", so both eyes match.
  const lids = [UPPER_L, UPPER_R].map((idx, k) => {
    const lid = pts(idx), inner = lid[0], outer = lid[lid.length - 1], ew = dist(inner, outer), axis = norm([outer[0] - inner[0], outer[1] - inner[1]]);
    let n = [axis[1], -axis[0]]; if (n[0] * up[0] + n[1] * up[1] < 0) n = [-n[0], -n[1]];
    const lower = pts(k ? [263, 249, 390, 373, 374, 380, 381, 382, 362] : [33, 7, 163, 144, 145, 153, 154, 155, 133]).reverse(); // inner → outer
    const tail = mean(pts(k ? [300, 276] : [70, 46]));   // the outer end of the brow, where a wing points
    return { lid, inner, outer, ew, axis, n, lower, c: eyes[k].c, tail };
  });
  // Points along a polyline, evenly by length (t from 0 to 1).
  const along = (line, t) => {
    const seg = line.slice(1).map((p, i) => dist(line[i], p)), total = seg.reduce((a, b) => a + b, 0);
    let d = t * total;
    for (let i = 0; i < seg.length; i++) { if (d <= seg[i] || i === seg.length - 1) return lerpPt(line[i], line[i + 1], seg[i] ? Math.min(1, d / seg[i]) : 0); d -= seg[i]; }
    return line[line.length - 1];
  };

  const ops = {
    fsmooth(a) {
      // Smooth the skin, then put its fine texture back, so it never looks waxy or painted.
      const smooth = glSmooth(ctx.canvas, Math.max(1, faceW / 260)), sd = smooth.getContext("2d").getImageData(faceBox.x0, faceBox.y0, faceBox.w, faceBox.h).data;
      const fine = filtered(ctx.canvas, `blur(${Math.max(1, Math.round(faceW / 320))}px)`), fd = fine.getContext("2d").getImageData(faceBox.x0, faceBox.y0, faceBox.w, faceBox.h).data;
      const k = 0.85 * a;
      pixelPass(ctx, skinMask(), faceBox, (d, i, m) => {
        for (let ch = 0; ch < 3; ch++) { const v = sd[i + ch] + 0.6 * (d[i + ch] - fd[i + ch]); d[i + ch] += (v - d[i + ch]) * m * k; }
      });
    },
    fblemish(a) {
      // Spots are small patches darker or redder than the skin around them: fill them from a
      // blurred copy. Freckles (light brown, not red) are kept unless "Freckles too" is chosen.
      const all = style("fblemish") === "all";
      const blur = filtered(ctx.canvas, `blur(${Math.max(2, Math.round(faceW / 70))}px)`), bd = blur.getContext("2d").getImageData(faceBox.x0, faceBox.y0, faceBox.w, faceBox.h).data;
      pixelPass(ctx, skinMask(), faceBox, (d, i, m) => {
        const l = lum(d[i], d[i + 1], d[i + 2]) / 255, lb = lum(bd[i], bd[i + 1], bd[i + 2]) / 255;
        const red = ((d[i] - d[i + 1]) - (bd[i] - bd[i + 1])) / 255, dark = lb - l;
        const spot = all ? Math.max(smoothstep(0.015, 0.07, dark), smoothstep(0.03, 0.09, red))
          : Math.max(smoothstep(0.035, 0.1, red) * smoothstep(-0.02, 0.02, dark + red * 0.5), smoothstep(0.11, 0.18, dark));
        const w = m * spot * Math.min(1, a * 1.4);
        for (let ch = 0; ch < 3; ch++) d[i + ch] += (bd[i + ch] - d[i + ch]) * w;
      });
      if (all) ops.fsmooth(a * 0.35);
    },
    ftone(a) {
      // Evens out redness and blotches: each pixel keeps its own brightness (texture, freckles)
      // and takes the color of the skin around it.
      const blur = filtered(ctx.canvas, `blur(${Math.max(3, Math.round(faceW / 18))}px)`), bd = blur.getContext("2d").getImageData(faceBox.x0, faceBox.y0, faceBox.w, faceBox.h).data;
      pixelPass(ctx, skinMask(), faceBox, (d, i, m) => {
        const l = lum(d[i], d[i + 1], d[i + 2]), lb = lum(bd[i], bd[i + 1], bd[i + 2]), w = m * a * 0.75;
        for (let ch = 0; ch < 3; ch++) d[i + ch] += (l + (bd[i + ch] - lb) - d[i + ch]) * w;
      });
    },
    fdodge(a) {
      // Dodge and burn: the blotchy light and dark patches in the skin (bigger than pores, smaller
      // than the face's own shape) are brought toward the skin around them, the way a retoucher
      // evens skin on a separate layer. Pores (finer) and cheekbones, jaw and nose (bigger) stay.
      const fine = filtered(ctx.canvas, `blur(${Math.max(1, Math.round(faceW / 55))}px)`), fd = fine.getContext("2d").getImageData(faceBox.x0, faceBox.y0, faceBox.w, faceBox.h).data;
      const wide = filtered(ctx.canvas, `blur(${Math.max(2, Math.round(faceW / 11))}px)`), wd = wide.getContext("2d").getImageData(faceBox.x0, faceBox.y0, faceBox.w, faceBox.h).data;
      pixelPass(ctx, skinMask(), faceBox, (d, i, m) => {
        const mid = lum(fd[i], fd[i + 1], fd[i + 2]) - lum(wd[i], wd[i + 1], wd[i + 2]);
        // Only gentle patches: a strong edge there is a feature (a crease, the side of the nose).
        const v = -Math.max(-18, Math.min(18, mid)) * 0.6 * Math.min(1, a) * m * (1 - smoothstep(14, 30, Math.abs(mid)));
        for (let ch = 0; ch < 3; ch++) d[i + ch] = Math.max(0, Math.min(255, d[i + ch] + v));
      });
    },
    fskin(a) {
      const blur = filtered(ctx.canvas, `blur(${Math.max(3, Math.round(faceW / 30))}px)`), bd = blur.getContext("2d").getImageData(faceBox.x0, faceBox.y0, faceBox.w, faceBox.h).data;
      if (style("fskin") === "matte") {
        // Takes the shine off: only patches brighter than the skin around them are toned down.
        pixelPass(ctx, skinMask(), faceBox, (d, i, m) => {
          const l = lum(d[i], d[i + 1], d[i + 2]) / 255, lb = lum(bd[i], bd[i + 1], bd[i + 2]) / 255;
          const w = m * a * smoothstep(0.02, 0.12, l - lb) * smoothstep(0.45, 0.65, l);
          for (let ch = 0; ch < 3; ch++) d[i + ch] += (bd[i + ch] - d[i + ch]) * w * 0.85;
        });
        return;
      }
      // Dewy: a soft sheen on the high points and a lift where light already falls.
      // (a soft, blurred lift, so freckles and pores are never sharpened)
      blendMasked(ctx, filtered(ctx.canvas, `blur(${Math.max(2, Math.round(faceW / 60))}px) brightness(1.12) saturate(1.05)`), skinMask(), a * 0.22);
      onFace((l) => {
        for (const c of [P[117], P[346]]) dab(l, c, faceW * 0.1, faceW * 0.05, 0, "#fff6ee", a * 0.25, "soft-light");
        dab(l, lerpPt(P[6], P[4], 0.4), faceW * 0.035, faceW * 0.12, Math.atan2(-up[0], up[1]), "#fff6ee", a * 0.22, "soft-light");
        dab(l, lerpPt(P[10], P[9], 0.6), faceW * 0.12, faceW * 0.06, Math.atan2(up[0], -up[1]), "#fff6ee", a * 0.2, "soft-light");
      });
    },
    fshine(a) {
      // Takes the oily shine off forehead, nose and cheeks: patches brighter and paler than the skin
      // around them take that skin's tone, with their own fine texture kept, so they never go flat.
      const wide = filtered(ctx.canvas, `blur(${Math.max(4, Math.round(faceW / 9))}px)`), bd = wide.getContext("2d").getImageData(faceBox.x0, faceBox.y0, faceBox.w, faceBox.h).data;
      const fine = filtered(ctx.canvas, `blur(${Math.max(1, Math.round(faceW / 200))}px)`), fd = fine.getContext("2d").getImageData(faceBox.x0, faceBox.y0, faceBox.w, faceBox.h).data;
      pixelPass(ctx, skinMask(), faceBox, (d, i, m) => {
        const l = lum(fd[i], fd[i + 1], fd[i + 2]) / 255, lb = lum(bd[i], bd[i + 1], bd[i + 2]) / 255;
        const sat = (Math.max(fd[i], fd[i + 1], fd[i + 2]) - Math.min(fd[i], fd[i + 1], fd[i + 2])) / Math.max(1, Math.max(fd[i], fd[i + 1], fd[i + 2]));
        const satB = (Math.max(bd[i], bd[i + 1], bd[i + 2]) - Math.min(bd[i], bd[i + 1], bd[i + 2])) / Math.max(1, Math.max(bd[i], bd[i + 1], bd[i + 2]));
        const w = m * Math.min(1, a) * smoothstep(0.015, 0.11, l - lb) * smoothstep(0.42, 0.62, l) * (0.55 + 0.45 * smoothstep(-0.02, 0.08, satB - sat));
        // The skin's own tone at about the brightness of the skin around, plus the pixel's fine detail.
        const tl = (lb + (l - lb) * 0.3) * 255, k = tl / Math.max(1, lb * 255);
        for (let ch = 0; ch < 3; ch++) { const v = bd[i + ch] * k + 0.7 * (d[i + ch] - fd[i + ch]); d[i + ch] += (v - d[i + ch]) * w * 0.92; }
      });
    },
    fundereye(a) {
      const mask = softMask(W, H, faceW / 45, (m) => {
        for (const e of eyes) { const low = Math.max(...e.poly.map((p) => p[1])); m.beginPath(); m.ellipse(e.c[0], low + e.w * 0.28, e.w * 0.55, e.w * 0.24, 0, 0, 7); m.fill(); }
      });
      blendMasked(ctx, filtered(ctx.canvas, `blur(${Math.max(1, Math.round(faceW / 150))}px) brightness(1.2) saturate(0.85)`), mask, a * 0.9);
    },
    fteeth(a) {
      const mouth = pts(FACE.lipsIn), mb = box(ctx.canvas, ...mean(mouth), dist(P[78], P[308]));
      const mask = softMask(W, H, faceW / 220, (m) => { tracePoly(m, mouth); m.fill(); });
      pixelPass(ctx, mask, mb, (d, i, m) => {
        const r = d[i] / 255, g = d[i + 1] / 255, b = d[i + 2] / 255, l = r * 0.3 + g * 0.59 + b * 0.11;
        const w = m * a * smoothstep(0.22, 0.45, l) * (1 - smoothstep(0.12, 0.3, r - g)); // skip gums and lips
        const yellow = Math.max(0, (r + g) / 2 - b), lift = 1 + 0.15 * w;
        // A natural white: the yellow is taken out, never replaced with blue.
        d[i] = Math.min(255, (r - yellow * 0.2 * w) * lift * 255);
        d[i + 1] = Math.min(255, (g - yellow * 0.1 * w) * lift * 255);
        d[i + 2] = Math.min(255, (b + yellow * 0.55 * w) * lift * 255);
      });
    },
    feyes(a) {
      // Whites: brighter and less red. Irises: more depth and sparkle, with their own color kept.
      const eyeMask = softMask(W, H, faceW / 300, (m) => { for (const e of eyes) { tracePoly(m, e.poly); m.fill(); } });
      const im = irises.length ? irisMask(1.05).getContext("2d") : null;
      const eb = box(ctx.canvas, faceC[0], (eyes[0].c[1] + eyes[1].c[1]) / 2, faceW * 0.6);
      const id = im && im.getImageData(eb.x0, eb.y0, eb.w, eb.h).data;
      const irisMean = irises.length ? maskedMean(ctx, irisMask(0.9), eb) : 0;
      pixelPass(ctx, eyeMask, eb, (d, i, m) => {
        const inIris = id ? id[i + 3] / 255 : 0, l = lum(d[i], d[i + 1], d[i + 2]);
        if (inIris < 1) {
          const w = m * (1 - inIris) * a * smoothstep(60, 140, l) * (1 - smoothstep(0.25, 0.5, (Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2])) / Math.max(1, l)));
          const k = 1 + 0.16 * w;
          d[i] = Math.min(255, (d[i] - (d[i] - l) * 0.45 * w) * k); d[i + 1] = Math.min(255, (d[i + 1] - (d[i + 1] - l) * 0.45 * w) * k); d[i + 2] = Math.min(255, (d[i + 2] - (d[i + 2] - l) * 0.45 * w) * k);
        }
        if (inIris > 0 && l < 230) {
          const nl = Math.max(0, irisMean + (l - irisMean) * (1 + 0.5 * a) + 10 * a), k = 1 + (nl / Math.max(1, l) - 1) * inIris * m;
          for (let ch = 0; ch < 3; ch++) d[i + ch] = Math.min(255, d[i + ch] * k);
        }
      });
    },
    feyecolor(a) {
      if (!irises.length) throw unavailable("Couldn't find the eyes clearly enough. Try a clear, front-facing photo.");
      const [tr, tg, tb] = rgbOf(shade("feyecolor")), tl = lum(tr, tg, tb);
      const eb = box(ctx.canvas, faceC[0], (eyes[0].c[1] + eyes[1].c[1]) / 2, faceW * 0.6), mask = irisMask(1);
      const ml = maskedMean(ctx, mask, eb);
      pixelPass(ctx, mask, eb, (d, i, m, x, y) => {
        // The pupil and the light reflections stay as they are.
        const ir = irises.reduce((b, r) => (dist(r.c, [x, y]) / r.r < dist(b.c, [x, y]) / b.r ? r : b)), rr = dist(ir.c, [x, y]) / ir.r;
        const l = lum(d[i], d[i + 1], d[i + 2]), keep = Math.max(1 - smoothstep(0.3, 0.45, rr), smoothstep(190, 235, l));
        // The new color at a brightness between the eye's own and the shade's, with the iris's own pattern.
        const w = m * (1 - keep) * (0.3 + 0.45 * a), k = (l / Math.max(1, ml)) * ((ml * 0.55 + tl * 0.45) / Math.max(1, tl));
        const [nr, ng, nb] = toneTo(tr, tg, tb, tl * k);
        d[i] += (Math.min(255, nr) - d[i]) * w; d[i + 1] += (Math.min(255, ng) - d[i + 1]) * w; d[i + 2] += (Math.min(255, nb) - d[i + 2]) * w;
      });
    },
    fbigeyes(a) { reshapeFace(ctx, P, "fbigeyes", a); },
    fslim(a) { reshapeFace(ctx, P, "fslim", a); },
    fnose(a) { reshapeFace(ctx, P, "fnose", a); },
    flips(a) {
      const st = style("flips"), [tr, tg, tb] = rgbOf(shade("flips")), tl = lum(tr, tg, tb);
      const mask = softMask(W, H, faceW / 250, (m) => {
        tracePoly(m, pts(FACE.lipsOut)); m.fill(); m.globalCompositeOperation = "destination-out"; tracePoly(m, pts(FACE.lipsIn)); m.fill();
      });
      // How close each lip pixel is to the inside of the mouth (for the ombré lip).
      const inner = st === "ombre" ? softMask(W, H, faceW / 28, (m) => { tracePoly(m, pts(FACE.lipsIn)); m.fill(); m.lineWidth = faceW / 30; m.strokeStyle = "#fff"; m.stroke(); }).getContext("2d") : null;
      const lb = box(ctx.canvas, ...mean(pts(FACE.lipsOut)), dist(P[61], P[291]) * 0.75), id = inner && inner.getImageData(lb.x0, lb.y0, lb.w, lb.h).data;
      const ml = maskedMean(ctx, mask, lb);
      const contrast = { satin: 1, matte: 0.75, gloss: 1.2, shimmer: 1.1, ombre: 1 }[st];
      const base = 0.2 + a * 0.5;
      pixelPass(ctx, mask, lb, (d, i, m, x, y) => {
        const l = lum(d[i], d[i + 1], d[i + 2]), rel = l / Math.max(1, ml);
        // The shade's hue and richness at a brightness between the lip's own and the shade's,
        // with the lip's texture (lines, light) kept, so it reads as lipstick, not paint.
        let k = 1 + (rel - 1) * contrast;
        if (st === "matte") k = Math.min(k, 1.04);
        let [nr, ng, nb] = toneTo(tr, tg, tb, (ml * 0.4 + tl * 0.6) * k), w = m * base;
        if (st === "ombre") w *= 0.3 + 0.7 * (id[i + 3] / 255);
        if (st === "gloss") { const s = smoothstep(1.05, 1.35, rel) * 120 * a; nr += s; ng += s; nb += s; }
        if (st === "shimmer") { const s = sparkle(x, y) > 0.93 ? 70 * a * (0.5 + rel / 2) : 0; nr += s; ng += s * 0.9; nb += s * 0.8; }
        d[i] += (Math.min(255, nr) - d[i]) * w; d[i + 1] += (Math.min(255, ng) - d[i + 1]) * w; d[i + 2] += (Math.min(255, nb) - d[i + 2]) * w;
      });
      if (st === "gloss") {
        // A soft shine on the middle of the lower lip.
        const c = lerpPt(P[14], P[17], 0.45), lw = dist(P[61], P[291]);
        const shine = softMask(W, H, faceW / 120, (m) => { m.beginPath(); m.ellipse(c[0], c[1], lw * 0.16, lw * 0.05, Math.atan2(P[291][1] - P[61][1], P[291][0] - P[61][0]), 0, 7); m.fill(); });
        const t = newCanvas(W, H), tc = t.getContext("2d"); tc.fillStyle = "#fff"; tc.fillRect(0, 0, W, H);
        tc.globalCompositeOperation = "destination-in"; tc.drawImage(mask, 0, 0);
        const s2 = newCanvas(W, H), sc = s2.getContext("2d"); sc.drawImage(t, 0, 0); sc.globalCompositeOperation = "destination-in"; sc.drawImage(shine, 0, 0);
        ctx.save(); ctx.globalCompositeOperation = "soft-light"; ctx.globalAlpha = 0.25 + 0.45 * a; ctx.drawImage(s2, 0, 0); ctx.restore();
      }
    },
    fblush(a) {
      const st = style("fblush"), col = shade("fblush"), al = 0.2 + a * 0.5;
      onFace((l) => {
        for (const [i, side] of [[50, -1], [280, 1]]) {
          const apple = [(P[i][0] * 2 + faceC[0]) / 3, P[i][1] - faceW * 0.02];
          if (st === "lifted") {
            // Up and out along the cheekbone toward the temple.
            const tmp = P[side < 0 ? 127 : 356], c = lerpPt(apple, tmp, 0.35);
            dab(l, c, faceW * 0.2, faceW * 0.08, Math.atan2(tmp[1] - apple[1], tmp[0] - apple[0]), col, al, "soft-light");
            dab(l, c, faceW * 0.16, faceW * 0.06, Math.atan2(tmp[1] - apple[1], tmp[0] - apple[0]), col, al * 0.25, "multiply");
          } else {
            dab(l, apple, faceW * 0.17, faceW * 0.15, 0, col, al, "soft-light");
            dab(l, apple, faceW * 0.13, faceW * 0.11, 0, col, al * 0.25, "multiply");
          }
        }
        if (st === "sun") { const c = lerpPt(P[6], P[4], 0.55); dab(l, c, faceW * 0.11, faceW * 0.05, Math.atan2(up[0], -up[1]), col, al * 0.8, "soft-light"); }
      });
    },
    fcontour(a) {
      const col = shade("fcontour"), al = 0.15 + a * 0.45;
      onFace((l) => {
        for (const [ear, mouth, jaw] of [[P[234], P[61], P[172]], [P[454], P[291], P[397]]]) {
          // Under the cheekbone, from the ear toward the corner of the mouth, and along the jaw.
          const a0 = lerpPt(ear, mouth, 0.08), a1 = lerpPt(ear, mouth, 0.45), c = lerpPt(a0, a1, 0.5);
          dab(l, [c[0] - up[0] * faceW * 0.03, c[1] - up[1] * faceW * 0.03], dist(a0, a1) * 0.6, faceW * 0.045, Math.atan2(a1[1] - a0[1], a1[0] - a0[0]), col, al, "multiply");
          dab(l, jaw, faceW * 0.14, faceW * 0.05, Math.atan2(jaw[1] - ear[1], jaw[0] - ear[0]), col, al * 0.7, "multiply");
        }
        // The sides of the nose.
        for (const k of [193, 417]) { const c = lerpPt(P[k], k === 193 ? P[129] : P[358], 0.5); dab(l, c, faceW * 0.1, faceW * 0.018, Math.atan2(-up[0], up[1]), col, al * 0.5, "multiply"); }
      });
    },
    fhighlight(a) {
      const col = shade("fhighlight"), al = 0.1 + a * 0.28, vert = Math.atan2(-up[0], up[1]);
      onFace((l) => {
        for (const [cb, tmp] of [[P[116], P[127]], [P[345], P[356]]]) dab(l, lerpPt(cb, tmp, 0.2), faceW * 0.11, faceW * 0.055, Math.atan2(tmp[1] - cb[1], tmp[0] - cb[0]), col, al, "screen");
        dab(l, lerpPt(P[6], P[4], 0.45), faceW * 0.12, faceW * 0.028, vert, col, al * 0.7, "screen");   // nose bridge
        dab(l, lerpPt(P[0], P[164], 0.6), faceW * 0.025, faceW * 0.012, 0, col, al * 0.7, "screen");   // cupid's bow
        dab(l, lerpPt(P[152], P[17], 0.35), faceW * 0.04, faceW * 0.025, 0, col, al * 0.6, "screen");  // chin
        for (const k of [105, 334]) dab(l, [P[k][0] - up[0] * faceW * 0.03, P[k][1] - up[1] * faceW * 0.03], faceW * 0.05, faceW * 0.015, 0, col, al * 0.5, "screen"); // brow bone
      });
    },
    fbronzer(a) {
      const col = shade("fbronzer"), al = 0.15 + a * 0.45;
      onFace((l) => {
        for (const k of [54, 284]) dab(l, P[k], faceW * 0.14, faceW * 0.09, 0, col, al, "soft-light");          // temples
        for (const [cb, tmp] of [[P[116], P[127]], [P[345], P[356]]]) dab(l, lerpPt(cb, tmp, 0.4), faceW * 0.16, faceW * 0.07, Math.atan2(tmp[1] - cb[1], tmp[0] - cb[0]), col, al, "soft-light");
        dab(l, P[4], faceW * 0.05, faceW * 0.04, 0, col, al * 0.7, "soft-light");                                // nose tip
        dab(l, lerpPt(P[152], P[17], 0.4), faceW * 0.08, faceW * 0.04, 0, col, al * 0.6, "soft-light");          // chin
      });
    },
    fbrows(a) {
      const st = style("fbrows");
      const mask = softMask(W, H, faceW / (st === "soft" ? 70 : 110), (m) => {
        for (const br of [FACE.browL, FACE.browR]) {
          tracePoly(m, pts(br)); m.fill();
          if (st === "bold") { m.lineWidth = faceW / 70; m.lineJoin = "round"; m.strokeStyle = "#fff"; m.stroke(); }
        }
      });
      const tint = newCanvas(W, H), t = tint.getContext("2d");
      t.drawImage(ctx.canvas, 0, 0); t.globalCompositeOperation = "multiply"; t.fillStyle = shade("fbrows"); t.fillRect(0, 0, W, H);
      t.globalCompositeOperation = "color"; t.globalAlpha = 0.5; t.fillRect(0, 0, W, H);
      blendMasked(ctx, tint, mask, { natural: 0.12 + a * 0.4, soft: 0.08 + a * 0.3, bold: 0.18 + a * 0.55 }[st]);
    },
    fshadow(a) {
      // Color the lid from the lash line up toward the brow, strongest in the middle.
      const st = style("fshadow"), reach = st === "smokey" ? 0.42 : 0.3;
      const mask = softMask(W, H, faceW / (st === "smokey" ? 32 : 45), (m) => {
        for (const L of lids) {
          const top = L.lid.map(([x, y], i) => {
            const t = i / (L.lid.length - 1), h = L.ew * (0.12 + reach * Math.sin(Math.PI * Math.min(1, t * (st === "smokey" ? 0.8 : 1))));
            const out = st === "smokey" ? L.ew * 0.15 * t * t : 0;
            return [x + L.n[0] * h + L.axis[0] * out, y + L.n[1] * h + L.axis[1] * out];
          });
          tracePoly(m, [...L.lid, ...top.reverse()]); m.fill();
          if (st === "smokey") {   // a soft line under the outer half of the lower lashes
            m.lineWidth = L.ew * 0.08; m.lineCap = "round"; m.strokeStyle = "#fff"; m.beginPath();
            L.lower.slice(4).forEach(([x, y], i) => (i ? m.lineTo(x, y) : m.moveTo(x, y))); m.stroke();
          }
        }
      });
      const tint = newCanvas(W, H), t = tint.getContext("2d");
      t.drawImage(ctx.canvas, 0, 0); t.globalCompositeOperation = "multiply"; t.fillStyle = shade("fshadow"); t.fillRect(0, 0, W, H);
      blendMasked(ctx, tint, mask, (st === "smokey" ? 0.3 : 0.2) + a * (st === "smokey" ? 0.6 : 0.55));
      if (st === "shimmer" || st === "halo") {
        // A light, sparkling center on the lid.
        const spot = softMask(W, H, faceW / 50, (m) => { for (const L of lids) { const c = along(L.lid, 0.5); m.beginPath(); m.ellipse(c[0] + L.n[0] * L.ew * 0.14, c[1] + L.n[1] * L.ew * 0.14, L.ew * 0.17, L.ew * 0.11, Math.atan2(L.axis[1], L.axis[0]), 0, 7); m.fill(); } });
        const shine = newCanvas(W, H), s = shine.getContext("2d");
        s.drawImage(ctx.canvas, 0, 0); s.globalCompositeOperation = "screen"; s.fillStyle = "#f6e6cf"; s.fillRect(0, 0, W, H);
        blendMasked(ctx, shine, st === "halo" ? spot : mask, a * (st === "halo" ? 0.45 : 0.18));
        const eb = box(ctx.canvas, faceC[0], (eyes[0].c[1] + eyes[1].c[1]) / 2, faceW * 0.6);
        pixelPass(ctx, mask, eb, (d, i, m, x, y) => { if (sparkle(x, y) > 0.95) { const s2 = 80 * a * m; d[i] = Math.min(255, d[i] + s2); d[i + 1] = Math.min(255, d[i + 1] + s2 * 0.95); d[i + 2] = Math.min(255, d[i + 2] + s2 * 0.85); } });
      }
    },
    fliner(a) {
      // A tapered line along each upper lash line, thicker toward the outer corner, with the same
      // shape on both eyes (it follows each eye's own axis, so a tilted head doesn't change it).
      const st = style("fliner"), s = 0.6 + 0.6 * a;
      const shape = { wing: [0.015, 0.05, 0.25, 0.12], classic: [0.012, 0.042, 0, 0], cat: [0.018, 0.06, 0.38, 0.2], smudge: [0.03, 0.065, 0.1, 0.04], tight: [0.009, 0.014, 0, 0] }[st];
      ctx.save(); ctx.fillStyle = shade("fliner"); ctx.strokeStyle = shade("fliner"); ctx.lineCap = ctx.lineJoin = "round";
      for (const L of lids) {
        const N = 14, base = [], top = [];
        for (let k = 0; k <= N; k++) {
          const t = k / N, p = along(L.lid, t), th = L.ew * (shape[0] + (shape[1] - shape[0]) * t * t) * s;
          base.push(p); top.push([p[0] + L.n[0] * th, p[1] + L.n[1] * th]);
        }
        // The wing points from the outer corner toward the end of the brow, the classic guide.
        // Measured in the face's own frame, so both wings rise at the same angle even when the head is tilted.
        const side = [-up[1], up[0]], out = (L.outer[0] - L.inner[0]) * side[0] + (L.outer[1] - L.inner[1]) * side[1] > 0 ? side : [-side[0], -side[1]];
        const ang = Math.atan2(shape[3], shape[2]) + 0.12, wd = [out[0] * Math.cos(ang) + up[0] * Math.sin(ang), out[1] * Math.cos(ang) + up[1] * Math.sin(ang)];
        const wing = [L.outer[0] + wd[0] * Math.hypot(shape[2], shape[3]) * L.ew * s, L.outer[1] + wd[1] * Math.hypot(shape[2], shape[3]) * L.ew * s];
        ctx.filter = `blur(${st === "smudge" ? Math.max(1, L.ew / 30) : Math.max(0.4, L.ew / 160)}px)`;
        ctx.globalAlpha = st === "smudge" ? 0.6 : 0.88;
        tracePoly(ctx, shape[2] ? [...base, wing, ...top.reverse()] : [...base, ...top.reverse()]); ctx.fill();
        if (st === "smudge") {   // a softer line under the outer lower lashes
          ctx.globalAlpha = 0.35; ctx.lineWidth = L.ew * 0.045 * s; ctx.beginPath();
          L.lower.slice(3).forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke();
        }
      }
      ctx.restore();
    },
    flashes(a) {
      // Individual lashes drawn from the upper lash line, curling up and out.
      const st = style("flashes"), col = shade("flashes"), len = 0.55 + 0.6 * a;
      const count = { natural: 28, volume: 44, wispy: 34, doll: 38 }[st];
      ctx.save(); ctx.strokeStyle = col; ctx.lineCap = "round";
      for (const L of lids) {
        ctx.filter = `blur(${Math.max(0.3, L.ew / 220)}px)`;
        ctx.globalAlpha = 0.75; ctx.lineWidth = L.ew * (st === "volume" ? 0.035 : 0.022);   // a fuller lash line
        ctx.beginPath(); L.lid.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke();
        for (let k = 0; k < count; k++) {
          const t = 0.04 + 0.94 * (k / (count - 1)) + (sparkle(k, 7) - 0.5) * 0.015, p = along(L.lid, t);
          let l = { natural: 0.1 + 0.1 * t, volume: 0.13 + 0.11 * t, wispy: (0.09 + 0.13 * t) * (k % 3 === 0 ? 1.25 : 0.7), doll: 0.12 + 0.12 * Math.sin(Math.PI * t) }[st];
          l *= L.ew * len * (0.9 + 0.2 * sparkle(k, 3));
          const out = 0.15 + 0.55 * t * t, d = norm([L.n[0] + L.axis[0] * out, L.n[1] + L.axis[1] * out]);
          const tip = [p[0] + d[0] * l, p[1] + d[1] * l], ctl = [p[0] + L.n[0] * l * 0.75, p[1] + L.n[1] * l * 0.75];
          ctx.globalAlpha = 0.9; ctx.lineWidth = L.ew * (st === "volume" ? 0.016 : 0.011);
          ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.quadraticCurveTo(ctl[0], ctl[1], tip[0], tip[1]); ctx.stroke();
        }
        if (st === "doll" || st === "volume") {   // short lower lashes
          for (let k = 0; k < 12; k++) {
            const t = 0.25 + 0.7 * (k / 11), p = along(L.lower, t), l = L.ew * 0.05 * len * (0.6 + t * 0.6);
            const d = norm([-L.n[0] + L.axis[0] * 0.3 * t, -L.n[1] + L.axis[1] * 0.3 * t]);
            ctx.globalAlpha = 0.7; ctx.lineWidth = L.ew * 0.008; ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.lineTo(p[0] + d[0] * l, p[1] + d[1] * l); ctx.stroke();
          }
        }
      }
      ctx.restore();
    },
    fglam(a) {
      const name = style("fglam");
      const steps = name === "mine" ? (faceSet.mine || []) : LOOKS[name] || LOOKS.natural;
      if (name === "mine" && !steps.length) throw unavailable("Save your look first: apply your makeup to a photo, then open Looks and tap Save my look.");
      const keep = { shade: { ...faceSet.shade }, style: { ...faceSet.style } };
      try {
        for (const [id, k, sh, stl] of steps) {
          if (sh) faceSet.shade[id] = sh; if (stl) faceSet.style[id] = stl;
          if (ops[id] && id !== "fglam") ops[id](clamp01(k * a * (name === "mine" ? 1 / 0.6 : 1.6)));
        }
      } finally { Object.assign(faceSet.shade, keep.shade); Object.assign(faceSet.style, keep.style); }
    },
    fauto(a) { ops.fblemish(a * 0.9); ops.ftone(a * 0.4); ops.fundereye(a * 0.8); ops.feyes(a * 0.6); ops.fteeth(a * 0.7); },
    // Glow Up: the ticked steps, in a fixed order (skin first, then eyes, then makeup).
    glowup(a) {
      const keep = { shade: { ...faceSet.shade }, style: { ...faceSet.style } };
      try {
        for (const [id, k, sh, stl] of faceSet.glow || []) {
          if (sh) faceSet.shade[id] = sh; if (stl) faceSet.style[id] = stl;
          if (ops[id] && id !== "glowup") ops[id](clamp01(k * a));
        }
      } finally { Object.assign(faceSet.shade, keep.shade); Object.assign(faceSet.style, keep.style); }
    },
  };
  ops[toolId](amt);
}

// Landmarks for the last few pictures, so moving a slider doesn't search for faces again.
// Stored in 0–1 coordinates, so they fit the picture at any size.
const faceCache = new Map();
async function findFaces(src, c) {
  if (faceCache.has(src)) return faceCache.get(src);
  const faces = await findAllFaces(detectCopy(c));
  faceCache.set(src, faces); if (faceCache.size > 4) faceCache.delete(faceCache.keys().next().value);
  return faces;
}

// Every face in a picture, group photos and wide shots included. MediaPipe's face models only see
// faces that fill at least about a fifth of what they look at, so a search over the whole picture
// misses everyone in a group or standing back. So: the whole picture first, then the quick face
// detector over overlapping squares at two sizes, and each new spot it finds is checked by the
// landmark model on a close-up (which also gives the face's 478 points). Faces under 12 px are
// left out. Returns landmarks in 0–1 coordinates of `c`.
const FACE_DETECT_MODEL = "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/latest/blaze_face_short_range.tflite";
let faceSpotterPromise = null;
function faceSpotter() {
  if (!faceSpotterPromise) faceSpotterPromise = (async () => {
    const { vision, fileset } = await visionLib();
    return vision.FaceDetector.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: native ? "vendor/blaze_face_short_range.tflite" : FACE_DETECT_MODEL }, runningMode: "IMAGE", minDetectionConfidence: 0.4,
    });
  })().catch(() => { faceSpotterPromise = null; return null; });
  return faceSpotterPromise;
}
function boxOf(f) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of f) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  return [x0, y0, x1 - x0, y1 - y0];
}
// How much of the smaller box lies inside the other.
function boxOverlap(a, b) {
  const w = Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0]), h = Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]);
  return w <= 0 || h <= 0 ? 0 : (w * h) / Math.max(1e-9, Math.min(a[2] * a[3], b[2] * b[3]));
}
async function findAllFaces(c, max = 24) {
  const finder = await faceFinder(), W = c.width, H = c.height, L = Math.max(W, H), faces = [];
  const add = (f) => {
    const b = boxOf(f);
    if (b[2] * W < 12 || faces.some((g) => boxOverlap(boxOf(g), b) > 0.35)) return;
    faces.push(f);
  };
  for (const f of finder.detect(c).faceLandmarks || []) add(f.map((p) => [p.x, p.y]));
  const spotter = await faceSpotter();
  if (!spotter || L < 320) return faces;
  const S = 256, tile = newCanvas(S, S), tx = tile.getContext("2d");
  const look = (X, Y, T) => { tx.fillStyle = "#000"; tx.fillRect(0, 0, S, S); tx.drawImage(c, X, Y, T, T, 0, 0, S, S); };
  const spots = [];
  for (const T of [Math.round(L / 2.5), Math.round(L / 5)]) {
    if (T < 96) continue;
    const step = Math.round(T * 0.72);
    for (let y = 0; ; y += step) {
      const Y = Math.max(0, Math.min(y, H - T));
      for (let x = 0; ; x += step) {
        const X = Math.max(0, Math.min(x, W - T));
        look(X, Y, T);
        for (const d of spotter.detect(tile).detections || []) {
          const b = d.boundingBox, k = T / S;
          spots.push([(X + b.originX * k) / W, (Y + b.originY * k) / H, (b.width * k) / W, (b.height * k) / H, d.categories[0]?.score ?? 0]);
        }
        if (X >= W - T) break;
      }
      if (Y >= H - T) break;
    }
  }
  spots.sort((a, b) => b[4] - a[4]);
  for (const b of spots) {
    if (faces.length >= max) break;
    if (faces.some((g) => boxOverlap(boxOf(g), b) > 0.3)) continue;
    const T = Math.max(b[2] * W, b[3] * H) * 2.2, X = (b[0] + b[2] / 2) * W - T / 2, Y = (b[1] + b[3] / 2) * H - T / 2;
    look(X, Y, T);
    // The close-up must show one face where the detector saw it (not a pattern beside it).
    for (const f of finder.detect(tile).faceLandmarks || []) {
      const g = f.map((p) => [(X + p.x * T) / W, (Y + p.y * T) / H]);
      if (boxOverlap(boxOf(g), b) > 0.4) { add(g); break; }
    }
  }
  return faces;
}
// An error that means "this tool can't be used on this photo", shown in the tool's panel.
function unavailable(msg) { const e = new Error(msg); e.unavailable = true; return e; }
// Whether the reshape tools can be used on a photo: "" if yes, otherwise why not.
async function reshapeStatus(src) {
  const img = await loadImg(src), c = canvasFor(img);
  c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
  const faces = await findFaces(src, c);
  if (!faces.length) return "Couldn't find a face clearly enough to reshape. Try a clear, front-facing photo.";
  const why = faces.map((f) => reshapeProblem(f.map(([x, y]) => [x * c.width, y * c.height]), c.width, c.height));
  return why.includes("") ? "" : why[0];
}

// Each face's box in 0–1 coordinates, largest first, for choosing one face in a group photo.
function faceBox(f) {
  let x0 = 1, y0 = 1, x1 = 0, y1 = 0;
  for (const [x, y] of f) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
}
async function faceBoxes(src) {
  const img = await loadImg(src), c = canvasFor(img);
  c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
  return (await findFaces(src, c)).map(faceBox).sort((a, b) => b.w * b.h - a.w * a.h);
}
// The face nearest a chosen point (0–1 coordinates), so an edit stays on the face it was made for.
function nearestFace(faces, pick) {
  let best = null, bd = Infinity;
  for (const f of faces) { const b = faceBox(f), d = (b.cx - pick[0]) ** 2 + (b.cy - pick[1]) ** 2; if (d < bd) { bd = d; best = f; } }
  return best;
}

// `pick` is the chosen face's centre in 0–1 coordinates. Steps saved before faces could be
// chosen have none, and edit every face as they did then.
async function faceEdit(src, toolId, amt, pick) {
  const reshape = RESHAPE_TOOLS.includes(toolId);
  if (reshape && !(amt > 0)) return src; // 0 leaves the photo exactly as it was
  const img = await loadImg(src);
  const c = canvasFor(img), ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, c.width, c.height);
  // `pick.faces`: outlines already found on this photo (or one of the same framing), so a look that
  // the face finder can't re-read (strong colors, AI output) still gets its face steps.
  const known = pick && Array.isArray(pick.faces) && pick.faces.length ? pick.faces : null; if (known) pick = null;
  const found = known || await findFaces(src, c), chosen = pick && found.length > 1 ? nearestFace(found, pick) : null;
  const faces = (chosen ? [chosen] : found).map((f) => f.map(([x, y]) => [x * c.width, y * c.height]));
  if (!faces.length) throw reshape ? unavailable("Couldn't find a face clearly enough to reshape. Try a clear, front-facing photo.") : new Error("Couldn't find a face. Try a clear, front-facing photo.");
  const use = reshape ? faces.filter((P) => !reshapeProblem(P, c.width, c.height)) : faces;
  if (!use.length) throw unavailable(reshapeProblem(faces[0], c.width, c.height));
  for (const P of use) faceOps(ctx, P, amt, toolId);
  return /^data:image\/png/.test(src) ? c.toDataURL("image/png") : c.toDataURL("image/jpeg", 0.92);
}

// Glow Up, the on-device part: face steps in one pass, then gentle face shape, then light and color.
// `g` is { face: [[tool, strength, shade, style]...], slim: 0–1, light: bool }. A photo without a
// clear face still gets its light and color.
const GLOW_ORDER = ["fblemish", "fsmooth", "fshine", "ftone", "fdodge", "fundereye", "fskin", "feyes", "fteeth", "fbrows", "fshadow", "fliner", "flashes", "feyecolor", "fcontour", "fbronzer", "fblush", "fhighlight", "flips", "fglam"];
async function glowUp(src, g, pick) {
  let out = src;
  const face = (g.face || []).slice().sort((x, y) => GLOW_ORDER.indexOf(x[0]) - GLOW_ORDER.indexOf(y[0]));
  if (face.length) {
    faceSet.glow = face;
    try { out = await faceEdit(out, "glowup", 1, pick); } catch (e) { if (!/face/i.test(e.message)) throw e; } finally { faceSet.glow = null; }
  }
  if (g.slim > 0) { try { out = await faceEdit(out, "fslim", g.slim, pick); } catch (e) { if (!e.unavailable) throw e; } }
  if (g.light) out = await autoLight(out);
  return out;
}
// Auto light and color: stretches the tones gently (never clipping her skin), then a touch of vibrance.
// `o.balance`: also take out most of a color cast (indoor yellow, shade blue) first, by moving the
// mid-tones' average toward neutral gray, and skip the extra color pop that would deepen a cast.
async function autoLight(src, o = {}) {
  const img = await loadImg(src), c = canvasFor(img), x = c.getContext("2d", { willReadFrequently: true });
  x.drawImage(img, 0, 0, c.width, c.height);
  const a = x.getImageData(0, 0, c.width, c.height), d = a.data, hist = new Uint32Array(256);
  if (o.balance) {
    // The cast is read from the light, nearly neutral areas (walls, white shirts, sky), which a
    // camera expects to be gray; a deep-colored area doesn't count. Only part of it is removed, so
    // warm light still looks warm, just not yellow.
    let r = 0, g = 0, b = 0, n = 0;
    for (let i = 0; i < d.length; i += 16) {
      const l = lum(d[i], d[i + 1], d[i + 2]), sat = (Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2])) / Math.max(1, Math.max(d[i], d[i + 1], d[i + 2]));
      if (l > 120 && l < 245 && sat < 0.35) { r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; }
    }
    if (n > d.length / 16 * 0.02) {
      const m = (r + g + b) / (3 * n), k = (v) => Math.max(0.9, Math.min(1.12, 1 + (m / Math.max(1, v / n) - 1) * 0.45));
      const kr = k(r), kg = k(g), kb = k(b);
      for (let i = 0; i < d.length; i += 4) { d[i] = d[i] * kr; d[i + 1] = d[i + 1] * kg; d[i + 2] = d[i + 2] * kb; }
    }
  }
  for (let i = 0; i < d.length; i += 16) hist[Math.round(lum(d[i], d[i + 1], d[i + 2]))]++;
  const total = hist.reduce((s, v) => s + v, 0), at = (q) => { let s = 0; for (let v = 0; v < 256; v++) { s += hist[v]; if (s >= total * q) return v; } return 255; };
  const lo = Math.min(40, at(0.005)) * 0.6, hi = 255 - (255 - Math.max(200, at(0.995))) * 0.6, mid = at(0.5);
  const gamma = Math.max(0.85, Math.min(1.15, Math.log(0.5) / Math.log(Math.max(0.05, Math.min(0.95, (mid - lo) / (hi - lo))))));   // dark photos lift, bright ones settle
  const lut = new Uint8ClampedArray(256);
  for (let v = 0; v < 256; v++) lut[v] = 255 * Math.pow(Math.max(0, Math.min(1, (v - lo) / (hi - lo))), 1 / (1 + (1 / gamma - 1) * 0.6));
  for (let i = 0; i < d.length; i += 4) {
    const r = lut[d[i]], g = lut[d[i + 1]], b = lut[d[i + 2]], m = (r + g + b) / 3, s = (Math.max(r, g, b) - Math.min(r, g, b)) / 255, k = (o.balance ? 0.06 : 0.18) * (1 - s) * (1 - s);
    d[i] = m + (r - m) * (1 + k); d[i + 1] = m + (g - m) * (1 + k); d[i + 2] = m + (b - m) * (1 + k);
  }
  x.putImageData(a, 0, 0);
  return encode(c, src);
}
// After an AI edit: if her face moved or changed shape (AI models sometimes redraw it), her own
// face from before is put back, matched to the new light, with a soft edge. Returns the photo
// and whether it did that.
async function restoreFace(baseSrc, resultSrc) {
  // The result is first lined up with the photo (an edit model answers in its own shape, so it
  // comes back zoomed and shifted; drawn straight over the photo it would be stretched and her
  // face would land in the wrong place). Then, if the model redrew her face, her own face is
  // moved, turned and scaled onto the new one (eyes and outline matched) and blended in with a
  // soft edge, carrying the new photo's light and color. It is never pasted where the face used
  // to be, so there is no double face.
  const [a, b] = await Promise.all([loadImg(baseSrc), loadImg(resultSrc)]);
  const W = a.naturalWidth, H = a.naturalHeight, co = newCanvas(W, H);
  co.getContext("2d", { willReadFrequently: true }).drawImage(a, 0, 0);
  const al = await alignAi(a, b, co, baseSrc, resultSrc, "|restore");
  const cb = al.ca, bx = al.ax;
  const plain = () => ({ data: cb.toDataURL("image/jpeg", 0.93), moved: false, aligned: !!al.matched });
  if (!al.faces.length) return plain();
  const toPx = (f) => f.map(([x, y]) => [x * W, y * H]);
  const A = toPx(al.faces.reduce((m, P) => (dist(P[234], P[454]) > dist(m[234], m[454]) ? P : m)));
  const faceW = dist(A[234], A[454]), cA = mean(FACE.oval.map((i) => A[i]));
  const B = al.aiFaces.map(toPx).find((g) => dist(mean(FACE.oval.map((i) => g[i])), cA) < faceW * 0.6);
  if (!B || faceW < 12) return plain();   // no face to match: keep the model's
  const pts = [...FACE.oval, ...FACE.eyeL, ...FACE.eyeR, ...FACE.lipsOut];
  const shift = pts.reduce((t, i) => t + dist(A[i], B[i]), 0) / pts.length;
  // Her face onto the new one: z' = k z + t (k a complex number: scale and turn), least squares.
  const mp = mean(pts.map((i) => A[i])), mq = mean(pts.map((i) => B[i]));
  let kr = 0, ki = 0, den = 0;
  for (const i of pts) {
    const px = A[i][0] - mp[0], py = A[i][1] - mp[1], qx = B[i][0] - mq[0], qy = B[i][1] - mq[1];
    kr += qx * px + qy * py; ki += qy * px - qx * py; den += px * px + py * py;
  }
  kr /= den || 1; ki /= den || 1;
  const sc = Math.hypot(kr, ki);
  if (!(sc > 0.6 && sc < 1.6)) return plain();
  const tx = mq[0] - (kr * mp[0] - ki * mp[1]), ty = mq[1] - (ki * mp[0] + kr * mp[1]);
  const warped = newCanvas(W, H), wx = warped.getContext("2d", { willReadFrequently: true });
  wx.imageSmoothingQuality = "high"; wx.setTransform(kr, ki, -ki, kr, tx, ty); wx.drawImage(a, 0, 0); wx.setTransform(1, 0, 0, 1, 0, 0);
  // The blend covers the new face's outline, a little inside it, so the jaw and hairline are the model's.
  const cB = mean(FACE.oval.map((i) => B[i])), fB = faceW * sc;
  const mask = softMask(W, H, fB / 12, (m) => { tracePoly(m, FACE.oval.map((i) => [(B[i][0] - cB[0]) * 0.94 + cB[0], (B[i][1] - cB[1]) * 0.94 + cB[1]])); m.fill(); });
  const md = mask.getContext("2d").getImageData(0, 0, W, H).data, wd = wx.getImageData(0, 0, W, H).data, bdat = bx.getImageData(0, 0, W, H), bd = bdat.data;
  const rgbMean = (d) => { const t = [0, 0, 0]; let n = 0; for (let i = 0; i < d.length; i += 16) { if (md[i + 3] > 128) { t[0] += d[i]; t[1] += d[i + 1]; t[2] += d[i + 2]; n++; } } return t.map((v) => v / Math.max(1, n)); };
  const mw = rgbMean(wd), mb = rgbMean(bd), shiftC = [0, 1, 2].map((k) => (mb[k] - mw[k]) * 0.7);
  for (let i = 0; i < bd.length; i += 4) {
    const w = md[i + 3] / 255; if (!w) continue;
    for (let k = 0; k < 3; k++) bd[i + k] += (wd[i + k] + shiftC[k] - bd[i + k]) * w;
  }
  bx.putImageData(bdat, 0, 0);
  return { data: cb.toDataURL("image/jpeg", 0.93), moved: shift > faceW * 0.02, aligned: !!al.matched };
}

// An image-edit model answers in one of its own shapes (2:3, 9:16, ...), so a photo of another
// shape comes back reframed. This lines the result up with the photo (`co`, W x H, already drawn)
// and returns it as a W x H canvas, plus both pictures' face landmarks (0-1, photo frame).
async function alignAi(o, a, co, src, aiSrc, tag) {
  const W = co.width, H = co.height, n = W * H, ox = co.getContext("2d", { willReadFrequently: true });
  // The model answers in one of its own shapes (2:3, 9:16, ...), so a photo of another shape comes
  // back reframed: zoomed, shifted, sometimes with more or less around the edges. Its result is kept
  // in its own shape, at about the photo's scale, and lined up with the photo from the faces both
  // share (scale and shift, least squares, weighted by face size). With no shared face it is
  // assumed to cover the photo, centered.
  const aw = a.naturalWidth, ah = a.naturalHeight, k0 = Math.sqrt((W * H) / (aw * ah));
  const cw = Math.max(1, Math.round(aw * k0)), ch = Math.max(1, Math.round(ah * k0));
  const cr = newCanvas(cw, ch), crx = cr.getContext("2d", { willReadFrequently: true });
  crx.imageSmoothingQuality = "high"; crx.drawImage(a, 0, 0, cw, ch);
  const pts = [...FACE.oval, ...FACE.eyeL, ...FACE.eyeR];
  let faces = [], aiFaces = [];
  try { faces = await findFaces(src + tag, co); aiFaces = faces.length ? (await findFaces(aiSrc + tag, cr)).map((g) => g.map(([x, y]) => [x * cw, y * ch])) : []; } catch {}
  const s0 = Math.max(cw / W, ch / H);
  let fit = { s: s0, tx: (cw - W * s0) / 2, ty: (ch - H * s0) / 2 }, matched = 0;
  const pairs = [];
  for (const f of faces) {
    const P = f.map(([x, y]) => [x * W, y * H]), faceW = dist(P[234], P[454]), c0 = mean(FACE.oval.map((i) => P[i]));
    const guess = [fit.s * c0[0] + fit.tx, fit.s * c0[1] + fit.ty];
    const Q = aiFaces.reduce((m, g) => { const d = dist(mean(FACE.oval.map((i) => g[i])), guess); return d < faceW * fit.s * 0.8 && (!m || d < m.d) ? { g, d } : m; }, null);
    if (Q) { matched++; for (const i of pts) pairs.push([P[i], Q.g[i], faceW]); }
  }
  if (pairs.length) {
    let sw = 0, mp = [0, 0], mq = [0, 0];
    for (const [P, Q, w] of pairs) { sw += w; mp[0] += P[0] * w; mp[1] += P[1] * w; mq[0] += Q[0] * w; mq[1] += Q[1] * w; }
    mp = mp.map((v) => v / sw); mq = mq.map((v) => v / sw);
    let num = 0, den = 0;
    for (const [P, Q, w] of pairs) { const dx = P[0] - mp[0], dy = P[1] - mp[1]; num += w * (dx * (Q[0] - mq[0]) + dy * (Q[1] - mq[1])); den += w * (dx * dx + dy * dy); }
    const sc = den > 1 ? Math.max(s0 * 0.7, Math.min(s0 * 1.4, num / den)) : s0;
    fit = { s: sc, tx: mq[0] - sc * mp[0], ty: mq[1] - sc * mp[1] };
  }
  // Photo point p sits at s * p + t in the result: draw the result so it sits at p.
  let ca = newCanvas(W, H), ax = ca.getContext("2d", { willReadFrequently: true });
  ax.imageSmoothingQuality = "high";
  ax.setTransform(1 / fit.s, 0, 0, 1 / fit.s, -fit.tx / fit.s, -fit.ty / fit.s); ax.drawImage(cr, 0, 0); ax.setTransform(1, 0, 0, 1, 0, 0);
  aiFaces = aiFaces.map((g) => g.map(([x, y]) => [(x - fit.tx) / fit.s / W, (y - fit.ty) / fit.s / H]));
  // Where the result doesn't reach (it showed less than the photo), the photo itself fills in,
  // given the result's color (a per-channel gain and offset fitted where both exist), with a soft
  // edge. Nothing is ever repeated or stretched.
  const rx0 = -fit.tx / fit.s, ry0 = -fit.ty / fit.s, rx1 = (cw - fit.tx) / fit.s, ry1 = (ch - fit.ty) / fit.s;
  const gap = rx0 > 0.5 || ry0 > 0.5 || rx1 < W - 0.5 || ry1 < H - 0.5;
  if (gap) {
    const O0 = ox.getImageData(0, 0, W, H).data, A0 = ax.getImageData(0, 0, W, H).data, feather = Math.max(4, Math.min(W, H) * 0.02);
    const inside = (x, y) => clamp01(Math.min(x - rx0, rx1 - x, y - ry0, ry1 - y) / feather);
    const st = [0, 1, 2].map(() => ({ so: 0, sa: 0, soo: 0, soa: 0, n: 0 }));
    const step = Math.max(1, Math.round(Math.sqrt(n / 60000)));
    for (let y = 0; y < H; y += step) for (let x = 0; x < W; x += step) {
      if (inside(x, y) < 1) continue;
      const i = (y * W + x) * 4;
      for (let k = 0; k < 3; k++) { const v = O0[i + k], u = A0[i + k], t = st[k]; t.so += v; t.sa += u; t.soo += v * v; t.soa += v * u; t.n++; }
    }
    const gain = st.map((t) => { if (t.n < 50) return [1, 0]; const mo = t.so / t.n, ma = t.sa / t.n, vo = t.soo / t.n - mo * mo, cov = t.soa / t.n - mo * ma; const g = vo > 4 ? Math.max(0.6, Math.min(1.6, cov / vo)) : 1; return [g, ma - g * mo]; });
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const w = inside(x + 0.5, y + 0.5); if (w >= 1) continue;
      const i = (y * W + x) * 4;
      for (let k = 0; k < 3; k++) A0[i + k] = A0[i + k] * w + (O0[i + k] * gain[k][0] + gain[k][1]) * (1 - w);
      A0[i + 3] = 255;
    }
    const img = ax.createImageData(W, H); img.data.set(A0); ax.putImageData(img, 0, 0);
  }
  return { ca, ax, fit, k0, aw, ah, faces, aiFaces, pts, matched, gap };
}

// ---------- Pro Edit's finish: the AI's light and color, the person's own face ----------
// An image-edit model gives a photographer's white balance, exposure, grade and cleanup, but it
// redraws every pixel at about 1 MP, so faces can drift and fine detail goes soft. This keeps the
// model's light and color and puts the photo's own detail back:
// - inside every face, all detail finer than about a 28th of the face, so eyes, nose, mouth and
//   skin texture are the person's own (if the model moved a face, the original face goes back
//   whole, carrying only the model's light and color);
// - everywhere else, the detail finer than the model's own resolution, wherever the model kept
//   what was there. Where it removed or redrew something (clutter, a stain), its version stays.
// `src` is the photo the model was given (any size); the result is at that size.
const PRO_FINISH = { faceDetail: 28, moved: 0.035, keep: 0.6, edge: 0.3 };
// Where did the model keep what was there? Compares the mid-sized detail of both pictures at the
// model's own size (at most 640px): a stronger or softer grade only scales it, a removed or
// redrawn thing replaces it. Returns a W x H RGBA mask (red 255 = kept, 0 = changed).
function changeMask(o, a, W, H, aw, ah) {
  const k = Math.min(1, 640 / Math.max(aw, ah)), w = Math.max(8, Math.round(aw * k)), h = Math.max(8, Math.round(ah * k)), n = w * h;
  const px = (img) => { const c = newCanvas(w, h), x = c.getContext("2d", { willReadFrequently: true }); x.imageSmoothingQuality = "high"; x.drawImage(img, 0, 0, w, h); return x.getImageData(0, 0, w, h).data; };
  const L = (d) => { const g = new Uint8ClampedArray(n * 4); for (let i = 0; i < n * 4; i += 4) { g[i] = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; g[i + 3] = 255; } return g; };
  const band = (g) => { const b1 = new Uint8ClampedArray(g), b2 = new Uint8ClampedArray(g); boxBlurRGBA(b1, w, h, 1.2); boxBlurRGBA(b2, w, h, 4); const f = new Float32Array(n); for (let p = 0; p < n; p++) f[p] = b1[p * 4] - b2[p * 4]; return f; };
  const bo = band(L(px(o))), ba = band(L(px(a)));
  const diff = new Uint8ClampedArray(n * 4), size = new Uint8ClampedArray(n * 4);
  for (let p = 0; p < n; p++) { diff[p * 4] = Math.min(255, Math.abs(bo[p] - ba[p]) * 2); size[p * 4] = Math.min(255, Math.abs(bo[p]) + Math.abs(ba[p]) + 4); diff[p * 4 + 3] = size[p * 4 + 3] = 255; }
  boxBlurRGBA(diff, w, h, 4); boxBlurRGBA(size, w, h, 4);
  const m = newCanvas(w, h), mx = m.getContext("2d"), md = mx.createImageData(w, h);
  for (let p = 0; p < n; p++) { const v = 255 * clamp01((PRO_FINISH.keep - diff[p * 4] / 2 / size[p * 4]) / PRO_FINISH.edge); md.data[p * 4] = md.data[p * 4 + 1] = md.data[p * 4 + 2] = v; md.data[p * 4 + 3] = 255; }
  mx.putImageData(md, 0, 0);
  const big = newCanvas(W, H), bx = big.getContext("2d", { willReadFrequently: true });
  bx.imageSmoothingQuality = "high"; bx.drawImage(m, 0, 0, W, H);
  return bx.getImageData(0, 0, W, H).data;
}
async function proFinish(src, aiSrc) {
  const [o, a] = await Promise.all([loadImg(src), loadImg(aiSrc)]);
  const W = o.naturalWidth, H = o.naturalHeight, n = W * H;
  const co = newCanvas(W, H), ox = co.getContext("2d", { willReadFrequently: true });
  ox.drawImage(o, 0, 0);
  const al = await alignAi(o, a, co, src, aiSrc, "|pro");
  const { ca, ax, fit, k0, aw, ah, faces, aiFaces, pts, matched, gap } = al;
  const O = ox.getImageData(0, 0, W, H).data, A = ax.getImageData(0, 0, W, H).data;
  const blurred = (d, s) => { const c = new Uint8ClampedArray(d); boxBlurRGBA(c, W, H, s); return c; };
  const out = new Float32Array(n * 3);
  for (let i = 0, j = 0; i < n * 4; i += 4, j += 3) { out[j] = A[i]; out[j + 1] = A[i + 1]; out[j + 2] = A[i + 2]; }

  // 1. Fine detail the model couldn't keep at its size, wherever it kept what was there.
  const sB = Math.max(1.2, 1.2 / (fit.s / k0));   // the model's own pixel, in photo pixels
  const Ob = blurred(O, sB), Ab = blurred(A, sB);
  const keep = changeMask(o, ca, W, H, Math.min(W, aw / fit.s * k0), Math.min(H, ah / fit.s * k0));
  for (let i = 0, j = 0, p = 0; i < n * 4; i += 4, j += 3, p++) {
    const t = keep[p * 4] / 255;
    if (!t) continue;
    for (let k = 0; k < 3; k++) out[j + k] += t * ((O[i + k] - Ob[i + k]) - (A[i + k] - Ab[i + k]));
  }

  // 2. Faces: the person's own features. Landmarks are found on both pictures; a face whose
  // outline or eyes moved more than PRO_FINISH.moved of its width is put back whole.
  let moved = 0;
  for (const f of faces) {
    const P = f.map(([x, y]) => [x * W, y * H]), faceW = dist(P[234], P[454]);
    if (faceW < 12) continue;
    const c0 = mean(FACE.oval.map((i) => P[i]));
    const Q = aiFaces.map((g) => g.map(([x, y]) => [x * W, y * H])).find((g) => dist(mean(FACE.oval.map((i) => g[i])), c0) < faceW * 0.3);
    const shift = Q ? pts.reduce((s, i) => s + dist(P[i], Q[i]), 0) / pts.length : Infinity;
    const whole = shift > faceW * PRO_FINISH.moved; if (whole) moved++;
    // The finer than this comes from the photo: a 28th of the face, or (put back whole) a quarter.
    const s = Math.max(1, faceW / (whole ? 4 : PRO_FINISH.faceDetail));
    // Work on a box around the face, its outline grown a little and feathered.
    const r = faceW * 1.1, x0 = Math.max(0, Math.floor(c0[0] - r)), y0 = Math.max(0, Math.floor(c0[1] - r * 1.25));
    const x1 = Math.min(W, Math.ceil(c0[0] + r)), y1 = Math.min(H, Math.ceil(c0[1] + r * 1.1)), w = x1 - x0, h = y1 - y0;
    if (w < 4 || h < 4) continue;
    const m = softMask(w, h, faceW / 16, (ctx) => { tracePoly(ctx, FACE.oval.map((i) => [(P[i][0] - c0[0]) * 1.06 + c0[0] - x0, (P[i][1] - c0[1]) * 1.06 + c0[1] - y0])); ctx.fill(); })
      .getContext("2d").getImageData(0, 0, w, h).data;
    const crop = (d) => { const c = new Uint8ClampedArray(w * h * 4); for (let y = 0; y < h; y++) c.set(d.subarray(((y0 + y) * W + x0) * 4, ((y0 + y) * W + x1) * 4), y * w * 4); return c; };
    const Oc = crop(O), cur = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const j = ((y0 + y) * W + x0 + x) * 3, i = (y * w + x) * 4;
      cur[i] = out[j]; cur[i + 1] = out[j + 1]; cur[i + 2] = out[j + 2]; cur[i + 3] = 255;
    }
    const Obc = new Uint8ClampedArray(Oc), Cb = new Uint8ClampedArray(cur);
    boxBlurRGBA(Obc, w, h, s); boxBlurRGBA(Cb, w, h, s);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4, t = m[i + 3] / 255; if (!t) continue;
      const j = ((y0 + y) * W + x0 + x) * 3;
      for (let k = 0; k < 3; k++) out[j + k] = cur[i + k] + t * ((Oc[i + k] - Obc[i + k]) - (cur[i + k] - Cb[i + k]));
    }
  }
  const img = ox.createImageData(W, H), d = img.data;
  for (let i = 0, j = 0; i < n * 4; i += 4, j += 3) { d[i] = out[j]; d[i + 1] = out[j + 1]; d[i + 2] = out[j + 2]; d[i + 3] = 255; }
  ox.putImageData(img, 0, 0);
  return { data: co.toDataURL("image/jpeg", 0.94), faces: faces.length, moved, matched, fit, gap };
}

// ---------- Pro Retouch: a retoucher's spot fixes, never a new face ----------
// Pro Edit's close-up pass (2026-11-05) sends the face sheet to an image model with a retouch-only
// brief. A model redraws everything, so nothing is taken whole. In each person's square only what
// looks like a retoucher's spot fix is kept: a small thing taken away (a blemish, a stray hair, a
// mark), where the retouched picture is smoother than the photo by a clear margin. Anything it
// added, anything big, and anything on the eyes, brows, lips and nostrils is left as it was, and
// a square whose face moved at all is skipped. Pores and fine texture stay the photo's own.
const PRO_RETOUCH = { moved: 0.02, spot: 1 / 22, minDrop: 0.8, fullDrop: 2.6, maxArea: 0.45, thick: 0.08, edge: 0.04 };
// A float box blur (three passes ≈ Gaussian) of one channel.
function blurF(a, W, H, sigma) {
  const out = new Float32Array(a), r = Math.max(1, Math.round((Math.sqrt(4 * sigma * sigma + 1) - 1) / 2)), tmp = new Float32Array(Math.max(W, H));
  const pass = (len, count, step, stride) => {
    for (let line = 0; line < count; line++) {
      const o = line * stride;
      for (let rep = 0; rep < 3; rep++) {
        let sum = 0;
        for (let k = -r; k <= r; k++) sum += out[o + Math.min(len - 1, Math.max(0, k)) * step];
        for (let j = 0; j < len; j++) { tmp[j] = sum / (2 * r + 1); sum += out[o + Math.min(len - 1, j + r + 1) * step] - out[o + Math.max(0, j - r) * step]; }
        for (let j = 0; j < len; j++) out[o + j * step] = tmp[j];
      }
    }
  };
  pass(W, H, 1, W); pass(H, W, W, 1);
  return out;
}
// One square: the photo's crop `O` and the retouched crop `R` (both C x C RGBA), the face's
// landmarks on each (0–1 of the square). Returns a C x C RGBA picture of the change to add
// (128 = none), or null to leave this person as they were.
function retouchSpots(O, R, C, Po, Pr) {
  const P = Po.map(([x, y]) => [x * C, y * C]), Q = Pr.map(([x, y]) => [x * C, y * C]);
  const faceW = dist(P[234], P[454]);
  if (faceW < 40) return { skip: "small" };
  const pts = [...FACE.oval, ...FACE.eyeL, ...FACE.eyeR, ...FACE.lipsOut, 1, 4, 6];
  // How far the features moved once lined up: the 90th percentile point, so a reshaped jaw or eye
  // counts even when the rest of the face stayed.
  const moves = pts.map((i) => dist(P[i], Q[i])).sort((x, y) => x - y), shift = moves[Math.floor(moves.length * 0.9)];
  if (shift > faceW * PRO_RETOUCH.moved) return { skip: "moved", shift: +(shift / faceW).toFixed(3) };
  const n = C * C, s = Math.max(1.5, faceW * PRO_RETOUCH.spot);
  // Detail at a spot's size: brightness, and redness (a red spot can be as bright as the skin).
  const bands = (d) => {
    const L = new Float32Array(n), Rd = new Float32Array(n);
    for (let p = 0; p < n; p++) { const i = p * 4; L[p] = lum(d[i], d[i + 1], d[i + 2]); Rd[p] = d[i] - d[i + 1]; }
    const Lb = blurF(L, C, C, s), Rb = blurF(Rd, C, C, s), e = new Float32Array(n);
    for (let p = 0; p < n; p++) e[p] = Math.abs(L[p] - Lb[p]) + 0.5 * Math.abs(Rd[p] - Rb[p]);
    return blurF(e, C, C, s / 2);
  };
  const eO = bands(O), eR = bands(R);
  // Kept: clearly smoother than the photo (something taken away), by a margin pores never reach.
  const w = new Float32Array(n);
  for (let p = 0; p < n; p++) { const fall = eO[p] - eR[p]; w[p] = smoothstep(PRO_RETOUCH.minDrop, PRO_RETOUCH.fullDrop, fall) * smoothstep(0.05, 0.18, fall / (eO[p] + 1)); }
  // Never on the features themselves, and not at the square's edge (the model can bleed there).
  const guard = newCanvas(C, C), g = guard.getContext("2d", { willReadFrequently: true });
  g.fillStyle = "#fff"; g.filter = `blur(${Math.max(1, Math.round(faceW / 60))}px)`;
  for (const eye of [FACE.eyeL, FACE.eyeR]) { const e = eye.map((i) => P[i]), c = mean(e), ew = dist(P[eye[0]], P[eye[8]]); g.beginPath(); g.ellipse(c[0], c[1], ew * 0.68, ew * 0.42, Math.atan2(P[eye[8]][1] - P[eye[0]][1], P[eye[8]][0] - P[eye[0]][0]), 0, 7); g.fill(); }
  g.lineWidth = faceW / 18; g.strokeStyle = "#fff"; g.lineJoin = "round";
  for (const br of [FACE.browL, FACE.browR]) { tracePoly(g, br.map((i) => P[i])); g.fill(); g.stroke(); }
  tracePoly(g, FACE.lipsOut.map((i) => P[i])); g.fill(); g.lineWidth = faceW / 40; g.stroke();
  g.beginPath(); g.ellipse(P[2][0], P[2][1] - faceW * 0.02, faceW * 0.11, faceW * 0.06, 0, 0, 7); g.fill();
  const gd = g.getImageData(0, 0, C, C).data, edge = C * PRO_RETOUCH.edge;
  // Where the lined-up retouched square doesn't reach (and a margin as wide as the detail's reach).
  const cover = new Float32Array(n); for (let p = 0; p < n; p++) cover[p] = R[p * 4 + 3] > 250 ? 1 : 0;
  const coverB = blurF(cover, C, C, s * 2.5);
  for (let y = 0; y < C; y++) for (let x = 0; x < C; x++) {
    const p = y * C + x, b = Math.min(x, y, C - 1 - x, C - 1 - y);
    w[p] *= (1 - gd[p * 4 + 3] / 255) * smoothstep(edge, edge * 2, b) * smoothstep(0.97, 0.999, coverB[p]);
  }
  // Only small things: a patch of change bigger than a spot is something else (a mole, an earring,
  // a shadow), so it stays as it was, unless it's thin (stray hairs). Checked on a quarter-size grid.
  const q = 4, gw = Math.ceil(C / q), gn = gw * gw, on = new Uint8Array(gn), lab = new Int32Array(gn).fill(-1);
  for (let y = 0; y < C; y += q) for (let x = 0; x < C; x += q) if (w[y * C + x] > 0.2) on[(y / q) * gw + x / q] = 1;
  const maxCells = (faceW * PRO_RETOUCH.maxArea) ** 2 / (q * q), drop = new Set();
  for (let c0 = 0, id = 0; c0 < gn; c0++) {
    if (!on[c0] || lab[c0] >= 0) continue;
    const stack = [c0]; lab[c0] = id; let size = 0, bx0 = gw, by0 = gw, bx1 = 0, by1 = 0;
    while (stack.length) {
      const c = stack.pop(); size++;
      const cx = c % gw, cy = (c - cx) / gw;
      bx0 = Math.min(bx0, cx); bx1 = Math.max(bx1, cx); by0 = Math.min(by0, cy); by1 = Math.max(by1, cy);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + dx, ny = cy + dy, nc = ny * gw + nx;
        if (nx >= 0 && ny >= 0 && nx < gw && ny < gw && on[nc] && lab[nc] < 0) { lab[nc] = id; stack.push(nc); }
      }
    }
    // How thick it is: its area over its length (the box's diagonal), in face widths.
    const thick = size * q / (Math.hypot(bx1 - bx0 + 1, by1 - by0 + 1) * faceW);
    if (size > maxCells && thick > PRO_RETOUCH.thick) drop.add(id);
    id++;
  }
  if (drop.size) for (let y = 0; y < C; y++) for (let x = 0; x < C; x++) {
    // A pixel takes the patch of its own grid cell, or of a neighbour (the patch's soft edge).
    let l = -1;
    for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) { const gx = (x >> 2) + dx, gy = (y >> 2) + dy; if (gx >= 0 && gy >= 0 && gx < gw && gy < gw && lab[gy * gw + gx] >= 0) { l = lab[gy * gw + gx]; break; } }
    if (l >= 0 && drop.has(l)) w[y * C + x] = 0;
  }
  const wf = blurF(w, C, C, s / 3);
  // The model is used to find what to fix, not to paint it: the fix itself is the photo's own skin
  // around the spot (done at the photo's size, in proRetouch) with the retouched picture's fine
  // texture, so a pixel's misalignment can't leave a ghost. Returned: that texture (128 = none)
  // in RGB and how much of the fix to take in A.
  const out = new Uint8ClampedArray(n * 4);
  let used = 0;
  for (let k = 0; k < 3; k++) {
    const r = new Float32Array(n); for (let p = 0; p < n; p++) r[p] = R[p * 4 + k];
    const rb = blurF(r, C, C, s * 2);
    for (let p = 0; p < n; p++) out[p * 4 + k] = 128 + (r[p] - rb[p]);
  }
  for (let p = 0; p < n; p++) { out[p * 4 + 3] = Math.round(255 * Math.min(1, wf[p] * 1.15)); if (wf[p] > 0.3) used++; }
  return { data: out, used: used / n, s, shift: +(shift / faceW).toFixed(3) };
}
// The retouched square drawn so its face lands on the photo's face: the best scale, turn and move
// (least squares) from the retouched landmarks Q to the photo's P (both 0–1 of the square). Where
// the moved picture leaves a gap, the photo's own square shows (no change there). Returns the
// aligned pixels and the moved landmarks, or null if the model changed the face's size too much.
function alignTo(cr, C, P, Q) {
  const idx = [...FACE.oval, ...FACE.eyeL, ...FACE.eyeR, 1, 4, 6, 168];
  const p = idx.map((i) => [P[i][0] * C, P[i][1] * C]), q = idx.map((i) => [Q[i][0] * C, Q[i][1] * C]);
  const mp = mean(p), mq = mean(q);
  let sxx = 0, sxy = 0, qq = 0;
  for (let i = 0; i < p.length; i++) {
    const ax = q[i][0] - mq[0], ay = q[i][1] - mq[1], bx = p[i][0] - mp[0], by = p[i][1] - mp[1];
    sxx += ax * bx + ay * by; sxy += ax * by - ay * bx; qq += ax * ax + ay * ay;
  }
  const a = sxx / qq, b = sxy / qq, k = Math.hypot(a, b);
  if (!(k > 0.75 && k < 1.33)) return { bad: +k.toFixed(3) };
  const tx = mp[0] - (a * mq[0] - b * mq[1]), ty = mp[1] - (b * mq[0] + a * mq[1]);
  const c = newCanvas(C, C), x = c.getContext("2d", { willReadFrequently: true });
  x.imageSmoothingQuality = "high"; x.setTransform(a, b, -b, a, tx, ty); x.drawImage(cr, 0, 0); x.setTransform(1, 0, 0, 1, 0, 0);
  const d = x.getImageData(0, 0, C, C).data;
  return { data: d, P: Q.map(([u, v]) => { const X = u * C, Y = v * C; return [(a * X - b * Y + tx) / C, (b * X + a * Y + ty) / C]; }), k };
}
// Puts the retouched spots of every square of the face sheet onto `src` (a data URL, the photo
// at full size). `sheet` is the face sheet as sent ({ data, cells, cols, w, cell }); `rtUrl` is
// the model's retouched sheet. Anything going wrong leaves `src` as it was.
async function proRetouch(src, sheet, rtUrl) {
  const [im, so, sr] = await Promise.all([loadImg(src), loadImg(sheet.data), loadImg(rtUrl)]);
  const SW = so.naturalWidth, SH = so.naturalHeight;
  if (Math.abs(sr.naturalWidth / sr.naturalHeight - SW / SH) > 0.02) return { data: src, people: 0, skipped: sheet.cells.length, why: ["shape"] };
  const C = sheet.cell, W = im.naturalWidth, H = im.naturalHeight;
  const cut = (img, i) => {
    const k = img.naturalWidth / SW, c = newCanvas(C, C), x = c.getContext("2d", { willReadFrequently: true });
    x.imageSmoothingQuality = "high";
    x.drawImage(img, (i % sheet.cols) * C * k, Math.floor(i / sheet.cols) * C * k, C * k, C * k, 0, 0, C, C);
    return c;
  };
  const base = newCanvas(W, H), bx = base.getContext("2d", { willReadFrequently: true });
  bx.drawImage(im, 0, 0);
  let people = 0, skipped = 0;
  const why = [];
  for (const [i, f] of sheet.cells.entries()) {
    const co = cut(so, i), cr = cut(sr, i);
    // The face nearest the middle of each square (where the sheet put it).
    const near = (fs) => fs.map((g) => [g, dist(mean(FACE.oval.map((j) => g[j])), [0.5, 0.5])]).filter(([, d]) => d < 0.2).sort((a, b) => a[1] - b[1])[0]?.[0];
    const key = "rt" + sheet.data.length + sheet.data.slice(-40) + "|" + i;
    const Po = near(await findFaces(key + "o", co).catch(() => [])), Pr = Po && near(await findFaces(key + "r" + rtUrl.length + rtUrl.slice(-40), cr).catch(() => []));
    // The model often answers a little zoomed or shifted: line its face up with the photo's (scale,
    // turn and move only, from the face's outline, eyes and nose), so what's left is real change.
    const al = Po && Pr ? alignTo(cr, C, Po, Pr) : null;
    const ch = al && !al.bad ? retouchSpots(co.getContext("2d").getImageData(0, 0, C, C).data, al.data, C, Po, al.P) : al ? { skip: "scale", shift: al.bad } : null;
    if (!ch || ch.skip) { skipped++; why.push(ch ? ch.skip + (ch.shift ? " " + ch.shift : "") : Po ? "no face on retouched" : "no face"); continue; }
    why.push("ok " + ch.shift);
    people++;
    // The square back at the photo's size, exactly where it was cut from.
    const S = f.side * W, x0 = f.cx * W - S / 2, y0 = f.cy * H - S / 2;
    const ax0 = Math.max(0, Math.floor(x0)), ay0 = Math.max(0, Math.floor(y0)), ax1 = Math.min(W, Math.ceil(x0 + S)), ay1 = Math.min(H, Math.ceil(y0 + S));
    const rw = ax1 - ax0, rh = ay1 - ay0;
    if (rw < 2 || rh < 2) continue;
    const tex = newCanvas(C, C), alpha = newCanvas(C, C);
    const td = new Uint8ClampedArray(ch.data), ad = new Uint8ClampedArray(ch.data.length);
    for (let j = 0; j < td.length; j += 4) { ad[j] = ad[j + 1] = ad[j + 2] = td[j + 3]; ad[j + 3] = 255; td[j + 3] = 255; }
    tex.getContext("2d").putImageData(new ImageData(td, C, C), 0, 0); alpha.getContext("2d").putImageData(new ImageData(ad, C, C), 0, 0);
    const at = (cv) => { const c = newCanvas(rw, rh), x = c.getContext("2d", { willReadFrequently: true }); x.fillStyle = "rgb(128,128,128)"; x.fillRect(0, 0, rw, rh); x.imageSmoothingQuality = "high"; x.drawImage(cv, x0 - ax0, y0 - ay0, S, S); return x.getImageData(0, 0, rw, rh).data; };
    const T = at(tex), A = at(alpha);
    // The photo's own skin around each spot: the region blurred at about twice a spot's size.
    const sig = Math.max(1.5, ch.s * 2 * S / C), region = bx.getImageData(ax0, ay0, rw, rh), rd = region.data, bl = new Uint8ClampedArray(rd);
    boxBlurRGBA(bl, rw, rh, sig);
    for (let j = 0; j < rd.length; j += 4) {
      const t = (A[j] - 128 * 0) / 255;
      if (t < 0.004) continue;
      for (let k = 0; k < 3; k++) rd[j + k] += t * (bl[j + k] + (T[j + k] - 128) - rd[j + k]);
    }
    bx.putImageData(region, ax0, ay0);
  }
  return { data: people ? base.toDataURL("image/jpeg", 0.94) : src, people, skipped, why };
}

// Edge-preserving skin smoothing for still photos, using the camera's beauty shader.
function glSmooth(srcCanvas, spread) {
  return beautyTiled(srcCanvas, { smooth: 100, bright: 0, warm: 0 }, spread) || filtered(srcCanvas, `blur(${Math.round(spread * 3)}px)`);
}
// Runs the beauty shader over a canvas in tiles of up to 2048px, so a full-size photo never
// needs a texture bigger than a phone's GPU allows. Each tile carries a margin as wide as the
// shader's reach, so the seams match. `spread` scales the reach with the photo's size.
// Returns null when WebGL isn't available.
function beautyTiled(src, b, spread = 1) {
  const W = src.width, H = src.height, T = 1024, m = Math.ceil(6 * spread) + 2;
  const tile = newCanvas(1, 1), g = initGl(tile);
  if (!g) return null;
  const out = newCanvas(W, H), octx = out.getContext("2d");
  const piece = newCanvas(1, 1), pctx = piece.getContext("2d");
  try {
    for (let y = 0; y < H; y += T) for (let x = 0; x < W; x += T) {
      const x0 = Math.max(0, x - m), y0 = Math.max(0, y - m), x1 = Math.min(W, x + T + m), y1 = Math.min(H, y + T + m);
      const w = x1 - x0, h = y1 - y0;
      piece.width = tile.width = w; piece.height = tile.height = h;
      pctx.drawImage(src, x0, y0, w, h, 0, 0, w, h);
      // Some phones quietly give WebGL a smaller drawing buffer than asked; its output would then
      // be shifted and scaled, and show as a seam. Use the plain path instead.
      if (g.gl.drawingBufferWidth !== w || g.gl.drawingBufferHeight !== h) return null;
      g.gl.viewport(0, 0, w, h);
      g.gl.texImage2D(g.gl.TEXTURE_2D, 0, g.gl.RGB, g.gl.RGB, g.gl.UNSIGNED_BYTE, piece);
      drawBeauty(g, w / spread, h / spread, false, b);
      const cw = Math.min(T, W - x), ch = Math.min(T, H - y);
      octx.drawImage(tile, x - x0, y - y0, cw, ch, x, y, cw, ch);
    }
  } finally { const lose = g.gl.getExtension("WEBGL_lose_context"); if (lose) lose.loseContext(); }
  // The shader works in RGB; put back any transparency the photo had.
  octx.globalCompositeOperation = "destination-in"; octx.drawImage(src, 0, 0);
  // A last check that the GPU's picture lines up with the photo (a smoothed copy differs only
  // in fine detail, so small thumbnails match); if not, the plain path is used.
  const thumb = (cv) => { const t = newCanvas(48, Math.max(1, Math.round(48 * H / W))), tx = t.getContext("2d", { willReadFrequently: true }); tx.drawImage(cv, 0, 0, t.width, t.height); return tx.getImageData(0, 0, t.width, t.height).data; };
  const ta = thumb(src), tb = thumb(out); let diff = 0;
  for (let i = 0; i < ta.length; i += 4) diff += Math.abs(lum(ta[i], ta[i + 1], ta[i + 2]) - lum(tb[i], tb[i + 1], tb[i + 2]));
  if (diff / (ta.length / 4) > 6) return null;
  return out;
}
// MediaPipe only needs a modest copy to find landmarks; results are in 0–1 coordinates.
function detectCopy(c, max = 2048) {
  const s = Math.min(1, max / Math.max(c.width, c.height));
  if (s === 1) return c;
  const d = newCanvas(Math.round((c.width * s) / 2) * 2, Math.round((c.height * s) / 2) * 2);
  d.getContext("2d").drawImage(c, 0, 0, d.width, d.height);
  return d;
}

// Body reshape: MediaPipe's pose model finds the shoulders, hips, knees and
// ankles, and its person mask finds the body's outline. Free, on the phone.
const POSE_MODEL = "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task";
let poseFinderPromise = null;
function poseFinder() {
  if (!poseFinderPromise) poseFinderPromise = (async () => {
    const { vision, fileset } = await visionLib();
    return vision.PoseLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: native ? "vendor/pose_landmarker_lite.task" : POSE_MODEL },
      runningMode: "IMAGE", numPoses: 1, outputSegmentationMasks: true,
    });
  })().catch(() => { poseFinderPromise = null; throw new Error("Couldn't load the body tools. Check your connection and try again."); });
  return poseFinderPromise;
}

// Pinches the area around segment a→b toward its centre line (s > 0 = thinner).
function pinchLine(ctx, a, b, r, s) {
  const len = dist(a, b); if (len < 2) return;
  const ux = (b[0] - a[0]) / len, uy = (b[1] - a[1]) / len;
  const c = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], R = len / 2 + r;
  warp(ctx, c, R, (dx, dy) => {
    const along = dx * ux + dy * uy, across = -dx * uy + dy * ux;
    const ta = Math.max(0, 1 - (Math.abs(along) / (len / 2 + r * 0.5)) ** 2), tc = Math.max(0, 1 - (across / r) ** 2);
    const k = 1 + s * ta * tc;
    return [along * ux - across * k * uy, along * uy + across * k * ux];
  });
}

async function bodyEdit(src, toolId, amt) {
  const [finder, img] = await Promise.all([poseFinder(), loadImg(src)]);
  const c = canvasFor(img), ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, c.width, c.height);
  // Detect on a small copy with even sides (odd widths crash MediaPipe's mask output).
  const sc = Math.min(1, 640 / Math.max(c.width, c.height)), small = newCanvas(Math.round((c.width * sc) / 4) * 4, Math.round((c.height * sc) / 4) * 4);
  small.getContext("2d").drawImage(c, 0, 0, small.width, small.height);
  let res;
  try { res = finder.detect(small); } catch { poseFinderPromise = null; throw new Error("Couldn't read the body in this photo. Try another photo."); }
  const lm = res.landmarks && res.landmarks[0];
  const mask = res.segmentationMasks && res.segmentationMasks[0];
  if (!lm) throw new Error("Couldn't find a body. Use a photo that shows you from head to hips or lower.");
  const W = c.width, H = c.height, P = lm.map((p) => [p.x * W, p.y * H]);
  const seen = (i) => (lm[i].visibility ?? 1) > 0.5 && lm[i].y > 0 && lm[i].y < 1;
  const need = (ids, what) => { if (!ids.every(seen)) throw new Error(`Couldn't see your ${what} clearly in this photo. Try a photo that shows more of your body.`); };
  // The body's outline from the person mask, so pushes start at the real edge.
  const conf = mask ? mask.getAsFloat32Array() : null, mw = mask ? mask.width : 0, mh = mask ? mask.height : 0;
  const inBody = (x, y) => {
    if (!conf) return true;
    const mx = Math.min(mw - 1, Math.max(0, Math.round((x / W) * mw))), my = Math.min(mh - 1, Math.max(0, Math.round((y / H) * mh)));
    return conf[my * mw + mx] > 0.5;
  };
  const edges = (y, cx, maxW) => {
    let l = cx, r = cx;
    while (l > cx - maxW && inBody(l - 1, y)) l--;
    while (r < cx + maxW && inBody(r + 1, y)) r++;
    return [l, r];
  };
  const shoulderW = dist(P[11], P[12]);
  const squeeze = (y, cx, s, rr) => {
    const [l, r] = edges(y, cx, shoulderW * 1.2), w = r - l;
    if (w < 4) return;
    push(ctx, [l, y], rr, [w * s, 0]);
    push(ctx, [r, y], rr, [-w * s, 0]);
  };
  const ops = {
    bwaist(a) {
      need([11, 12, 23, 24], "waist");
      for (const t of [0.62, 0.72, 0.82]) {
        const y = P[11][1] + ((P[23][1] + P[24][1]) / 2 - P[11][1]) * t, cx = (P[11][0] + P[12][0] + P[23][0] + P[24][0]) / 4;
        squeeze(y, cx, 0.05 * a, shoulderW * 0.35);
      }
    },
    bhips(a) {
      need([23, 24], "hips");
      const y = (P[23][1] + P[24][1]) / 2, cx = (P[23][0] + P[24][0]) / 2;
      for (const dy of [-0.05, 0.08, 0.2]) squeeze(y + shoulderW * dy, cx, 0.045 * a, shoulderW * 0.4);
    },
    barms(a) {
      need([11, 12, 13, 14], "arms");
      for (const [s, e, w] of [[11, 13, 15], [12, 14, 16]]) {
        pinchLine(ctx, P[s], P[e], shoulderW * 0.2, 0.35 * a);
        if (seen(w)) pinchLine(ctx, P[e], P[w], shoulderW * 0.15, 0.3 * a);
      }
    },
    blegs(a) {
      need([23, 24], "legs");
      // Stretch the legs: from the hips down to the ankles (or knees) gets taller.
      const y0 = Math.round(Math.max(P[23][1], P[24][1]));
      const feet = [27, 28].filter(seen), knees = [25, 26].filter(seen);
      const y1 = Math.round(feet.length ? Math.max(...feet.map((i) => P[i][1])) : knees.length ? Math.max(...knees.map((i) => P[i][1])) : H);
      if (y1 - y0 < H * 0.1) throw new Error("Couldn't see your legs. Use a full-body photo.");
      const d = Math.round((y1 - y0) * 0.12 * a), out = newCanvas(W, H + d), o = out.getContext("2d");
      o.drawImage(c, 0, 0, W, y0, 0, 0, W, y0);
      o.drawImage(c, 0, y0, W, y1 - y0, 0, y0, W, y1 - y0 + d);
      o.drawImage(c, 0, y1, W, H - y1, 0, y1 + d, W, H - y1);
      return out;
    },
    // Subtle, capped body tools (idea 14, 2026-11-02): at full strength each changes the outline by
    // only a few percent, so the person still looks like themselves.
    // Posture: shoulders levelled a little and the neck lengthened a touch.
    bposture(a) {
      need([0, 11, 12], "shoulders");
      const [L, R] = [P[11], P[12]], dy = L[1] - R[1], r = shoulderW * 0.45;
      // The lower shoulder comes up by up to half the difference (never more than 4% of shoulder width).
      const lift = Math.min(Math.abs(dy) / 2, shoulderW * 0.04) * a;
      if (lift > 0.5) push(ctx, dy > 0 ? L : R, r, [0, -lift]);
      const neck = [(L[0] + R[0]) / 2, Math.min(L[1], R[1]) - shoulderW * 0.12];
      push(ctx, [neck[0], (neck[1] + P[0][1]) / 2], shoulderW * 0.35, [0, -shoulderW * 0.03 * a]);
    },
    // Tailor fit: baggy fabric at the torso's sides pulled in slightly, chest to hips, like a tailored shirt.
    btailor(a) {
      need([11, 12, 23, 24], "upper body");
      for (const t of [0.3, 0.45, 0.6, 0.75, 0.9]) {
        const y = P[11][1] + ((P[23][1] + P[24][1]) / 2 - P[11][1]) * t, cx = (P[11][0] + P[12][0] + P[23][0] + P[24][0]) / 4;
        squeeze(y, cx, 0.025 * a, shoulderW * 0.3);
      }
    },
    bslimlegs(a) {
      need([23, 24, 25, 26], "legs");
      for (const [h, k, an] of [[23, 25, 27], [24, 26, 28]]) {
        pinchLine(ctx, P[h], P[k], shoulderW * 0.25, 0.25 * a);
        if (seen(an)) pinchLine(ctx, P[k], P[an], shoulderW * 0.18, 0.2 * a);
      }
    },
  };
  const out = ops[toolId](amt) || c;
  if (res.close) res.close();
  return /^data:image\/png/.test(src) ? out.toDataURL("image/png") : out.toDataURL("image/jpeg", 0.92);
}

// Hair color: MediaPipe's hair model finds the hair; the color is blended in so
// the hair's own light and shine stay. Free, on the phone.
const HAIR_MODEL = "https://storage.googleapis.com/mediapipe-models/image_segmenter/hair_segmenter/float32/latest/hair_segmenter.tflite";
let hairFinderPromise = null;
function hairFinder() {
  if (!hairFinderPromise) hairFinderPromise = (async () => {
    const { vision, fileset } = await visionLib();
    return vision.ImageSegmenter.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: native ? "vendor/hair_segmenter.tflite" : HAIR_MODEL },
      runningMode: "IMAGE", outputConfidenceMasks: true, outputCategoryMask: false,
    });
  })().catch(() => { hairFinderPromise = null; throw new Error("Couldn't load the hair tool. Check your connection and try again."); });
  return hairFinderPromise;
}
async function hairColor(src, amt, color) {
  const [seg, img] = await Promise.all([hairFinder(), loadImg(src)]);
  const c = canvasFor(img), ctx = c.getContext("2d");
  ctx.drawImage(img, 0, 0, c.width, c.height);
  const res = seg.segment(detectCopy(c)), masks = res.confidenceMasks || [];
  const m = masks[masks.length - 1], conf = m.getAsFloat32Array();
  const mc = newCanvas(m.width, m.height), mctx = mc.getContext("2d"), px = mctx.createImageData(m.width, m.height);
  let hairPx = 0;
  for (let i = 0; i < conf.length; i++) { const v = Math.max(0, Math.min(1, (conf[i] - 0.45) / 0.35)); px.data[i * 4 + 3] = v * 255; if (v > 0.5) hairPx++; }
  if (res.close) res.close();
  if (hairPx < conf.length * 0.005) throw new Error("Couldn't find hair in this photo.");
  mctx.putImageData(px, 0, 0);
  const mask = newCanvas(c.width, c.height), mk = mask.getContext("2d");
  drawWith(mk, `blur(${Math.max(1, Math.round(c.width / 500))}px)`, (y) => y.drawImage(mc, 0, 0, c.width, c.height));
  // Lift dark hair a little so the new color shows, then take the color's hue and saturation.
  const tint = filtered(c, "brightness(1.35) contrast(0.95)"), t = tint.getContext("2d");
  t.globalCompositeOperation = "color"; t.fillStyle = color; t.fillRect(0, 0, c.width, c.height);
  blendMasked(ctx, tint, mask, 0.3 + amt * 0.6);
  return /^data:image\/png/.test(src) ? c.toDataURL("image/png") : c.toDataURL("image/jpeg", 0.92);
}

// A new background behind the subject. `bg` paints it (a function) or is a picture to fill the
// frame with. For a photo background she is matched to it a little: its color is let into her
// edges (light wrap) and her overall tone moves slightly toward its tone, so she sits in it.
async function backdrop(src, bg, o = {}) {
  if (bg === "blur") return portraitBlur(src, o.level ?? 2);
  const img = await loadImg(src), c = canvasFor(img), cx = c.getContext("2d", { willReadFrequently: true });
  cx.drawImage(img, 0, 0, c.width, c.height);
  const W = c.width, H = c.height, alpha = await matte(src, c), subj = subjectLayer(c, alpha);
  const back = newCanvas(W, H), bx = back.getContext("2d", { willReadFrequently: true });
  if (typeof bg === "function") bg(bx, W, H, img);
  else {
    // A soft blur is drawn a little larger than the frame, so its edges don't fade to dark.
    const p = await loadImg(bg), r = o.blur ? Math.round(Math.max(W, H) / 150) : 0;
    const k = Math.max((W + 4 * r) / p.naturalWidth, (H + 4 * r) / p.naturalHeight);
    drawWith(bx, r ? `blur(${r}px)` : "none", (y) => y.drawImage(p, (W - p.naturalWidth * k) / 2, (H - p.naturalHeight * k) / 2, p.naturalWidth * k, p.naturalHeight * k));
  }
  const out = newCanvas(W, H), ox = out.getContext("2d", { willReadFrequently: true });
  ox.drawImage(back, 0, 0); ox.drawImage(subj, 0, 0);
  if (o.match) {
    const bd = bx.getImageData(0, 0, W, H).data, soft = newCanvas(W, H), sx = soft.getContext("2d", { willReadFrequently: true });
    drawWith(sx, `blur(${Math.max(3, Math.round(Math.max(W, H) / 120))}px)`, (y) => y.drawImage(back, 0, 0));
    const sb = sx.getImageData(0, 0, W, H).data, d = ox.getImageData(0, 0, W, H), D = d.data;
    let mr = 0, mg = 0, mb = 0, n = 0, sr = 0, sg = 0, sbl = 0, sn = 0;
    for (let i = 0; i < alpha.length; i += 9) {
      const j = i * 4; mr += bd[j]; mg += bd[j + 1]; mb += bd[j + 2]; n++;
      if (alpha[i] > 0.9) { sr += D[j]; sg += D[j + 1]; sbl += D[j + 2]; sn++; }
    }
    const tint = sn ? [mr / n - sr / sn, mg / n - sg / sn, mb / n - sbl / sn].map((v) => v * 0.12) : [0, 0, 0];
    // How far inside the edge each pixel is, from a blurred copy of the alpha.
    const ac = newCanvas(W, H), ax = ac.getContext("2d", { willReadFrequently: true }), ad = ax.createImageData(W, H);
    for (let i = 0; i < alpha.length; i++) ad.data[i * 4 + 3] = alpha[i] * 255;
    ax.putImageData(ad, 0, 0);
    const ab = newCanvas(W, H), abx = ab.getContext("2d", { willReadFrequently: true });
    drawWith(abx, `blur(${Math.max(2, Math.round(Math.max(W, H) / 250))}px)`, (y) => y.drawImage(ac, 0, 0));
    const inner = abx.getImageData(0, 0, W, H).data;
    for (let i = 0; i < alpha.length; i++) {
      const a = alpha[i]; if (a < 0.02) continue;
      const j = i * 4, wrap = a * (1 - inner[j + 3] / 255) * 0.9;
      for (let ch = 0; ch < 3; ch++) { const v = D[j + ch] + tint[ch] * a; D[j + ch] = v + (sb[j + ch] - v) * wrap; }
    }
    ox.putImageData(d, 0, 0);
  }
  return out.toDataURL("image/jpeg", 0.92);
}
// ---------- Portrait blur ----------
// Background blur like a phone camera's portrait mode. The people are cut out one at a time: the
// person segmenter (256 px, made for selfies) runs on squares around each main face and on down
// their body, so a full-length or group photo gets a fine outline instead of one blurry blob for
// the whole picture. Only what joins a main face is kept; people further back blur with the room.
// The blur then grows with distance: in a full-length photo the floor is sharp at their feet and
// softer toward the horizon, and everything above that is the far background. Levels 1–3 are
// Low, Medium and High, and even High keeps the room recognizable.
const BLUR_LEVELS = [0, 0.0018, 0.0038, 0.0068, 0.0095];   // blur radius, as a share of the photo's width (4: the editor's Strong); each level clearly stronger
// `keep` (optional, an object kept by the caller): the faces and cutout found the first time are
// reused for the same photo at another level or look, so a second level is quick.
async function portraitBlur(src, level = 2, keep = null) {
  const img = await loadImg(src), c = canvasFor(img), cx = c.getContext("2d", { willReadFrequently: true });
  cx.drawImage(img, 0, 0, c.width, c.height);
  const W = c.width, H = c.height, R = W * (BLUR_LEVELS[level] ?? BLUR_LEVELS[2]);
  if (!R) return c.toDataURL("image/jpeg", 0.92);
  let faces = [], main, alpha;
  if (keep && keep.alpha && keep.W === W && keep.H === H) ({ alpha, main } = keep);
  else {
    try { faces = await findFaces(src, c); } catch { /* no face model: blur around the whole-picture cutout */ }
    const bx = faces.map(boxOf).map(([x, y, w, h]) => [x * W, y * H, w * W, h * H]);
    const big = Math.max(0, ...bx.map((b) => b[2]));
    main = bx.filter((b) => b[2] >= 0.55 * big);
    alpha = main.length ? await peopleMatte(c, main) : await matte(src, c);
    if (keep) Object.assign(keep, { alpha, main, W, H });
  }
  // Where they stand: the lowest row of the cutout, and whether their whole body is in the picture.
  let feet = 0;
  for (let y = H - 1; y >= 0 && !feet; y--) for (let x = 0; x < W; x += 2) if (alpha[y * W + x] > 0.5) { feet = y; break; }
  const fh = Math.max(0, ...main.map((b) => b[3])), fy = Math.max(0, ...main.map((b) => b[1] + b[3] / 2));
  const full = main.length && feet - fy > 5 * fh, horizon = fy + 1.5 * fh;   // the camera is about at chest height
  const sharp = cx.getImageData(0, 0, W, H).data;
  const keepOut = alpha.wide || alpha;   // the room alone, without the person's edge
  const half = cleanBackground(c, keepOut, R / 2).getContext("2d").getImageData(0, 0, W, H).data;
  const most = cleanBackground(c, keepOut, R).getContext("2d").getImageData(0, 0, W, H).data;
  const out = newCanvas(W, H), ox = out.getContext("2d", { willReadFrequently: true }), od = ox.createImageData(W, H), D = od.data;
  for (let y = 0; y < H; y++) {
    // 0 = in focus, 1 = the far background. On the floor: how far that row is from their feet.
    let t = full && y > horizon ? Math.min(1, Math.abs(1 - (y - horizon) / Math.max(1, feet - horizon)) * 1.15) : 1;
    t = Math.max(0.12, t);
    const [A, B, f] = t < 0.5 ? [sharp, half, t * 2] : [half, most, t * 2 - 1];
    for (let j = y * W * 4, e = j + W * 4; j < e; j += 4) {
      D[j] = A[j] + (B[j] - A[j]) * f; D[j + 1] = A[j + 1] + (B[j + 1] - A[j + 1]) * f; D[j + 2] = A[j + 2] + (B[j + 2] - A[j + 2]) * f; D[j + 3] = 255;
    }
  }
  ox.putImageData(od, 0, 0); ox.drawImage(subjectLayer(c, alpha), 0, 0);
  return out.toDataURL("image/jpeg", 0.92);
}
// Shrinks a 0–1 mask by r pixels (the smallest value nearby, rows then columns).
function erode(a, w, h, r) {
  const t = new Float32Array(w * h), o = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let m = 1; for (let k = Math.max(0, x - r), e = Math.min(w - 1, x + r); k <= e; k++) m = Math.min(m, a[y * w + k]); t[y * w + x] = m; }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let m = 1; for (let k = Math.max(0, y - r), e = Math.min(h - 1, y + r); k <= e; k++) m = Math.min(m, t[k * w + x]); o[y * w + x] = m; }
  return o;
}
// The alpha (0–1 per pixel of c) of the people whose faces are `boxes` (pixels of c).
async function peopleMatte(c, boxes) {
  const W = c.width, H = c.height, seg = await segmenter(), S = 256;
  const k = Math.min(1, 1600 / Math.max(W, H)), w = Math.round(W * k), h = Math.round(H * k);
  const acc = newCanvas(w, h), ax = acc.getContext("2d", { willReadFrequently: true });
  ax.fillStyle = "#000"; ax.fillRect(0, 0, w, h); ax.globalCompositeOperation = "lighten"; ax.imageSmoothingQuality = "high";
  const tile = newCanvas(S, S), tx = tile.getContext("2d", { willReadFrequently: true });
  for (const b of boxes) {
    const fw = Math.max(b[2], b[3]), mid = b[0] + b[2] / 2, side = Math.min(W, H, fw * 5.5);
    for (let top = Math.max(0, b[1] - fw); ;) {
      const y0 = Math.min(top, H - side), x0 = Math.max(0, Math.min(W - side, mid - side / 2));
      tx.drawImage(c, x0, y0, side, side, 0, 0, S, S);
      const r = seg.segment(tile), m = r.confidenceMasks[0], conf = m.getAsFloat32Array();
      const mc = newCanvas(m.width, m.height), mx = mc.getContext("2d"), px = mx.createImageData(m.width, m.height);
      for (let i = 0; i < conf.length; i++) { const v = Math.round(clamp01(conf[i]) * 255); px.data[i * 4] = px.data[i * 4 + 1] = px.data[i * 4 + 2] = v; px.data[i * 4 + 3] = 255; }
      if (r.close) r.close();
      mx.putImageData(px, 0, 0); ax.drawImage(mc, x0 * k, y0 * k, side * k, side * k);
      if (y0 + side >= H) break;
      top = y0 + side * 0.6;
    }
  }
  const md = ax.getImageData(0, 0, w, h).data, p = new Float32Array(w * h);
  for (let i = 0; i < p.length; i++) p[i] = clamp01((md[i * 4] / 255 - 0.25) / 0.5);
  // Keep only what joins one of the faces (a flood fill on a coarse grid, then grown a little).
  const g = 3, gw = Math.ceil(w / g), gh = Math.ceil(h / g), on = new Uint8Array(gw * gh), keep = new Uint8Array(gw * gh), near = new Uint8Array(gw * gh);
  for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) on[y * gw + x] = p[Math.min(h - 1, y * g) * w + Math.min(w - 1, x * g)] > 0.5 ? 1 : 0;
  const stack = boxes.map((b) => Math.min(gh - 1, Math.floor((b[1] + b[3] / 2) * k / g)) * gw + Math.min(gw - 1, Math.floor((b[0] + b[2] / 2) * k / g)));
  while (stack.length) {
    const i = stack.pop(); if (keep[i] || !on[i]) continue;
    keep[i] = 1; const x = i % gw;
    if (x > 0) stack.push(i - 1); if (x < gw - 1) stack.push(i + 1); if (i >= gw) stack.push(i - gw); if (i + gw < gw * gh) stack.push(i + gw);
  }
  for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) if (keep[y * gw + x])
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) { const X = x + dx, Y = y + dy; if (X >= 0 && Y >= 0 && X < gw && Y < gh) near[Y * gw + X] = 1; }
  const I = new Float32Array(w * h), cc = newCanvas(w, h), cg = cc.getContext("2d", { willReadFrequently: true });
  cg.drawImage(c, 0, 0, w, h); const gd = cg.getImageData(0, 0, w, h).data;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x; I[i] = lum(gd[i * 4], gd[i * 4 + 1], gd[i * 4 + 2]) / 255;
    if (!near[((y / g) | 0) * gw + ((x / g) | 0)]) p[i] = 0;
  }
  // The same edge refinement as matte(), finer: snap the outline, then follow the hair.
  let q = guided(I, p, w, h, Math.max(4, Math.round(w / 150)), 1e-3);
  q = guided(I, q, w, h, Math.max(2, Math.round(w / 400)), 2e-4);
  // A firm cutout, pulled in a little from the edge and then feathered, so no strip of the room
  // stays sharp beside an ear, jaw or shoulder (the background blurs right up to the person).
  // `wide` (the edge as found, hair fringe included) is what the blurred room leaves out, so no
  // dark halo of hair is smeared around the head.
  const wide = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) { wide[i] = smoothstep(0.15, 0.85, q[i]); q[i] = smoothstep(0.3, 0.9, q[i]); }
  q = erode(q, w, h, Math.max(1, Math.round(w / 450)));
  const full = (m, feather) => {
    const ac = newCanvas(w, h), acx = ac.getContext("2d"), ad = acx.createImageData(w, h);
    for (let i = 0; i < w * h; i++) ad.data[i * 4 + 3] = Math.round(m[i] * 255);
    acx.putImageData(ad, 0, 0);
    const out = newCanvas(W, H), ox = out.getContext("2d", { willReadFrequently: true });
    ox.imageSmoothingQuality = "high"; drawWith(ox, feather ? `blur(${Math.max(1, Math.round(W / 900))}px)` : "none", (y) => y.drawImage(ac, 0, 0, W, H));
    const ab = ox.getImageData(0, 0, W, H).data, a = new Float32Array(W * H);
    for (let i = 0; i < a.length; i++) a[i] = ab[i * 4 + 3] / 255;
    return a;
  };
  const alpha = full(q, true); alpha.wide = full(wide, false);
  return alpha;
}
// The mask an AI scene repaints: white wherever the background is, including the soft edge of her
// hair, so the new scene meets her naturally; she herself stays her own pixels.
async function sceneMask(src) {
  const img = await loadImg(src), c = newCanvas(img.naturalWidth, img.naturalHeight), cx = c.getContext("2d", { willReadFrequently: true });
  cx.drawImage(img, 0, 0);
  const alpha = await matte(src, c), m = cx.createImageData(c.width, c.height);
  for (let i = 0; i < alpha.length; i++) { const v = alpha[i] < 0.92 ? 255 : 0; m.data[i * 4] = m.data[i * 4 + 1] = m.data[i * 4 + 2] = v; m.data[i * 4 + 3] = 255; }
  cx.putImageData(m, 0, 0);
  return c.toDataURL("image/png");
}
// An HD cutout from the AI: its alpha (or, for a black-and-white mask, its brightness), applied
// to the full-size photo, with the old background's color taken out of the edges.
async function applyCutout(baseSrc, resultSrc) {
  const [base, res] = await Promise.all([loadImg(baseSrc), loadImg(resultSrc)]);
  const W = base.naturalWidth, H = base.naturalHeight, c = newCanvas(W, H); c.getContext("2d").drawImage(base, 0, 0);
  const r = newCanvas(W, H), rx = r.getContext("2d", { willReadFrequently: true });
  rx.imageSmoothingQuality = "high"; rx.drawImage(res, 0, 0, W, H);
  const d = rx.getImageData(0, 0, W, H).data, alpha = new Float32Array(W * H);
  let clear = 0; for (let i = 3; i < d.length; i += 28) if (d[i] < 250) clear++;
  const own = clear > d.length / 28 * 0.01;
  for (let i = 0; i < alpha.length; i++) alpha[i] = own ? d[i * 4 + 3] / 255 : lum(d[i * 4], d[i * 4 + 1], d[i * 4 + 2]) / 255;
  return subjectLayer(c, alpha).toDataURL("image/png");
}

// Draws a canvas or image with one of the photo filters baked in.
// amt (0..1) is the filter's strength.
function withFilterCanvas(srcEl, filterId, w = srcEl.width, h = srcEl.height, amt = 1) {
  const flt = scaleFilter(FILTERS.find((f) => f.id === filterId) || FILTERS[0], amt);
  const c = newCanvas(w, h), ctx = c.getContext("2d");
  paintFilter(ctx, w, h, flt, (y) => y.drawImage(srcEl, 0, 0, w, h));
  return c;
}
function withFilter(srcEl, w, h, filterId) { return withFilterCanvas(srcEl, filterId, w, h).toDataURL("image/jpeg", 0.92); }

// Beauty shader: smooths skin, brightens and warms, live in the camera and on still photos.
const VERT = `attribute vec2 p; varying vec2 uv; uniform float mirror;
  void main() { uv = vec2(mirror > 0.5 ? 1.0 - (p.x * 0.5 + 0.5) : p.x * 0.5 + 0.5, 0.5 - p.y * 0.5); gl_Position = vec4(p, 0.0, 1.0); }`;
// Edge-preserving blur: neighbours that look like the centre pixel (skin) are
// averaged, while strong edges (eyes, lips, hair) are kept sharp.
const FRAG = `precision mediump float; varying vec2 uv; uniform sampler2D tex; uniform vec2 px;
  uniform float smooth_, bright, warm;
  void main() {
    vec3 c = texture2D(tex, uv).rgb; vec3 sum = c; float wsum = 1.0;
    for (int x = -3; x <= 3; x++) for (int y = -3; y <= 3; y++) {
      if (x == 0 && y == 0) continue;
      vec2 o = vec2(float(x), float(y)) * px * 2.0;
      vec3 s = texture2D(tex, uv + o).rgb;
      float d = distance(s, c);
      float w = exp(-d * d * 60.0) * exp(-float(x * x + y * y) / 18.0);
      sum += s * w; wsum += w;
    }
    vec3 smoothed = sum / wsum;
    vec3 col = mix(c, smoothed, smooth_);
    col = pow(col, vec3(1.0 - bright * 0.35));
    col += vec3(0.06, 0.025, -0.03) * warm;
    gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
  }`;

function initGl(canvas) {
  const gl = canvas.getContext("webgl", { preserveDrawingBuffer: true });
  if (!gl) return null;
  const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; };
  const prog = gl.createProgram();
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(prog); gl.useProgram(prog);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, "p");
  gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
  for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]])
    gl.texParameteri(gl.TEXTURE_2D, k, v);
  const u = (n) => gl.getUniformLocation(prog, n);
  return { gl, px: u("px"), smooth: u("smooth_"), bright: u("bright"), warm: u("warm"), mirror: u("mirror") };
}

function drawBeauty(g, w, h, mirror, b) {
  const { gl } = g;
  gl.uniform2f(g.px, 1 / w, 1 / h);
  gl.uniform1f(g.smooth, b.smooth / 100);
  gl.uniform1f(g.bright, b.bright / 100);
  gl.uniform1f(g.warm, b.warm / 100);
  gl.uniform1f(g.mirror, mirror ? 1 : 0);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}

// "My Look" for gallery photos: the same beauty filter as the camera, run once on a still photo.
// The shader's reach grows with the photo, so a full-size save looks like the 2048px preview.
async function applyLook(src, look, amt = 1) {
  if (amt < 1) {   // Strength: the look blended over the photo, like a filter's
    const [full, img] = await Promise.all([applyLook(src, look, 1).then(loadImg), loadImg(src)]);
    const c = newCanvas(full.naturalWidth, full.naturalHeight), x = c.getContext("2d");
    x.drawImage(img, 0, 0, c.width, c.height); x.globalAlpha = Math.max(0, amt); x.drawImage(full, 0, 0);
    return encode(c, src);
  }
  const img = await loadImg(src), c = canvasFor(img);
  c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
  const out = beautyTiled(c, look, Math.max(1, Math.max(c.width, c.height) / 2048));
  if (!out) throw new Error("This phone can't run My Look.");
  const res = newCanvas(c.width, c.height), ctx = res.getContext("2d");
  ctx.drawImage(withFilterCanvas(out, look.filter, out.width, out.height, (look.filterAmt ?? 100) / 100), 0, 0);
  if (isPng(src)) { ctx.globalCompositeOperation = "destination-in"; ctx.drawImage(c, 0, 0); }
  return encode(res, src);
}

// Photo filters and the Edit adjustments, applied to a committed photo.
const isPng = (src) => /^data:image\/png/.test(src);
const encode = (c, src) => (isPng(src) ? c.toDataURL("image/png") : c.toDataURL("image/jpeg", 0.92));
// amt (0 to 1) blends the filtered picture over the original; 1 is the full filter.
async function applyFilter(src, flt, amt = 1) {
  const img = await loadImg(src), c = canvasFor(img), ctx = c.getContext("2d");
  paintFilter(ctx, c.width, c.height, flt, (y) => y.drawImage(img, 0, 0, c.width, c.height));
  if (amt >= 1) return encode(c, src);
  const out = newCanvas(c.width, c.height), o = out.getContext("2d");
  o.drawImage(img, 0, 0, c.width, c.height); o.globalAlpha = Math.max(0, amt); o.drawImage(c, 0, 0);
  return encode(out, src);
}
// ---------- Full / Person / Background for Adjust ----------
// Where the people are (0–1 per pixel of c): the same cutout Background Blur uses (the person
// segmenter on squares around each main face and down their body), or the whole-picture cutout when
// no face is found. Kept for the last two pictures, so dragging a slider doesn't cut them out again.
const personCache = [];
// edits: the Refine brush's strokes, [{ add, w, pts }] in 0–1 of the photo's width and height.
async function personAlpha(src, c, edits) {
  const base = await personBase(src, c);
  if (!edits || !edits.length) return base;
  const key = JSON.stringify(edits), hit = personCache.find((e) => e.src === src && e.w === c.width && e.h === c.height && e.key === key);
  if (hit) return hit.alpha;
  const alpha = refineAlpha(c, base, edits);
  personCache.unshift({ src, w: c.width, h: c.height, key, alpha }); personCache.length = Math.min(personCache.length, 3);
  return alpha;
}
async function personBase(src, c) {
  const W = c.width, H = c.height, hit = personCache.find((e) => e.src === src && e.w === W && e.h === H && !e.key);
  if (hit) return hit.alpha;
  let faces = [];
  try { faces = await findFaces(src, c); } catch { /* no face model: the whole-picture cutout */ }
  const bx = faces.map(boxOf).map(([x, y, w, h]) => [x * W, y * H, w * W, h * H]);
  const big = Math.max(0, ...bx.map((b) => b[2])), main = bx.filter((b) => b[2] >= 0.55 * big);
  // In the phone apps, the phone's own cutout (Google ML Kit / Apple Vision) when it answers;
  // otherwise the on-device web models.
  let alpha = null;
  try { alpha = await nativePeople(c, main); } catch { alpha = null; }
  if (!alpha) {
    alpha = main.length ? await peopleMatte(c, main) : await matte(src, c);
    if (main.length === 1) await clipToBody(c, alpha, main[0]);
  }
  let on = 0, n = 0; for (let i = 0; i < alpha.length; i += 17) { on += alpha[i]; n++; }
  if (on / n < 0.01 || (!main.length && on / n > 0.97)) throw unavailable("No person found in this photo, so Person and Background can't be used. Full still works.");
  personCache.unshift({ src, w: W, h: H, alpha }); personCache.length = Math.min(personCache.length, 3);
  return alpha;
}
// The Refine brush: Add paints the person in, Remove takes them out. Each stroke snaps to the
// edges in the photo inside its own width (the edge-aware filter, guided by the photo), so a
// rough stroke along a sleeve follows the sleeve. Strokes are applied in order.
function refineAlpha(c, base, edits) {
  const W = c.width, H = c.height, k = Math.min(1, 1000 / Math.max(W, H)), w = Math.round(W * k), h = Math.round(H * k);
  const sm = newCanvas(w, h), sx = sm.getContext("2d", { willReadFrequently: true });
  sx.imageSmoothingQuality = "high"; sx.drawImage(c, 0, 0, w, h);
  const sd = sx.getImageData(0, 0, w, h).data, I = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) { const r = sd[i * 4], g = sd[i * 4 + 1], b = sd[i * 4 + 2]; I[i] = (lum(r, g, b) + (r - b) * 0.8 + (g - (r + b) / 2) * 0.5) / 255; }
  // The person at working size, edited stroke by stroke.
  const big = newCanvas(W, H), bx = big.getContext("2d", { willReadFrequently: true }), bd = bx.createImageData(W, H);
  for (let i = 0; i < base.length; i++) bd.data[i * 4 + 3] = base[i] * 255;
  bx.putImageData(bd, 0, 0);
  const ac = newCanvas(w, h), ax = ac.getContext("2d", { willReadFrequently: true });
  ax.imageSmoothingQuality = "high"; ax.drawImage(big, 0, 0, w, h);
  const ad = ax.getImageData(0, 0, w, h), a = new Float32Array(w * h);
  for (let i = 0; i < a.length; i++) a[i] = ad.data[i * 4 + 3] / 255;
  const st = newCanvas(w, h), stx = st.getContext("2d", { willReadFrequently: true });
  stx.lineCap = stx.lineJoin = "round";
  for (const e of edits) {
    stx.clearRect(0, 0, w, h); stx.strokeStyle = "#fff"; stx.lineWidth = Math.max(2, e.w * w); stx.beginPath();
    e.pts.forEach(([x, y], i) => (i ? stx.lineTo : stx.moveTo).call(stx, x * w, y * h));
    if (e.pts.length === 1) stx.lineTo(e.pts[0][0] * w + 0.1, e.pts[0][1] * h);
    stx.stroke();
    const m = stx.getImageData(0, 0, w, h).data, M = new Float32Array(w * h);
    let x0 = w, y0 = h, x1 = 0, y1 = 0;
    for (let i = 0; i < M.length; i++) if ((M[i] = m[i * 4 + 3] / 255) > 0) { const x = i % w, y = (i / w) | 0; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    if (x1 < x0) continue;
    // Inside the stroke, the target is what the photo's edges say: start from "all in" (Add) or
    // "all out" (Remove) where the stroke's core is, keep the old cutout elsewhere, and let the
    // guided filter pull the boundary to the nearest edge in the photo.
    const p = new Float32Array(w * h);
    for (let i = 0; i < p.length; i++) p[i] = M[i] > 0.5 ? (e.add ? 1 : 0) : a[i];
    const q = guided(I, p, w, h, Math.max(2, Math.round(e.w * w / 4)), 1e-3);
    for (let i = 0; i < a.length; i++) if (M[i] > 0) {
      const v = clamp01(q[i]), snap = e.add ? Math.max(a[i], smoothstep(0.35, 0.65, v)) : Math.min(a[i], smoothstep(0.35, 0.65, v));
      a[i] += (snap - a[i]) * M[i];
    }
  }
  for (let i = 0; i < a.length; i++) ad.data[i * 4 + 3] = Math.round(a[i] * 255);
  ax.putImageData(ad, 0, 0);
  bx.clearRect(0, 0, W, H); bx.imageSmoothingQuality = "high"; bx.drawImage(ac, 0, 0, W, H);
  const up = bx.getImageData(0, 0, W, H).data, out = new Float32Array(W * H);
  // Only where a stroke went does the result change; everywhere else keeps the full-size edge.
  const touched = newCanvas(w, h), tx = touched.getContext("2d", { willReadFrequently: true });
  tx.lineCap = tx.lineJoin = "round"; tx.strokeStyle = "#fff";
  for (const e of edits) { tx.lineWidth = Math.max(2, e.w * w) + 4; tx.beginPath(); e.pts.forEach(([x, y], i) => (i ? tx.lineTo : tx.moveTo).call(tx, x * w, y * h)); if (e.pts.length === 1) tx.lineTo(e.pts[0][0] * w + 0.1, e.pts[0][1] * h); tx.stroke(); }
  const tb = newCanvas(W, H), tbx = tb.getContext("2d", { willReadFrequently: true }); tbx.drawImage(touched, 0, 0, W, H);
  const td = tbx.getImageData(0, 0, W, H).data;
  for (let i = 0; i < out.length; i++) { const t = td[i * 4 + 3] / 255; out[i] = base[i] + (up[i * 4 + 3] / 255 - base[i]) * t; }
  return out;
}
// The Refine view: the photo's background tinted red over a transparent person, at the size of
// the picture `src` (the brush draws it over the photo).
async function areaOverlay(src, edits) {
  const img = await loadImg(src), c = canvasFor(img); c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
  const alpha = await personAlpha(src, c, edits), o = newCanvas(c.width, c.height), ox = o.getContext("2d"), d = ox.createImageData(c.width, c.height);
  for (let i = 0; i < alpha.length; i++) { d.data[i * 4] = 235; d.data[i * 4 + 1] = 40; d.data[i * 4 + 2] = 55; d.data[i * 4 + 3] = (1 - alpha[i]) * 150; }
  ox.putImageData(d, 0, 0);
  return o;
}
// The phone's own person cutout (the GlowCutout plugin in mobile/: ML Kit subject segmentation on
// Android, Vision person segmentation on iPhone). ML Kit returns every subject separately (a person,
// a sofa, a bag), so only those under one of the main faces are kept. Returns null without it.
const cutoutPlugin = () => (typeof native !== "undefined" && native && window.Capacitor.Plugins && window.Capacitor.Plugins.GlowCutout) || window.__glowCutoutForTests || null;
async function nativePeople(c, boxes) {
  const plug = cutoutPlugin(); if (!plug) return null;
  const W = c.width, H = c.height, k = Math.min(1, 1600 / Math.max(W, H));
  const sm = newCanvas(Math.round(W * k), Math.round(H * k)); sm.getContext("2d").drawImage(c, 0, 0, sm.width, sm.height);
  const r = await plug.people({ image: sm.toDataURL("image/jpeg", 0.9) });
  if (!r || !r.subjects || !r.subjects.length) return null;
  const centers = boxes.map((b) => [(b[0] + b[2] / 2) / W, (b[1] + b[3] / 2) / H]);
  const subs = r.subjects.map((s) => {
    const bin = atob(s.mask), m = new Uint8Array(bin.length); for (let i = 0; i < m.length; i++) m[i] = bin.charCodeAt(i);
    const at = ([x, y]) => { const u = (x - s.x) / s.w, v = (y - s.y) / s.h; if (u < 0 || v < 0 || u >= 1 || v >= 1) return 0; return m[Math.floor(v * s.mh) * s.mw + Math.floor(u * s.mw)] / 255; };
    return { s, m, area: s.w * s.h, face: centers.some((p) => at(p) > 0.5) };
  });
  const keep = r.engine === "vision" ? subs : centers.length ? subs.filter((x) => x.face) : subs.sort((a, b) => b.area - a.area).slice(0, 1);
  if (!keep.length) return null;
  const acc = newCanvas(W, H), ax = acc.getContext("2d", { willReadFrequently: true });
  ax.globalCompositeOperation = "lighten"; ax.imageSmoothingQuality = "high";
  for (const { s, m } of keep) {
    const mc = newCanvas(s.mw, s.mh), mx = mc.getContext("2d"), d = mx.createImageData(s.mw, s.mh);
    for (let i = 0; i < m.length; i++) { d.data[i * 4] = d.data[i * 4 + 1] = d.data[i * 4 + 2] = m[i]; d.data[i * 4 + 3] = 255; }
    mx.putImageData(d, 0, 0); ax.drawImage(mc, s.x * W, s.y * H, s.w * W, s.h * H);
  }
  const ad = ax.getImageData(0, 0, W, H).data, alpha = new Float32Array(W * H);
  let on = 0;
  for (let i = 0; i < alpha.length; i++) { alpha[i] = ad[i * 4] / 255; on += alpha[i]; }
  return on / alpha.length > 0.005 ? alpha : null;
}
// One person: the body model's own outline (made for full-length shots) trims what the selfie
// segmenter wrongly joined to them, such as a pale floor or sofa beside a pale top. Its outline is
// coarse, so it is grown a little and only ever takes away, never adds. Around the head (face box
// `fb`, pixels of c) the cutout is left alone, since the body model trims long hair.
async function clipToBody(c, alpha, fb) {
  let res;
  // A small copy with sides a multiple of 4 (odd sizes crash MediaPipe's mask output).
  const sc = Math.min(1, 640 / Math.max(c.width, c.height)), small = newCanvas(Math.max(4, Math.round((c.width * sc) / 4) * 4), Math.max(4, Math.round((c.height * sc) / 4) * 4));
  small.getContext("2d").drawImage(c, 0, 0, small.width, small.height);
  try { res = (await poseFinder()).detect(small); } catch { return; }
  const m = res && res.segmentationMasks && res.segmentationMasks[0];
  if (!m) { if (res && res.close) res.close(); return; }
  const conf = m.getAsFloat32Array(), mc = newCanvas(m.width, m.height), mx = mc.getContext("2d"), px = mx.createImageData(m.width, m.height);
  let on = 0;
  for (let i = 0; i < conf.length; i++) { const v = clamp01((conf[i] - 0.2) / 0.4); if (v > 0.5) on++; px.data[i * 4] = px.data[i * 4 + 1] = px.data[i * 4 + 2] = 255; px.data[i * 4 + 3] = v * 255; }
  if (res.close) res.close();
  if (on < conf.length * 0.02) return;   // the body model missed them: keep the cutout as it is
  mx.putImageData(px, 0, 0);
  const W = c.width, H = c.height, k = Math.min(1, 900 / Math.max(W, H)), w = Math.round(W * k), h = Math.round(H * k);
  const g = newCanvas(w, h), gx = g.getContext("2d", { willReadFrequently: true });
  gx.imageSmoothingQuality = "high"; gx.drawImage(mc, 0, 0, w, h);
  // Grow just past the body model's edge (its outline sits a little inside sleeves and hips).
  const grown = filtered(g, `blur(${Math.max(1, Math.round(w / 140))}px)`).getContext("2d", { willReadFrequently: true }).getImageData(0, 0, w, h).data;
  const fw = fb ? Math.max(fb[2], fb[3]) : 0, hx0 = fb ? fb[0] + fb[2] / 2 - fw * 1.3 : 0, hx1 = fb ? fb[0] + fb[2] / 2 + fw * 1.3 : 0;
  const hy1 = fb ? fb[1] + fb[3] * 1.9 : -1;   // down to the shoulders, where long hair ends
  for (let y = 0; y < H; y++) {
    const gy = Math.min(h - 1, Math.floor(y * k)) * w, head = y < hy1;
    for (let x = 0; x < W; x++) {
      const i = y * W + x; if (alpha[i] <= 0) continue;
      const b = smoothstep(0.12, 0.4, grown[(gy + Math.min(w - 1, Math.floor(x * k))) * 4 + 3] / 255);
      // Around the head the body outline only fades in, so hair beside the face is kept.
      const keep = head && x > hx0 && x < hx1 ? 1 - smoothstep(hy1 - fw * 0.6, hy1, y) : 0;
      alpha[i] *= b + (1 - b) * keep;
    }
  }
  // The body outline is coarse, so the trimmed edge is snapped back to the edges in the photo:
  // the same edge-aware (guided) filter as the cutout, guided by brightness and colour together.
  const sm = newCanvas(w, h), sx = sm.getContext("2d", { willReadFrequently: true });
  sx.imageSmoothingQuality = "high"; sx.drawImage(c, 0, 0, w, h);
  const sd = sx.getImageData(0, 0, w, h).data, I = new Float32Array(w * h), p = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const r = sd[i * 4], gg = sd[i * 4 + 1], bb = sd[i * 4 + 2];
    I[i] = (lum(r, gg, bb) + (r - bb) * 0.8 + (gg - (r + bb) / 2) * 0.5) / 255;   // brightness plus warm/cool and green/magenta, so a grey top stands out from a cream wall
  }
  const ac = newCanvas(w, h), ax = ac.getContext("2d", { willReadFrequently: true }), ad = ax.createImageData(w, h);
  const big = newCanvas(W, H), bgx = big.getContext("2d", { willReadFrequently: true }), bd = bgx.createImageData(W, H);
  for (let i = 0; i < alpha.length; i++) bd.data[i * 4 + 3] = alpha[i] * 255;
  bgx.putImageData(bd, 0, 0); ax.imageSmoothingQuality = "high"; ax.drawImage(big, 0, 0, w, h);
  const shrunk = ax.getImageData(0, 0, w, h).data;
  for (let i = 0; i < w * h; i++) p[i] = shrunk[i * 4 + 3] / 255;
  const q = guided(I, p, w, h, Math.max(3, Math.round(w / 120)), 2e-4);
  // Snapping can tighten an edge (never adds far outside it), but never cuts into what the body
  // model is sure is them, such as a sleeve folded the same colour as the floor.
  const core = gx.getImageData(0, 0, w, h).data;
  for (let i = 0; i < w * h; i++) ad.data[i * 4 + 3] = Math.round(Math.max(smoothstep(0.25, 0.75, Math.min(p[i] + 0.25, q[i])), p[i] * smoothstep(0.55, 0.85, core[i * 4 + 3] / 255)) * 255);
  ax.putImageData(ad, 0, 0);
  bgx.clearRect(0, 0, W, H); bgx.imageSmoothingQuality = "high"; bgx.drawImage(ac, 0, 0, W, H);
  const up = bgx.getImageData(0, 0, W, H).data;
  for (let i = 0; i < alpha.length; i++) {
    const y = (i / W) | 0, x = i - y * W, head = y < hy1 && x > hx0 && x < hx1;
    if (!head) alpha[i] = up[i * 4 + 3] / 255;   // hair keeps the cutout's own fine edge
  }
}
// Small pictures for the Full / Person / Background chips, the chosen area tinted red
// (as Photoshop Express shows it). Throws (unavailable) when there's no person in the photo.
async function areaThumbs(src, size = 96, edits) {
  const img = await loadImg(src), c = canvasFor(img); c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
  const alpha = await personAlpha(src, c, edits), W = c.width, H = c.height;
  const k = size / Math.max(W, H), w = Math.max(1, Math.round(W * k)), h = Math.max(1, Math.round(H * k));
  const t = newCanvas(w, h), tx = t.getContext("2d", { willReadFrequently: true });
  tx.imageSmoothingQuality = "high"; tx.drawImage(c, 0, 0, w, h);
  const base = tx.getImageData(0, 0, w, h), shot = (pick) => {
    const d = new ImageData(new Uint8ClampedArray(base.data), w, h), D = d.data;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const a = alpha[Math.min(H - 1, Math.floor((y + 0.5) / k)) * W + Math.min(W - 1, Math.floor((x + 0.5) / k))];
      const m = (pick === "person" ? a : 1 - a) * 0.72, j = (y * w + x) * 4;
      D[j] += (235 - D[j]) * m; D[j + 1] += (40 - D[j + 1]) * m; D[j + 2] += (55 - D[j + 2]) * m; D[j + 3] = 255;
    }
    tx.putImageData(d, 0, 0); return t.toDataURL("image/jpeg", 0.85);
  };
  const full = (tx.putImageData(base, 0, 0), t.toDataURL("image/jpeg", 0.85));
  return { full, person: shot("person"), bg: shot("bg") };
}
// v runs from -50 to 50, with 0 meaning no change (the noise tools run from 0 to 100).
// area: "full" (the whole photo), "person" (only the people) or "bg" (everything but them).
async function adjust(src, kind, v, area = "full", edits) {
  const { c, img } = await adjustCanvas(src, kind, v);
  if (area !== "person" && area !== "bg") return encode(c, src);
  const o = newCanvas(c.width, c.height), ox = o.getContext("2d", { willReadFrequently: true });
  ox.drawImage(img, 0, 0, c.width, c.height);
  const alpha = await personAlpha(src, o, edits), od = ox.getImageData(0, 0, o.width, o.height), D = od.data;
  const A = c.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, c.width, c.height).data, bg = area === "bg";
  for (let i = 0, j = 0; i < alpha.length; i++, j += 4) {
    const a = bg ? 1 - alpha[i] : alpha[i]; if (a <= 0) continue;
    D[j] += (A[j] - D[j]) * a; D[j + 1] += (A[j + 1] - D[j + 1]) * a; D[j + 2] += (A[j + 2] - D[j + 2]) * a;
  }
  ox.putImageData(od, 0, 0);
  return encode(o, src);
}
const toLin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const toSrgb = (v) => 255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);
// A blurred copy's pixels (Gaussian-like, via the canvas filter or a box blur where that's missing).
function blurData(c, r) { return filtered(c, `blur(${Math.max(1, Math.round(r))}px)`).getContext("2d", { willReadFrequently: true }).getImageData(0, 0, c.width, c.height).data; }
async function adjustCanvas(src, kind, v) {
  const img = await loadImg(src), c = canvasFor(img), ctx = c.getContext("2d", { willReadFrequently: kind !== "light" && kind !== "color" });
  const t = v / 50;
  const f = kind === "light" ? `brightness(${1 + t * 0.35}) contrast(${1 + t * 0.08})` : kind === "color" ? `saturate(${1 + t * 0.6})` : kind === "contrast" && t ? `contrast(${1 + t * 0.3})` : "none";
  drawWith(ctx, f, (y) => y.drawImage(img, 0, 0, c.width, c.height));
  if (kind === "warmth" && t) {
    ctx.globalCompositeOperation = "soft-light"; ctx.globalAlpha = Math.abs(t) * 0.35;
    ctx.fillStyle = t > 0 ? "#ff9a3c" : "#3c8cff"; ctx.fillRect(0, 0, c.width, c.height);
  }
  if (["highlights", "shadows", "vibrance", "fade", "grain"].includes(kind) && t) {
    const a = ctx.getImageData(0, 0, c.width, c.height), d = a.data, W = c.width;
    const soft = kind === "grain" && t < 0 ? filtered(c, `blur(${Math.max(1, Math.round(c.width / 700))}px)`).getContext("2d").getImageData(0, 0, c.width, c.height).data : null;
    const amp = Math.max(1, c.width / 1200);   // grain size follows the photo, so the full-size save matches
    for (let i = 0, p = 0; i < d.length; i += 4, p++) {
      const r = d[i], g = d[i + 1], b = d[i + 2], l = lum(r, g, b) / 255;
      let add = 0;
      if (kind === "highlights") { const w = Math.max(0, (l - 0.4) / 0.6); add = t * w * w * 55; }
      if (kind === "shadows") { const w = Math.max(0, 1 - l / 0.6); add = t * w * w * 80; }
      if (kind === "vibrance") {
        // Lifts the dull colors most and leaves the already-strong ones (and skin) gentler.
        const s = (Math.max(r, g, b) - Math.min(r, g, b)) / 255, k = t * 0.6 * (1 - s) * (1 - s), m = (r + g + b) / 3;
        d[i] = m + (r - m) * (1 + k); d[i + 1] = m + (g - m) * (1 + k); d[i + 2] = m + (b - m) * (1 + k); continue;
      }
      if (kind === "fade") {
        // Right: lifted, matte blacks. Left: richer, deeper blacks.
        for (let ch = 0; ch < 3; ch++) { const v = d[i + ch]; d[i + ch] = t > 0 ? v * (1 - 0.16 * t) + 40 * t : v - (-t) * 30 * (1 - v / 255) ** 2; }
        continue;
      }
      if (kind === "grain") {
        if (soft) { const k = -t * 0.7; for (let ch = 0; ch < 3; ch++) d[i + ch] += (soft[i + ch] - d[i + ch]) * k; continue; }
        const x = Math.floor((p % W) / amp), y = Math.floor(p / W / amp), h = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
        add = (h - Math.floor(h) - 0.5) * t * 44 * (1 - Math.abs(l - 0.5));
      }
      d[i] = r + add; d[i + 1] = g + add; d[i + 2] = b + add;
    }
    ctx.putImageData(a, 0, 0);
  }
  if (kind === "tint" && t) {
    ctx.globalCompositeOperation = "soft-light"; ctx.globalAlpha = Math.abs(t) * 0.18;
    ctx.fillStyle = t > 0 ? "#e040b0" : "#40c060"; ctx.fillRect(0, 0, c.width, c.height);
  }
  if (kind === "vignette" && t) {
    const W = c.width, H = c.height, g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.hypot(W, H) / 2);
    const col = t > 0 ? "0,0,0" : "255,255,255"; g.addColorStop(0, `rgba(${col},0)`); g.addColorStop(1, `rgba(${col},${Math.abs(t) * 0.65})`);
    ctx.globalCompositeOperation = "source-over"; ctx.globalAlpha = 1; ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  }
  if (kind === "detail" && t) {
    // Unsharp mask: add back the difference from a blurred copy (negative values soften).
    const blur = filtered(c, `blur(${Math.max(1, Math.round(c.width / 900))}px)`);
    const a = ctx.getImageData(0, 0, c.width, c.height), b = blur.getContext("2d").getImageData(0, 0, c.width, c.height).data, d = a.data;
    const k = t * 1.2;
    for (let i = 0; i < d.length; i += 4) for (let ch = 0; ch < 3; ch++) d[i + ch] += (d[i + ch] - b[i + ch]) * k;
    ctx.putImageData(a, 0, 0);
  }
  if (["exposure", "whites", "blacks"].includes(kind) && t) {
    // One lookup table per tool. Exposure works in linear light, like a camera's stops (±1 stop),
    // with a soft shoulder so bright skies don't clip at once. Whites and Blacks move the ends of
    // the tone curve and leave the middle alone.
    const lut = new Float32Array(256);
    for (let i = 0; i < 256; i++) {
      const x = i / 255;
      if (kind === "exposure") { const l = toLin(i) * 2 ** t, s = l > 0.8 ? 0.8 + (1 - Math.exp(-(l - 0.8) / 0.2)) * 0.2 : l; lut[i] = toSrgb(Math.min(1, s)); }
      if (kind === "whites") lut[i] = i + t * 50 * x ** 3 * (t > 0 ? 1 - x * 0.35 : 1);
      if (kind === "blacks") lut[i] = i + t * 45 * (1 - x) ** 3;
    }
    const a = ctx.getImageData(0, 0, c.width, c.height), d = a.data;
    for (let i = 0; i < d.length; i += 4) { d[i] = lut[d[i]]; d[i + 1] = lut[d[i + 1]]; d[i + 2] = lut[d[i + 2]]; }
    ctx.putImageData(a, 0, 0);
  }
  if (kind === "texture" && t) {
    // Medium-fine detail only (a band between two blurs): right brings out fabric, hair and
    // skin texture, left softens it. Edges and big shapes are left as they are.
    const W = c.width, f = blurData(c, W / 1400), g = blurData(c, W / 350);
    const a = ctx.getImageData(0, 0, W, c.height), d = a.data, k = t > 0 ? t * 1.6 : t * 0.9;
    for (let i = 0; i < d.length; i += 4) for (let ch = 0; ch < 3; ch++) d[i + ch] += (f[i + ch] - g[i + ch]) * k;
    ctx.putImageData(a, 0, 0);
  }
  if (kind === "clarity" && t) {
    // Local contrast over a wide radius, strongest in the midtones (Lightroom's Clarity idea).
    // Left gives a soft, dreamy glow.
    const W = c.width, g = blurData(c, W / 60), a = ctx.getImageData(0, 0, W, c.height), d = a.data;
    for (let i = 0; i < d.length; i += 4) {
      const l = lum(d[i], d[i + 1], d[i + 2]) / 255, w = 1 - (2 * l - 1) ** 2, k = (t > 0 ? t * 0.9 : t * 0.35) * w;
      const dl = (l * 255 - lum(g[i], g[i + 1], g[i + 2])) * k;
      d[i] += dl; d[i + 1] += dl; d[i + 2] += dl;
    }
    ctx.putImageData(a, 0, 0);
  }
  if (kind === "dehaze" && t) {
    // A light version of the dark-channel method: haze lifts the darkest channel everywhere, so
    // the blurred darkest channel estimates the haze, and the haze colour is taken from the
    // haziest pixels. Right removes it; left adds a soft haze.
    const W = c.width, H = c.height, a = ctx.getImageData(0, 0, W, H), d = a.data;
    const dc = newCanvas(W, H), dx = dc.getContext("2d", { willReadFrequently: true }), dd = dx.createImageData(W, H);
    for (let i = 0; i < d.length; i += 4) { const m = Math.min(d[i], d[i + 1], d[i + 2]); dd.data[i] = dd.data[i + 1] = dd.data[i + 2] = m; dd.data[i + 3] = 255; }
    dx.putImageData(dd, 0, 0);
    const dark = blurData(dc, Math.max(W, H) / 80);
    const hist = new Uint32Array(256); for (let i = 0; i < dark.length; i += 4) hist[dark[i]]++;
    let cut = 255; for (let n = 0, top = d.length / 4 * 0.002; cut > 0 && n < top; cut--) n += hist[cut];
    let ar = 0, ag = 0, ab = 0, an = 0;
    for (let i = 0; i < d.length; i += 4) if (dark[i] >= cut) { ar += d[i]; ag += d[i + 1]; ab += d[i + 2]; an++; }
    const air = an ? [ar / an, ag / an, ab / an] : [255, 255, 255], am = Math.max(1, Math.min(...air));
    for (let i = 0; i < d.length; i += 4) {
      if (t > 0) {
        const tr = Math.max(0.6, 1 - 0.6 * t * (dark[i] / am)), mix = Math.min(1, t);
        for (let ch = 0; ch < 3; ch++) { const v0 = d[i + ch], j = (v0 - air[ch]) / tr + air[ch]; d[i + ch] = v0 + (j - v0) * mix; }
      } else for (let ch = 0; ch < 3; ch++) d[i + ch] += (air[ch] - d[i + ch]) * -t * 0.35;
    }
    ctx.putImageData(a, 0, 0);
  }
  if ((kind === "lnoise" || kind === "cnoise") && v > 0) {
    // Luminance noise: an edge-aware smoothing of brightness only (the guided filter the cutout
    // uses), so edges stay sharp. Colour noise: the colour is taken from a blurred copy while
    // the brightness stays as it was, which clears coloured speckles without softening detail.
    const W = c.width, H = c.height, a = ctx.getImageData(0, 0, W, H), d = a.data, k = Math.min(1, v / 100);
    if (kind === "lnoise") {
      const I = new Float32Array(W * H); for (let i = 0; i < I.length; i++) I[i] = lum(d[i * 4], d[i * 4 + 1], d[i * 4 + 2]) / 255;
      const q = guided(I, I, W, H, Math.max(2, Math.round(W / 700 * (0.6 + k))), 0.0002 + 0.0012 * k * k);
      for (let i = 0; i < I.length; i++) { const dl = (q[i] - I[i]) * 255 * k; d[i * 4] += dl; d[i * 4 + 1] += dl; d[i * 4 + 2] += dl; }
    } else {
      const g = blurData(c, W / 300 * (0.5 + k));
      for (let i = 0; i < d.length; i += 4) {
        const dl = lum(d[i], d[i + 1], d[i + 2]) - lum(g[i], g[i + 1], g[i + 2]);
        for (let ch = 0; ch < 3; ch++) d[i + ch] += (g[i + ch] + dl - d[i + ch]) * k;
      }
    }
    ctx.putImageData(a, 0, 0);
  }
  return { c, img };
}
// Rotates by quarter turns, then cuts out `r`, given as fractions of the rotated picture, so
// the same crop fits the working copy and the full-size original. A fixed shape (`aspect`,
// width / height) is kept exact in whole pixels.
// Straighten (a small angle, -45..45 degrees) and flips, on top of quarter turns. The picture keeps
// its quarter-turned size (RW x RH): a straightened photo is enlarged just enough to fill it, so no
// blank corners show (like every phone editor). Used by the crop preview and the full-size export.
function straightenScale(RW, RH, deg) {
  const a = Math.abs(deg || 0) * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  return Math.max((RW * c + RH * s) / RW, (RW * s + RH * c) / RH);
}
function drawOriented(ctx, img, RW, RH, q, o = {}) {
  const W = img.naturalWidth || img.width, H = img.naturalHeight || img.height, k = straightenScale(RW, RH, o.angle);
  ctx.translate(RW / 2, RH / 2);
  if (o.angle) ctx.rotate((o.angle * Math.PI) / 180);
  ctx.scale(k * (o.flipH ? -1 : 1), k * (o.flipV ? -1 : 1));
  ctx.rotate((q * Math.PI) / 2); ctx.drawImage(img, -W / 2, -H / 2);
}
async function cropRect(src, turns, r, aspect, o = {}) {
  const img = await loadImg(src), W = img.naturalWidth, H = img.naturalHeight, q = ((turns % 4) + 4) % 4;
  const RW = q % 2 ? H : W, RH = q % 2 ? W : H, x = r.x * RW, y = r.y * RH, w = r.w * RW, h = r.h * RH;
  const cw = Math.max(1, Math.round(w)), ch = Math.max(1, Math.min(Math.ceil(h), Math.round(aspect > 0 ? cw / aspect : h)));
  const c = newCanvas(cw, ch), ctx = c.getContext("2d");
  ctx.imageSmoothingQuality = "high";
  ctx.scale(cw / w, ch / h); ctx.translate(-x, -y);
  drawOriented(ctx, img, RW, RH, q, o);
  return encode(c, src);
}
// Crop to an aspect ratio around the centre, then rotate by quarter turns.
async function cropRotate(src, ratio, turns) {
  const img = await loadImg(src), W = img.naturalWidth, H = img.naturalHeight;
  let w = W, h = H;
  if (ratio) { if (W / H > ratio) w = Math.round(H * ratio); else h = Math.round(W / ratio); }
  const q = ((turns % 4) + 4) % 4, c = newCanvas(q % 2 ? h : w, q % 2 ? w : h), ctx = c.getContext("2d");
  ctx.translate(c.width / 2, c.height / 2); ctx.rotate((q * Math.PI) / 2);
  ctx.drawImage(img, (W - w) / 2, (H - h) / 2, w, h, -w / 2, -h / 2, w, h);
  return encode(c, src);
}
