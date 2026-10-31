// Live beauty camera: MediaPipe follows the face in every camera frame, on the phone, and one
// WebGL pass draws the look on it: face reshape, skin smoothing on the face only, lips, blush
// and brows, then brightness and warmth. Free and private, like the still-photo face tools.
// Everything works in the camera's own (unmirrored) pixels; the front camera is only mirrored
// when the frame is drawn, so the saved photo matches the preview.

// Face points used here (MediaPipe's 478-point face mesh).
const LIVE_PTS = { brow: 10, cheekL: 234, cheekR: 454, chin: 152, noseTip: 4, noseBase: 2, alarL: 129, alarR: 358,
  jawL: 172, jawR: 397, lowJawL: 136, lowJawR: 365, appleL: 50, appleR: 280 };
// The camera's face settings and the shades offered for each (from the editor's makeup shades).
const LIVE_KEYS = ["eyes", "slim", "nose", "lips", "blush", "brows"];
const LIVE_SHADES = {
  lips: ["#d4787d", "#b5485d", "#c0392b", "#c48a7a", "#8e2443"],
  blush: ["#f4a28c", "#ff7f98", "#e86a8a", "#d9826b"],
  brows: ["#5a4030", "#3b2a20", "#7a6a5c", "#1c1a1a"],
};
const LIVE_DEFAULTS = { eyes: 0, slim: 0, nose: 0, lips: 0, blush: 0, brows: 0,
  lipShade: LIVE_SHADES.lips[0], blushShade: LIVE_SHADES.blush[0], browShade: LIVE_SHADES.brows[0] };

const LIVE_FRAG = `
  #ifdef GL_FRAGMENT_PRECISION_HIGH
  precision highp float;
  #else
  precision mediump float;
  #endif
  varying vec2 uv;
  uniform sampler2D tex, mA, mB;      // camera frame; masks: A = skin, blush (coarse); B = brows, lips (fine)
  uniform vec2 size, mpxA, mpxB;      // frame size in pixels; one pixel of each mask in 0-1 units
  uniform float smooth_, bright, warm, faceOn, plain;
  uniform vec4 eyeL, eyeR;            // centre x, y, radius, strength (pixels)
  uniform vec4 slim[4];               // centre x, y and move x, y (pixels)
  uniform vec4 nose[2];
  uniform vec2 slimR;                 // radius for slim, radius for nose
  uniform vec4 lips, blush, brows;    // shade rgb, strength

  // Pushes the picture near c along m, fading smoothly to nothing at radius r. The moves stay
  // well under r / 1.5, so neighbouring pixels never cross (no seams, no folds).
  vec2 shift(vec2 p, vec4 cm, float r) {
    vec2 d = p - cm.xy; float t = dot(d, d) / (r * r);
    if (t >= 1.0) return p;
    float f = 1.0 - t;
    return p - f * f * cm.zw;
  }
  // Magnifies the picture around an eye, fading to nothing at the edge.
  vec2 zoom(vec2 p, vec4 e) {
    vec2 d = p - e.xy; float t = length(d) / e.z;
    if (t >= 1.0 || e.w <= 0.0) return p;
    float f = 1.0 - t * t;
    return e.xy + d * (1.0 - e.w * f * f);
  }
  // A mask read with a small blur, so its edges are soft.
  vec4 soft(sampler2D m, vec2 q, vec2 mpx) {
    vec4 s = vec4(0.0);
    for (int x = -1; x <= 1; x++) for (int y = -1; y <= 1; y++) s += texture2D(m, q + vec2(float(x), float(y)) * mpx * 1.3);
    return s / 9.0;
  }
  float lum(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
  vec3 softLight(vec3 a, vec3 b) {
    return mix(2.0 * a * b + a * a * (1.0 - 2.0 * b), sqrt(a) * (2.0 * b - 1.0) + 2.0 * a * (1.0 - b), step(0.5, b));
  }

  void main() {
    if (plain > 0.5) { gl_FragColor = vec4(texture2D(tex, uv).rgb, 1.0); return; }
    vec2 p = uv * size;
    if (faceOn > 0.5) {
      for (int i = 0; i < 4; i++) p = shift(p, slim[i], slimR.x);
      for (int i = 0; i < 2; i++) p = shift(p, nose[i], slimR.y);
      p = zoom(zoom(p, eyeL), eyeR);
    }
    vec2 q = p / size, px = 1.0 / size;
    // Edge-preserving smoothing (the same filter as the still-photo beauty shader).
    vec3 c = texture2D(tex, q).rgb, sum = c; float wsum = 1.0;
    for (int x = -3; x <= 3; x++) for (int y = -3; y <= 3; y++) {
      if (x == 0 && y == 0) continue;
      vec3 s = texture2D(tex, q + vec2(float(x), float(y)) * px * 2.0).rgb;
      float d = distance(s, c);
      float w = exp(-d * d * 60.0) * exp(-float(x * x + y * y) / 18.0);
      sum += s * w; wsum += w;
    }
    vec4 a = faceOn > 0.5 ? soft(mA, q, mpxA) : vec4(1.0, 0.0, 0.0, 0.0);
    vec3 col = mix(c, sum / wsum, smooth_ * a.r);
    if (faceOn > 0.5) {
      // Brows: the shade multiplied in, so the hairs keep their texture.
      vec4 b = soft(mB, q, mpxB);
      float bm = b.r * brows.a;
      col = mix(col, mix(col * brows.rgb * 1.25, brows.rgb, 0.25), bm);
      // Blush: a soft-light wash with a touch of multiply.
      float cm = a.b * blush.a;
      col = mix(col, softLight(col, blush.rgb), cm);
      col = mix(col, col * blush.rgb, cm * 0.25);
      // Lips: the shade at a brightness between the lip's own and the shade's, so lines and light stay.
      float lm = b.g * lips.a;
      vec3 tint = lips.rgb * ((lum(col) * 0.45 + lum(lips.rgb) * 0.55) / max(lum(lips.rgb), 0.05));
      col = mix(col, clamp(tint, 0.0, 1.0), lm);
    }
    col = pow(max(col, 0.0), vec3(1.0 - bright * 0.35));
    col += vec3(0.06, 0.025, -0.03) * warm;
    gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
  }`;

