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
async function cutout(src) {
  if (cutoutCache[src]) return cutoutCache[src];
  const [seg, img] = await Promise.all([segmenter(), loadImg(src)]);
  const c = canvasFor(img), ctx = c.getContext("2d");
  ctx.drawImage(img, 0, 0, c.width, c.height);
  const result = seg.segment(detectCopy(c));
  const m = result.confidenceMasks[0], conf = m.getAsFloat32Array();
  // Turn the subject confidence into a soft alpha mask.
  const mc = document.createElement("canvas"); mc.width = m.width; mc.height = m.height;
  const mctx = mc.getContext("2d"), px = mctx.createImageData(m.width, m.height);
  for (let i = 0; i < conf.length; i++) px.data[i * 4 + 3] = Math.max(0, Math.min(255, ((conf[i] - 0.35) / 0.3) * 255));
  mctx.putImageData(px, 0, 0);
  if (result.close) result.close();
  ctx.globalCompositeOperation = "destination-in";
  ctx.filter = `blur(${Math.max(1, Math.round(c.width / 600))}px)`;
  ctx.drawImage(mc, 0, 0, c.width, c.height);
  return (cutoutCache[src] = c.toDataURL("image/png"));
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
const SHADES = {
  flips: ["#c2185b", "#e0565b", "#b5485d", "#d4787d", "#8e2443"],
  fblush: ["#ff7f98", "#ff9a8b", "#e86a8a", "#f4a28c"],
  fbrows: ["#3b2a20", "#5a4030", "#7a6a5c", "#1c1a1a"],
  fshadow: ["#b07a6a", "#8c5a8f", "#c98b4a", "#5a6d8a", "#d49a9a"],
  fliner: ["#111111", "#3b2a20", "#1f2d55"],
  hcolor: ["#8d3b1f", "#b5562a", "#c9a063", "#6b5a4e", "#1b1714", "#d97a9b", "#9b84c9"],
};
const FACE_DEFAULTS = { fauto: 50, fsmooth: 50, fblemish: 60, fundereye: 50, fteeth: 50, feyes: 40, fbigeyes: 35, fslim: 35, fnose: 35, flips: 45, fblush: 40,
  fbrows: 45, fshadow: 45, fliner: 50, fglam: 50, bwaist: 45, bhips: 40, barms: 40, bslimlegs: 40, blegs: 40, hcolor: 60 };
let faceSet = { amt: { ...FACE_DEFAULTS }, shade: Object.fromEntries(Object.entries(SHADES).map(([k, v]) => [k, v[0]])) };
try { const s = JSON.parse(store.get("glowFace") || "{}"); Object.assign(faceSet.amt, s.amt); Object.assign(faceSet.shade, s.shade); } catch {}

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const mean = (pts) => [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const smoothstep = (a, b, v) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };
function newCanvas(w, h) { const c = document.createElement("canvas"); c.width = w; c.height = h; return c; }
function tracePoly(ctx, pts) { ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); }
// A soft-edged white-on-transparent mask.
function softMask(w, h, feather, draw) {
  const m = newCanvas(w, h), ctx = m.getContext("2d");
  ctx.filter = `blur(${Math.max(1, Math.round(feather))}px)`; ctx.fillStyle = "#fff";
  draw(ctx); return m;
}
// Paints `layer` onto ctx only where the mask is white.
function blendMasked(ctx, layer, mask, alpha) {
  const t = newCanvas(layer.width, layer.height), tc = t.getContext("2d");
  tc.drawImage(layer, 0, 0); tc.globalCompositeOperation = "destination-in"; tc.drawImage(mask, 0, 0);
  ctx.save(); ctx.globalAlpha = clamp01(alpha); ctx.drawImage(t, 0, 0); ctx.restore();
}
function filtered(src, f) { const c = newCanvas(src.width, src.height), x = c.getContext("2d"); x.filter = f; x.drawImage(src, 0, 0); return c; }
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

