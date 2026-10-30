// Glow image engine: everything that changes pixels. Runs on the device
// (canvas, WebGL, MediaPipe); AI edits are started from app.js.

const BG_LABELS = { bgblur: "Blur background", bgremove: "Remove background", bgwhite: "White background",
  bgblush: "Blush background", bgsky: "Sky background" };
const BG_FILLS = {
  bgwhite: (ctx, w, h) => { ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, w, h); },
  bgblush: (ctx, w, h) => gradient(ctx, w, h, ["#ffd6e0", "#ffb3c7", "#f7a1c4"]),
  bgsky: (ctx, w, h) => gradient(ctx, w, h, ["#cfe9ff", "#9fd3ff", "#6fb8ff"]),
};
// On-phone filters: canvas filter chains plus an optional color wash.
const FILTERS = [
  { id: "none", name: "None", f: "none" },
  { id: "glow", name: "Glow", f: "brightness(1.08) contrast(0.95) saturate(1.1)", wash: "rgba(255,190,170,0.10)" },
  { id: "warm", name: "Warm", f: "saturate(1.2) contrast(1.05)", wash: "rgba(255,160,60,0.12)" },
  { id: "film", name: "Film", f: "contrast(1.1) saturate(0.85) sepia(0.18)", wash: "rgba(40,80,90,0.08)" },
  { id: "vivid", name: "Vivid", f: "saturate(1.45) contrast(1.12)" },
  { id: "soft", name: "Soft", f: "brightness(1.1) contrast(0.85) saturate(0.9)", wash: "rgba(255,255,255,0.08)" },
  { id: "cool", name: "Cool", f: "saturate(1.05) hue-rotate(-8deg)", wash: "rgba(80,140,255,0.10)" },
  { id: "mono", name: "Mono", f: "grayscale(1) contrast(1.15)" },
  { id: "noir", name: "Noir", f: "grayscale(1) contrast(1.5) brightness(0.9)" },
];

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
  return { image: c.toDataURL("image/jpeg", 0.92), mask: m.toDataURL("image/png") };
}