// Sets up the live shader on the camera canvas. Returns null if this phone can't run it, and the
// camera then falls back to the plain beauty shader.
function initLive(canvas) {
  const gl = canvas.getContext("webgl", { preserveDrawingBuffer: true });
  if (!gl) return null;
  const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : null; };
  const vs = sh(gl.VERTEX_SHADER, VERT), fs = sh(gl.FRAGMENT_SHADER, LIVE_FRAG);
  if (!vs || !fs) return null;
  const prog = gl.createProgram();
  gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;
  gl.useProgram(prog);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, "p");
  gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const texture = (unit) => {
    gl.activeTexture(gl.TEXTURE0 + unit);
    const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]])
      gl.texParameteri(gl.TEXTURE_2D, k, v);
    return t;
  };
  const u = (n) => gl.getUniformLocation(prog, n);
  const g = { live: true, gl, tex: texture(0), texA: texture(1), texB: texture(2), u: {} };
  for (const n of ["size", "mpxA", "mpxB", "smooth_", "bright", "warm", "faceOn", "plain", "eyeL", "eyeR", "slim", "nose", "slimR", "lips", "blush", "brows", "mirror"]) g.u[n] = u(n);
  gl.uniform1i(u("tex"), 0); gl.uniform1i(u("mA"), 1); gl.uniform1i(u("mB"), 2);
  gl.activeTexture(gl.TEXTURE0);
  return g;
}