// Per-pixel pass inside a mask: fn(r, g, b, maskAlpha, i) edits rgb in place.
function pixelPass(ctx, mask, bx, fn) {
  const img = ctx.getImageData(bx.x0, bx.y0, bx.w, bx.h), m = mask.getContext("2d").getImageData(bx.x0, bx.y0, bx.w, bx.h).data, d = img.data;
  for (let i = 0; i < d.length; i += 4) { const a = m[i + 3] / 255; if (a > 0.01) fn(d, i, a); }
  ctx.putImageData(img, bx.x0, bx.y0);
}

function faceOps(ctx, P, amt, toolId) {
  const W = ctx.canvas.width, H = ctx.canvas.height;
  const pts = (idx) => idx.map((i) => P[i]);
  const faceW = dist(P[234], P[454]), faceC = mean(pts(FACE.oval));
  const eyes = [FACE.eyeL, FACE.eyeR].map((e) => ({ poly: pts(e), w: dist(P[e[0]], P[e[8]]), c: mean(pts(e)) }));
  const iris = P.length > 473 ? [P[468], P[473]] : eyes.map((e) => e.c);
  const faceBox = box(ctx.canvas, faceC[0], faceC[1], faceW * 0.9);
  const skinMask = () => softMask(W, H, faceW / 40, (m) => {
    tracePoly(m, pts(FACE.oval)); m.fill();
    m.globalCompositeOperation = "destination-out";
    for (const e of eyes) { m.beginPath(); m.ellipse(e.c[0], e.c[1], e.w * 0.75, e.w * 0.45, 0, 0, 7); m.fill(); }
    for (const br of [FACE.browL, FACE.browR]) { m.lineWidth = faceW / 22; tracePoly(m, pts(br)); m.fill(); m.strokeStyle = "#fff"; m.stroke(); }
    tracePoly(m, pts(FACE.lipsOut)); m.fill();
    m.beginPath(); m.ellipse(P[2][0], P[2][1] - faceW * 0.02, faceW * 0.09, faceW * 0.05, 0, 0, 7); m.fill(); // nostrils
  });

  const ops = {
    fsmooth(a) {
      const layer = glSmooth(ctx.canvas, Math.max(1, faceW / 260));
      blendMasked(ctx, layer, skinMask(), a);
    },
    fblemish(a) {
      // Spots are small patches darker than the skin around them: fill them from a blurred copy.
      const blur = filtered(ctx.canvas, `blur(${Math.max(2, Math.round(faceW / 70))}px)`), bd = blur.getContext("2d").getImageData(faceBox.x0, faceBox.y0, faceBox.w, faceBox.h).data;
      pixelPass(ctx, skinMask(), faceBox, (d, i, m) => {
        const l = (d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11) / 255, lb = (bd[i] * 0.3 + bd[i + 1] * 0.59 + bd[i + 2] * 0.11) / 255;
        const w = m * smoothstep(0.015, 0.07, lb - l) * Math.min(1, a * 1.4);
        for (let ch = 0; ch < 3; ch++) d[i + ch] += (bd[i + ch] - d[i + ch]) * w;
      });
      ops.fsmooth(a * 0.4);
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
        const yellow = Math.max(0, (r + g) / 2 - b), lift = 1 + 0.18 * w;
        d[i] = Math.min(255, (r - yellow * 0.25 * w) * lift * 255);
        d[i + 1] = Math.min(255, (g - yellow * 0.15 * w) * lift * 255);
        d[i + 2] = Math.min(255, (b + yellow * 0.7 * w) * lift * 255);
      });
    },
    feyes(a) {
      const mask = softMask(W, H, faceW / 160, (m) => { for (const e of eyes) { tracePoly(m, e.poly); m.fill(); } });
      blendMasked(ctx, filtered(ctx.canvas, "brightness(1.18) contrast(1.15) saturate(1.15)"), mask, a);
    },
    fbigeyes(a) { eyes.forEach((e, n) => bulge(ctx, iris[n], e.w * 1.1, a * 0.28)); },
    fslim(a) {
      for (const i of FACE.jaw) push(ctx, P[i], faceW * 0.2, [(faceC[0] - P[i][0]) * 0.07 * a, (faceC[1] - P[i][1]) * 0.02 * a]);
    },
    fnose(a) {
      for (const i of [129, 358, 49, 279]) push(ctx, P[i], faceW * 0.09, [(P[1][0] - P[i][0]) * 0.35 * a, 0]);
    },
    flips(a) {
      const mask = softMask(W, H, faceW / 250, (m) => {
        tracePoly(m, pts(FACE.lipsOut)); m.fill(); m.globalCompositeOperation = "destination-out"; tracePoly(m, pts(FACE.lipsIn)); m.fill();
      });
      const tint = newCanvas(W, H), t = tint.getContext("2d");
      t.drawImage(ctx.canvas, 0, 0); t.globalCompositeOperation = "color"; t.fillStyle = faceSet.shade.flips; t.fillRect(0, 0, W, H);
      blendMasked(ctx, tint, mask, 0.15 + a * 0.45);
    },
    fblush(a) {
      for (const i of [50, 280]) {
        const c = [(P[i][0] * 2 + faceC[0]) / 3, P[i][1] - faceW * 0.02], r = faceW * 0.17;
        const g = ctx.createRadialGradient(c[0], c[1], 0, c[0], c[1], r);
        g.addColorStop(0, faceSet.shade.fblush); g.addColorStop(1, faceSet.shade.fblush + "00");
        ctx.save(); ctx.globalCompositeOperation = "soft-light"; ctx.globalAlpha = 0.15 + a * 0.4; ctx.fillStyle = g;
        ctx.fillRect(c[0] - r, c[1] - r, r * 2, r * 2); ctx.restore();
      }
    },
    fbrows(a) {
      const mask = softMask(W, H, faceW / 110, (m) => { for (const br of [FACE.browL, FACE.browR]) { tracePoly(m, pts(br)); m.fill(); } });
      const tint = newCanvas(W, H), t = tint.getContext("2d");
      t.drawImage(ctx.canvas, 0, 0); t.globalCompositeOperation = "multiply"; t.fillStyle = faceSet.shade.fbrows; t.fillRect(0, 0, W, H);
      blendMasked(ctx, tint, mask, 0.1 + a * 0.35);
    },
    fshadow(a) {
      // Color the lid from the lash line up toward the brow, strongest in the middle.
      const mask = softMask(W, H, faceW / 45, (m) => {
        for (const up of [UPPER_L, UPPER_R]) {
          const lid = pts(up), ew = dist(lid[0], lid[lid.length - 1]);
          const top = lid.map(([x, y], i) => [x, y - ew * (0.12 + 0.3 * Math.sin((Math.PI * i) / (lid.length - 1)))]);
          tracePoly(m, [...lid, ...top.reverse()]); m.fill();
        }
      });
      const tint = newCanvas(W, H), t = tint.getContext("2d");
      t.drawImage(ctx.canvas, 0, 0); t.globalCompositeOperation = "multiply"; t.fillStyle = faceSet.shade.fshadow; t.fillRect(0, 0, W, H);
      blendMasked(ctx, tint, mask, 0.2 + a * 0.55);
    },
    fliner(a) {
      ctx.save(); ctx.strokeStyle = faceSet.shade.fliner; ctx.lineCap = ctx.lineJoin = "round";
      for (const up of [UPPER_L, UPPER_R]) {
        const lid = pts(up), outer = lid[lid.length - 1], ew = dist(lid[0], outer);
        const side = Math.sign(outer[0] - faceC[0]) || 1;
        ctx.lineWidth = ew * (0.03 + 0.05 * a); ctx.filter = `blur(${Math.max(0.5, ew / 120)}px)`; ctx.globalAlpha = 0.85;
        ctx.beginPath(); lid.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.lineTo(outer[0] + side * ew * 0.22 * a, outer[1] - ew * 0.12 * a); // wing
        ctx.stroke();
      }
      ctx.restore();
    },
    fglam(a) { ops.fblemish(a * 0.7); ops.fbrows(a * 0.8); ops.fshadow(a * 0.8); ops.fliner(a * 0.8); ops.flips(a); ops.fblush(a * 0.7); },
    fauto(a) { ops.fblemish(a * 0.9); ops.fundereye(a * 0.8); ops.feyes(a * 0.6); ops.fteeth(a * 0.7); },
  };
  ops[toolId](amt);
}