// Replicate URLs can be passed straight through; big client-made images get shrunk first.
async function uploadable(src) {
  if (!src.startsWith("data:")) return src;
  const img = await loadImg(src);
  if (Math.max(img.naturalWidth, img.naturalHeight) <= 1600 && src.length < 1_500_000) return src;
  const c = canvasFor(img, 1600);
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
      baseOptions: { modelAssetPath: native ? "vendor/face_landmarker.task" : FACE_MODEL }, runningMode: "IMAGE", numFaces: 4,
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
  bwaist: 45, bhips: 40, barms: 40, bslimlegs: 40, blegs: 40, hcolor: 60 };
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
// The CSS filter functions Glow uses, done on the pixels (premultiplied blur, as browsers do).
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
  const finder = await faceFinder();
  const faces = (finder.detect(detectCopy(c)).faceLandmarks || []).map((f) => f.map((p) => [p.x, p.y]));
  faceCache.set(src, faces); if (faceCache.size > 4) faceCache.delete(faceCache.keys().next().value);
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
  const found = await findFaces(src, c), chosen = pick && found.length > 1 ? nearestFace(found, pick) : null;
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
const GLOW_ORDER = ["fblemish", "fsmooth", "ftone", "fundereye", "fskin", "feyes", "fteeth", "fbrows", "fshadow", "fliner", "flashes", "feyecolor", "fcontour", "fbronzer", "fblush", "fhighlight", "flips", "fglam"];
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
async function autoLight(src) {
  const img = await loadImg(src), c = canvasFor(img), x = c.getContext("2d", { willReadFrequently: true });
  x.drawImage(img, 0, 0, c.width, c.height);
  const a = x.getImageData(0, 0, c.width, c.height), d = a.data, hist = new Uint32Array(256);
  for (let i = 0; i < d.length; i += 16) hist[Math.round(lum(d[i], d[i + 1], d[i + 2]))]++;
  const total = hist.reduce((s, v) => s + v, 0), at = (q) => { let s = 0; for (let v = 0; v < 256; v++) { s += hist[v]; if (s >= total * q) return v; } return 255; };
  const lo = Math.min(40, at(0.005)) * 0.6, hi = 255 - (255 - Math.max(200, at(0.995))) * 0.6, mid = at(0.5);
  const gamma = Math.max(0.85, Math.min(1.15, Math.log(0.5) / Math.log(Math.max(0.05, Math.min(0.95, (mid - lo) / (hi - lo))))));   // dark photos lift, bright ones settle
  const lut = new Uint8ClampedArray(256);
  for (let v = 0; v < 256; v++) lut[v] = 255 * Math.pow(Math.max(0, Math.min(1, (v - lo) / (hi - lo))), 1 / (1 + (1 / gamma - 1) * 0.6));
  for (let i = 0; i < d.length; i += 4) {
    const r = lut[d[i]], g = lut[d[i + 1]], b = lut[d[i + 2]], m = (r + g + b) / 3, s = (Math.max(r, g, b) - Math.min(r, g, b)) / 255, k = 0.18 * (1 - s) * (1 - s);
    d[i] = m + (r - m) * (1 + k); d[i + 1] = m + (g - m) * (1 + k); d[i + 2] = m + (b - m) * (1 + k);
  }
  x.putImageData(a, 0, 0);
  return encode(c, src);
}
// After an AI edit: if her face moved or changed shape (AI models sometimes redraw it), her own
// face from before is put back, matched to the new light, with a soft edge. Returns the photo
// and whether it did that.
async function restoreFace(baseSrc, resultSrc) {
  const [a, b] = await Promise.all([loadImg(baseSrc), loadImg(resultSrc)]);
  const W = a.naturalWidth, H = a.naturalHeight, ca = newCanvas(W, H), cb = newCanvas(W, H);
  ca.getContext("2d").drawImage(a, 0, 0); const bx = cb.getContext("2d", { willReadFrequently: true }); bx.drawImage(b, 0, 0, W, H);
  const k = Math.min(1, 1024 / Math.max(W, H)), small = (cv) => { const s = newCanvas(Math.round(W * k), Math.round(H * k)); s.getContext("2d").drawImage(cv, 0, 0, s.width, s.height); return s; };
  const sa = small(ca), sb = small(cb);
  const fa = await findFaces(baseSrc + "|restore", sa), fbs = await findFaces(resultSrc + "|restore", sb);
  if (!fa.length) return { data: resultSrc, moved: false };
  const big = (f) => f.reduce((m, P) => (dist(P[234], P[454]) > dist(m[234], m[454]) ? P : m));
  const A = big(fa).map(([x, y]) => [x * W, y * H]), faceW = dist(A[234], A[454]);
  let moved = !fbs.length;
  if (!moved) {
    const ca2 = mean(FACE.oval.map((i) => A[i])), B = fbs.map((f) => f.map(([x, y]) => [x * W, y * H]))
      .reduce((m, P) => (dist(mean(FACE.oval.map((i) => P[i])), ca2) < dist(mean(FACE.oval.map((i) => m[i])), ca2) ? P : m));
    const shift = [...FACE.oval, ...FACE.eyeL, ...FACE.eyeR].reduce((s, i) => s + dist(A[i], B[i]), 0) / (FACE.oval.length + FACE.eyeL.length + FACE.eyeR.length);
    moved = shift > faceW * 0.02;
  }
  if (!moved) return { data: resultSrc, moved: false };
  // Her face from before, nudged to the new photo's light and color, with a soft edge.
  const mask = softMask(W, H, faceW / 14, (m) => { tracePoly(m, FACE.oval.map((i) => A[i])); m.fill(); });
  const md = mask.getContext("2d").getImageData(0, 0, W, H).data, ad = ca.getContext("2d").getImageData(0, 0, W, H).data, bdat = bx.getImageData(0, 0, W, H), bd = bdat.data;
  const rgbMean = (d) => { const t = [0, 0, 0]; let n = 0; for (let i = 0; i < d.length; i += 16) { const w = md[i + 3] / 255; if (w > 0.5) { t[0] += d[i]; t[1] += d[i + 1]; t[2] += d[i + 2]; n++; } } return t.map((v) => v / Math.max(1, n)); };
  const ma = rgbMean(ad), mb = rgbMean(bd), shiftC = [0, 1, 2].map((k) => (mb[k] - ma[k]) * 0.7);
  for (let i = 0; i < bd.length; i += 4) {
    const w = md[i + 3] / 255; if (!w) continue;
    for (let k = 0; k < 3; k++) bd[i + k] += (ad[i + k] + shiftC[k] - bd[i + k]) * w;
  }
  bx.putImageData(bdat, 0, 0);
  return { data: cb.toDataURL("image/jpeg", 0.93), moved: true };
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
  const img = await loadImg(src), c = canvasFor(img), cx = c.getContext("2d", { willReadFrequently: true });
  cx.drawImage(img, 0, 0, c.width, c.height);
  const W = c.width, H = c.height, alpha = await matte(src, c), subj = subjectLayer(c, alpha);
  const back = newCanvas(W, H), bx = back.getContext("2d", { willReadFrequently: true });
  if (bg === "blur") bx.drawImage(cleanBackground(c, alpha, Math.max(W, H) / 40), 0, 0);
  else if (typeof bg === "function") bg(bx, W, H, img);
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
function withFilterCanvas(srcEl, filterId, w = srcEl.width, h = srcEl.height) {
  const flt = FILTERS.find((f) => f.id === filterId) || FILTERS[0];
  const c = newCanvas(w, h), ctx = c.getContext("2d");
  drawWith(ctx, flt.f, (y) => y.drawImage(srcEl, 0, 0, w, h));
  if (flt.wash) { ctx.globalCompositeOperation = "soft-light"; ctx.fillStyle = flt.wash; ctx.fillRect(0, 0, w, h); }
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
async function applyLook(src, look) {
  const img = await loadImg(src), c = canvasFor(img);
  c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
  const out = beautyTiled(c, look, Math.max(1, Math.max(c.width, c.height) / 2048));
  if (!out) throw new Error("This phone can't run My Look.");
  const res = newCanvas(c.width, c.height), ctx = res.getContext("2d");
  ctx.drawImage(withFilterCanvas(out, look.filter), 0, 0);
  if (isPng(src)) { ctx.globalCompositeOperation = "destination-in"; ctx.drawImage(c, 0, 0); }
  return encode(res, src);
}

// Photo filters and the Edit adjustments, applied to a committed photo.
const isPng = (src) => /^data:image\/png/.test(src);
const encode = (c, src) => (isPng(src) ? c.toDataURL("image/png") : c.toDataURL("image/jpeg", 0.92));
// amt (0 to 1) blends the filtered picture over the original; 1 is the full filter.
async function applyFilter(src, flt, amt = 1) {
  const img = await loadImg(src), c = canvasFor(img), ctx = c.getContext("2d");
  drawWith(ctx, flt.f, (y) => y.drawImage(img, 0, 0, c.width, c.height));
  if (flt.wash) { ctx.globalCompositeOperation = "soft-light"; ctx.fillStyle = flt.wash; ctx.fillRect(0, 0, c.width, c.height); ctx.globalCompositeOperation = "source-over"; }
  if (amt >= 1) return encode(c, src);
  const out = newCanvas(c.width, c.height), o = out.getContext("2d");
  o.drawImage(img, 0, 0, c.width, c.height); o.globalAlpha = Math.max(0, amt); o.drawImage(c, 0, 0);
  return encode(out, src);
}
// v runs from -50 to 50, with 0 meaning no change.
async function adjust(src, kind, v) {
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
  return encode(c, src);
}
// Rotates by quarter turns, then cuts out `r`, given as fractions of the rotated picture, so
// the same crop fits the working copy and the full-size original. A fixed shape (`aspect`,
// width / height) is kept exact in whole pixels.
async function cropRect(src, turns, r, aspect) {
  const img = await loadImg(src), W = img.naturalWidth, H = img.naturalHeight, q = ((turns % 4) + 4) % 4;
  const RW = q % 2 ? H : W, RH = q % 2 ? W : H, x = r.x * RW, y = r.y * RH, w = r.w * RW, h = r.h * RH;
  const cw = Math.max(1, Math.round(w)), ch = Math.max(1, Math.min(Math.ceil(h), Math.round(aspect > 0 ? cw / aspect : h)));
  const c = newCanvas(cw, ch), ctx = c.getContext("2d");
  ctx.imageSmoothingQuality = "high";
  ctx.scale(cw / w, ch / h); ctx.translate(-x, -y);
  ctx.translate(RW / 2, RH / 2); ctx.rotate((q * Math.PI) / 2); ctx.drawImage(img, -W / 2, -H / 2);
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