// ---------- Face tracking ----------
// The face model runs in a worker (faceworker.js), so finding the face never holds up the
// preview, the buttons or the shutter, however slow the phone. The preview always draws with
// the newest points it has; one small copy of the frame is in the worker at a time.
const liveFace = { worker: null, ready: false, failed: false, busy: false, pts: null, seen: 0, cost: 0, sent: 0, size: null };
const FACE_SIDE = 320;   // the model looks at a 256px face crop, so a small frame loses nothing
function liveFinder() {
  if (liveFace.worker || liveFace.failed) return;
  try {
    const base = native ? new URL("vendor/mediapipe", location.href).href : MP_CDN;
    const model = native ? new URL("vendor/face_landmarker.task", location.href).href : FACE_MODEL;
    const w = (liveFace.worker = new Worker("faceworker.js"));
    w.onmessage = (e) => onFaceMessage(e.data);
    w.onerror = () => onFaceMessage({ type: "failed" });
    w.postMessage({ type: "init", base, model });
  } catch { liveFace.failed = true; }
}
function onFaceMessage(m) {
  if (m.type === "ready") { liveFace.ready = true; liveFace.failed = false; }
  else if (m.type === "failed") { liveFace.error = m.error || "worker error"; liveFace.ready = false; liveFace.failed = true; liveFace.busy = false; resetFace(); }
  else if (m.type === "result") { liveFace.busy = false; liveFace.cost = liveFace.cost * 0.8 + m.cost * 0.2; takeFace(m.pts); }
  if (typeof renderAdjNote === "function") renderAdjNote();
}
// Sends the worker a small copy of the current frame when it is free. Frames with no face in
// view are checked about 5 times a second, to save battery.
const faceCopy = newCanvas(1, 1);
function trackFace(video) {
  if (!liveFace.ready || liveFace.busy || video.readyState < 2 || !video.videoWidth) return;
  const now = performance.now();
  if (now - liveFace.sent < (liveFace.seen ? 30 : 200)) return;
  const W = video.videoWidth, H = video.videoHeight, s = Math.min(1, FACE_SIDE / Math.max(W, H));
  const w = Math.round(W * s), h = Math.round(H * s);
  if (faceCopy.width !== w || faceCopy.height !== h) { faceCopy.width = w; faceCopy.height = h; }
  faceCopy.getContext("2d").drawImage(video, 0, 0, w, h);
  liveFace.busy = true; liveFace.sent = now; liveFace.size = [W, H];
  createImageBitmap(faceCopy).then((image) => {
    if (!liveFace.worker) { image.close(); return; }
    liveFace.worker.postMessage({ type: "frame", image, t: now }, [image]);
  }).catch(() => { liveFace.busy = false; });
}
// Eases the points toward the new ones, so makeup doesn't shimmer when the face is still but
// keeps up when it moves.
function takeFace(norm) {
  // The model now and then returns NaN points; drawing with them threw and stopped the preview.
  if (norm && !norm.every(Number.isFinite)) norm = null;
  if (!norm || !liveFace.size) { liveFace.seen = Math.max(0, liveFace.seen - 0.34); if (!liveFace.seen) liveFace.pts = null; return; }
  const [W, H] = liveFace.size, raw = [];
  for (let i = 0; i < norm.length; i += 2) raw.push([norm[i] * W, norm[i + 1] * H]);
  const old = liveFace.pts;
  if (!old || !liveFace.seen || old.length !== raw.length) liveFace.pts = raw;
  else {
    const faceW = Math.max(1, dist(raw[LIVE_PTS.cheekL], raw[LIVE_PTS.cheekR]));
    const move = [1, 33, 263, 61, 291, 152].reduce((s, i) => s + dist(raw[i], old[i]), 0) / 6 / faceW;
    const k = Math.min(1, 0.4 + move * 12);
    liveFace.pts = old.map((o, i) => [o[0] + (raw[i][0] - o[0]) * k, o[1] + (raw[i][1] - o[1]) * k]);
  }
  liveFace.seen = Math.min(1, liveFace.seen + 0.5);
}
function resetFace() { liveFace.pts = null; liveFace.seen = 0; liveFace.size = null; }   // a late answer is then ignored