async function faceEdit(src, toolId, amt) {
  const [finder, img] = await Promise.all([faceFinder(), loadImg(src)]);
  const c = canvasFor(img), ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, c.width, c.height);
  const faces = finder.detect(detectCopy(c)).faceLandmarks || [];
  if (!faces.length) throw new Error("Couldn't find a face. Try a clear, front-facing photo.");
  for (const f of faces) faceOps(ctx, f.map((p) => [p.x * c.width, p.y * c.height]), amt, toolId);
  return /^data:image\/png/.test(src) ? c.toDataURL("image/png") : c.toDataURL("image/jpeg", 0.92);
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
  const W = src.width, H = src.height, T = 2048, m = Math.ceil(6 * spread) + 2;
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
      g.gl.viewport(0, 0, w, h);
      g.gl.texImage2D(g.gl.TEXTURE_2D, 0, g.gl.RGB, g.gl.RGB, g.gl.UNSIGNED_BYTE, piece);
      drawBeauty(g, w / spread, h / spread, false, b);
      const cw = Math.min(T, W - x), ch = Math.min(T, H - y);
      octx.drawImage(tile, x - x0, y - y0, cw, ch, x, y, cw, ch);
    }
  } finally { const lose = g.gl.getExtension("WEBGL_lose_context"); if (lose) lose.loseContext(); }
  // The shader works in RGB; put back any transparency the photo had.
  octx.globalCompositeOperation = "destination-in"; octx.drawImage(src, 0, 0);
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
  mk.filter = `blur(${Math.max(1, Math.round(c.width / 500))}px)`; mk.drawImage(mc, 0, 0, c.width, c.height);
  // Lift dark hair a little so the new color shows, then take the color's hue and saturation.
  const tint = filtered(c, "brightness(1.35) contrast(0.95)"), t = tint.getContext("2d");
  t.globalCompositeOperation = "color"; t.fillStyle = color; t.fillRect(0, 0, c.width, c.height);
  blendMasked(ctx, tint, mask, 0.3 + amt * 0.6);
  return /^data:image\/png/.test(src) ? c.toDataURL("image/png") : c.toDataURL("image/jpeg", 0.92);
}