// ---------- Masks ----------
// Two small canvases in the camera's pixels. A is coarse, so its edges blend over a wide band:
// skin (red) and blush (blue). B is finer for the brows (red) and lips (green).
const liveMasks = { a: newCanvas(1, 1), b: newCanvas(1, 1) };
function drawMasks(W, H, P) {
  const size = (c, max) => {
    const s = Math.min(1, max / Math.max(W, H)), w = Math.round(W * s), h = Math.round(H * s);
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    const x = c.getContext("2d"); x.globalCompositeOperation = "source-over"; x.fillStyle = "#000"; x.fillRect(0, 0, w, h);
    return s;
  };
  let s = size(liveMasks.a, 96);
  const pts = (idx) => idx.map((i) => [P[i][0] * s, P[i][1] * s]);
  const faceW = dist(P[LIVE_PTS.cheekL], P[LIVE_PTS.cheekR]) * s;
  const faceC = mean(pts(FACE.oval));
  const a = liveMasks.a.getContext("2d");
  // Skin: the face without eyes, brows, lips and nostrils.
  a.fillStyle = "#f00"; tracePoly(a, pts(FACE.oval)); a.fill();
  a.fillStyle = "#000"; a.strokeStyle = "#000"; a.lineJoin = "round";
  for (const e of [FACE.eyeL, FACE.eyeR]) {
    const p = pts(e), c = mean(p), ew = dist(p[0], p[8]);
    a.beginPath(); a.ellipse(c[0], c[1], ew * 0.75, ew * 0.45, Math.atan2(p[8][1] - p[0][1], p[8][0] - p[0][0]), 0, 7); a.fill();
  }
  a.lineWidth = faceW / 22;
  for (const br of [FACE.browL, FACE.browR]) { tracePoly(a, pts(br)); a.fill(); a.stroke(); }
  tracePoly(a, pts(FACE.lipsOut)); a.fill();
  const nb = [P[LIVE_PTS.noseBase][0] * s, P[LIVE_PTS.noseBase][1] * s];
  a.beginPath(); a.ellipse(nb[0], nb[1] - faceW * 0.02, faceW * 0.09, faceW * 0.05, 0, 0, 7); a.fill();
  // Blush: a soft round wash on the apple of each cheek.
  a.globalCompositeOperation = "lighter";
  for (const i of [LIVE_PTS.appleL, LIVE_PTS.appleR]) {
    const c = [(P[i][0] * s * 2 + faceC[0]) / 3, P[i][1] * s - faceW * 0.02], r = faceW * 0.2;
    const gr = a.createRadialGradient(c[0], c[1], 0, c[0], c[1], r);
    gr.addColorStop(0, "rgba(0,0,255,0.9)"); gr.addColorStop(0.5, "rgba(0,0,255,0.5)"); gr.addColorStop(1, "rgba(0,0,255,0)");
    a.fillStyle = gr; a.fillRect(c[0] - r, c[1] - r, r * 2, r * 2);
  }
  s = size(liveMasks.b, 320);
  const b = liveMasks.b.getContext("2d");
  b.fillStyle = "#f00"; for (const br of [FACE.browL, FACE.browR]) { tracePoly(b, pts(br)); b.fill(); }
  // Lips: the outer lip line minus the open mouth.
  b.globalCompositeOperation = "lighter"; b.fillStyle = "#0f0"; tracePoly(b, pts(FACE.lipsOut)); b.fill();
  b.globalCompositeOperation = "source-over"; b.fillStyle = "#000"; tracePoly(b, pts(FACE.lipsIn)); b.fill();
}

// ---------- Drawing ----------
const rgb01 = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
// Draws one camera frame with look `b`. `plain` shows the untouched frame (hold to compare).
// w and h are the camera's size: the look is worked out in camera pixels, whatever size the
// canvas is, so a small preview and the full-size photo look the same.
function drawLive(g, video, w, h, mirror, b, plain) {
  const { gl, u } = g;
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, g.tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, video);
  const P = liveFace.pts, on = !!(P && liveFace.seen > 0 && liveFace.ready);
  // Until the face model is ready (or if it can't load), smoothing covers the whole frame as before.
  const face = on || (liveFace.ready && !liveFace.failed);
  gl.uniform2f(u.size, w, h);
  gl.uniform1f(u.mirror, mirror ? 1 : 0);
  gl.uniform1f(u.plain, plain ? 1 : 0);
  gl.uniform1f(u.smooth_, b.smooth / 100);
  gl.uniform1f(u.bright, b.bright / 100);
  gl.uniform1f(u.warm, b.warm / 100);
  gl.uniform1f(u.faceOn, face ? 1 : 0);
  if (face) {
    if (on) drawMasks(w, h, P);
    else for (const c of [liveMasks.a, liveMasks.b]) { c.width = c.height = 1; }   // no face in view: nothing to touch
    gl.uniform2f(u.mpxA, 1 / liveMasks.a.width, 1 / liveMasks.a.height);
    gl.uniform2f(u.mpxB, 1 / liveMasks.b.width, 1 / liveMasks.b.height);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, g.texA);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, liveMasks.a);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, g.texB);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, liveMasks.b);
    gl.activeTexture(gl.TEXTURE0);
    const k = on ? liveFace.seen : 0, amt = (key) => ((b[key] || 0) / 100) * k;
    const shade = (key, hex, base, span) => { const v = amt(key); gl.uniform4f(u[key], ...rgb01(hex || LIVE_DEFAULTS[key + "Shade"]), v > 0 ? base + span * v : 0); };
    shade("lips", b.lipShade, 0.15, 0.45);
    shade("blush", b.blushShade, 0.1, 0.35);
    shade("brows", b.browShade, 0.1, 0.4);
    gl.uniform4fv(u.slim, new Float32Array(16)); gl.uniform4fv(u.nose, new Float32Array(8));
    gl.uniform4f(u.eyeL, 0, 0, 1, 0); gl.uniform4f(u.eyeR, 0, 0, 1, 0);
    if (on) setShape(g, P, amt);
  }
  gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}
// The reshape controls, kept as gentle as the still-photo tools.
function setShape(g, P, amt) {
  const { gl, u } = g;
  const faceW = dist(P[LIVE_PTS.cheekL], P[LIVE_PTS.cheekR]);
  const eyes = amt("eyes"), slim = amt("slim"), nose = amt("nose");
  for (const [key, e] of [["eyeL", FACE.eyeL], ["eyeR", FACE.eyeR]]) {
    const c = mean(e.map((i) => P[i])), ew = dist(P[e[0]], P[e[8]]);
    gl.uniform4f(u[key], c[0], c[1], ew * 1.25, eyes * 0.2);
  }
  // Slim: the lower cheeks and jaw move straight in toward the line down the middle of the face.
  const top = P[LIVE_PTS.brow], chin = P[LIVE_PTS.chin], al = dist(top, chin) || 1, ax = [(chin[0] - top[0]) / al, (chin[1] - top[1]) / al], sv = [];
  for (const i of [LIVE_PTS.jawL, LIVE_PTS.jawR, LIVE_PTS.lowJawL, LIVE_PTS.lowJawR]) {
    const t = (P[i][0] - top[0]) * ax[0] + (P[i][1] - top[1]) * ax[1];
    const d = [top[0] + ax[0] * t - P[i][0], top[1] + ax[1] * t - P[i][1]], l = Math.hypot(...d) || 1, m = faceW * 0.05 * slim;
    sv.push(P[i][0], P[i][1], (d[0] / l) * m, (d[1] / l) * m);
  }
  gl.uniform4fv(u.slim, new Float32Array(sv));
  // Nose: the sides of the nose move in toward its tip.
  const tip = P[LIVE_PTS.noseTip], noseW = dist(P[LIVE_PTS.alarL], P[LIVE_PTS.alarR]), nv = [];
  for (const i of [LIVE_PTS.alarL, LIVE_PTS.alarR]) {
    const d = [tip[0] - P[i][0], tip[1] - P[i][1]], l = Math.hypot(...d) || 1, m = noseW * 0.12 * nose;
    nv.push(P[i][0], P[i][1], (d[0] / l) * m, (d[1] / l) * m);
  }
  gl.uniform4fv(u.nose, new Float32Array(nv));
  gl.uniform2f(u.slimR, faceW * 0.36, noseW * 0.8);
}