async function composite(src, cut, paint) {
  const [base, fg] = await Promise.all([loadImg(src), loadImg(cut)]);
  const c = canvasFor(base), ctx = c.getContext("2d");
  paint(ctx, c.width, c.height, base);
  ctx.drawImage(fg, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.92);
}

// Draws a canvas or image with one of the photo filters baked in.
function withFilterCanvas(srcEl, filterId, w = srcEl.width, h = srcEl.height) {
  const flt = FILTERS.find((f) => f.id === filterId) || FILTERS[0];
  const c = newCanvas(w, h), ctx = c.getContext("2d");
  ctx.filter = flt.f; ctx.drawImage(srcEl, 0, 0, w, h); ctx.filter = "none";
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
async function applyFilter(src, flt) {
  const img = await loadImg(src), c = canvasFor(img), ctx = c.getContext("2d");
  ctx.filter = flt.f; ctx.drawImage(img, 0, 0, c.width, c.height); ctx.filter = "none";
  if (flt.wash) { ctx.globalCompositeOperation = "soft-light"; ctx.fillStyle = flt.wash; ctx.fillRect(0, 0, c.width, c.height); }
  return encode(c, src);
}
// v runs from -50 to 50, with 0 meaning no change.
async function adjust(src, kind, v) {
  const img = await loadImg(src), c = canvasFor(img), ctx = c.getContext("2d", { willReadFrequently: kind === "detail" });
  const t = v / 50;
  if (kind === "light") ctx.filter = `brightness(${1 + t * 0.35}) contrast(${1 + t * 0.08})`;
  if (kind === "color") ctx.filter = `saturate(${1 + t * 0.6})`;
  ctx.drawImage(img, 0, 0, c.width, c.height); ctx.filter = "none";
  if (kind === "warmth" && t) {
    ctx.globalCompositeOperation = "soft-light"; ctx.globalAlpha = Math.abs(t) * 0.35;
    ctx.fillStyle = t > 0 ? "#ff9a3c" : "#3c8cff"; ctx.fillRect(0, 0, c.width, c.height);
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
