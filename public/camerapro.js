// Pro camera controls, like a Galaxy S26 or iPhone 18 Pro Max camera (2026-11-01):
// lens buttons over the shutter (0.5×/0.6×, 1×, 2×, 3×/5×...), pinch zoom, a zoom dial that opens
// when you drag sideways on the lens buttons, tap to focus with a sun slider for exposure and an
// AE/AF lock, Off/Auto/On flash for the back camera, photo shapes (3:4, 9:16, 1:1, Full), grid,
// level, and Auto HDR in the phone app.
//
// Zoom has three engines: the phone app's native camera (real lenses, NativeCam.setZoom), a browser
// camera that can zoom itself (MediaStreamTrack "zoom"), or a crop of the preview ("digital").
// Loaded after app.js and shares its globals (cam, $, store, NativeCam...).

const RATIOS = { full: ["Full", 0], "3:4": ["3:4", 3 / 4], "9:16": ["9:16", 9 / 16], "1:1": ["1:1", 1] };
const RATIO_ORDER = ["3:4", "9:16", "1:1", "full"];
const camRatio = () => (RATIOS[store.get("glowRatio")] ? store.get("glowRatio") : "full");
const camOpt = (k) => store.get(k) === "on";
const DIAL_PX = 120;   // dial pixels per doubling of zoom
const WEB_DIGITAL_MAX = 4, FRONT_MAX = 4;

Object.assign(cam, { zoom: 1, zr: null, ev: 0, evr: null, focus: null });

// ---------- What the preview shows: frame, mapping ----------

// The photo's frame inside the viewfinder (CSS pixels), like the phones' 3:4 / 9:16 / 1:1 frames:
// full width, a little above the middle, below the top bar where it fits.
function camFrameRect() {
  const vf = $("viewfinder").getBoundingClientRect(), W = vf.width, H = vf.height;
  const a = RATIOS[camRatio()][1];
  if (!a || !W || !H) return { x: 0, y: 0, w: W, h: H };
  let w = W, h = W / a;
  if (h > H) { h = H; w = H * a; }
  const top = Math.max(0, $("cameraScreen").querySelector(".cam-top").getBoundingClientRect().bottom - vf.top);
  const y = Math.min(Math.max(top, (H - h) * 0.35), H - h);
  return { x: (W - w) / 2, y: Math.max(0, y), w, h };
}
// Digital zoom (browser cameras that can't zoom themselves) scales the preview about the frame's centre.
const digitalZoom = () => (cam.zr && cam.zr.mode === "digital" ? cam.zoom : 1);
// Viewfinder point (CSS px) → point in the camera picture as shown (0..1, mirrored like the preview).
function camToNorm(x, y) {
  const vf = $("viewfinder").getBoundingClientRect();
  const W = cam.native ? cam.native.w : $("camVideo").videoWidth, H = cam.native ? cam.native.h : $("camVideo").videoHeight;
  if (!W || !H || !vf.width) return [x / (vf.width || 1), y / (vf.height || 1)];
  const k = Math.max(vf.width / W, vf.height / H), dw = W * k, dh = H * k;
  const ox = (vf.width - dw) / 2, oy = (vf.height - dh) * (cam.posY == null ? 0.5 : cam.posY);
  const f = camFrameRect(), fx = f.x + f.w / 2, fy = f.y + f.h / 2, z = digitalZoom();
  return [(fx + (x - fx) / z - ox) / dw, (fy + (y - fy) / z - oy) / dh];
}
// The frame as [x, y, w, h] fractions of the camera picture as shown.
function camFrameNorm() {
  const f = camFrameRect(), [x0, y0] = camToNorm(f.x, f.y), [x1, y1] = camToNorm(f.x + f.w, f.y + f.h);
  const cl = (n) => Math.min(1, Math.max(0, n));
  const x = cl(x0), y = cl(y0);
  return [x, y, cl(x1) - x, cl(y1) - y].map((n) => Math.round(n * 1e5) / 1e5);
}
// The part of a W×H picture (as shown, mirroring included) that the frame holds: the saved photo.
function camShotRect(W, H) {
  const [x, y, w, h] = camFrameNorm();
  const r = { x: Math.round(x * W), y: Math.round(y * H), w: Math.max(1, Math.round(w * W)), h: Math.max(1, Math.round(h * H)) };
  r.w = Math.min(W - r.x, r.w); r.h = Math.min(H - r.y, r.h);
  return r;
}

// Draws the frame (dark around it), grid and level, keeps the preview's zoom origin on the frame,
// and fits the photo on review into the same frame.
function layoutCamFrame() {
  const f = camFrameRect(), el = $("camFrame"), full = camRatio() === "full";
  Object.assign(el.style, { left: f.x + "px", top: f.y + "px", width: f.w + "px", height: f.h + "px" });
  el.classList.toggle("masked", !full);
  const c = $("camCanvas");
  c.style.transformOrigin = `${f.x + f.w / 2}px ${f.y + f.h / 2}px`;
  c.style.transform = digitalZoom() > 1.001 ? `scale(${digitalZoom()})` : "";
  const img = $("reviewImg");
  if (cam.shot && !full) Object.assign(img.style, { inset: "auto", left: f.x + "px", top: f.y + "px", width: f.w + "px", height: f.h + "px" });
  else ["left", "top", "width", "height", "inset"].forEach((k) => { img.style[k] = ""; });
  $("camGrid").hidden = !camOpt("glowGrid") || !!cam.shot;
  $("camLevel").hidden = !camOpt("glowLevel") || !!cam.shot || cam.state !== "live";
}
window.addEventListener("resize", () => { if (screen === "cameraScreen") layoutCamFrame(); });

// ---------- Zoom ----------

const fmtZoom = (z) => (z >= 9.95 ? String(Math.round(z)) : (Math.round(z * 10) / 10).toFixed(1).replace(/\.0$/, ""));
// Lens buttons for a zoom range (used when the camera doesn't name its lenses).
function defaultLenses(min, max, front) {
  if (front) return [min < 0.95 ? min : null, 1, max >= 2 ? 2 : null].filter((n) => n != null);
  return [min < 0.95 ? min : null, 1, max >= 2 ? 2 : null, max >= 10 ? 5 : max >= 4 ? 3 : null].filter((n) => n != null);
}
function cleanLenses(list, min, max) {
  const out = [];
  for (let n of list) {
    n = n < 1 ? Math.round(n * 10) / 10 : Math.round(n * 2) / 2;
    if (n >= min - 0.01 && n <= max + 0.01 && !out.some((m) => Math.abs(m - n) < 0.05)) out.push(n);
  }
  if (!out.some((n) => Math.abs(n - 1) < 0.05)) out.push(1);
  return out.sort((a, b) => a - b).slice(0, 6);
}

// Called once the camera is live. r: the native camera's start result (phone app), else none.
function camProStart(r) {
  const front = cam.facing === "user";
  cam.zoom = 1; cam.ev = 0; cam.focus = null; cam.zr = null; cam.evr = null;
  if (cam.native) {
    if (r && Number.isFinite(r.zoomMax)) {
      const min = Math.max(0.3, r.zoomMin || 1), max = Math.min(front ? FRONT_MAX : 15, r.zoomMax);
      const lenses = Array.isArray(r.lenses) && r.lenses.length ? (front ? r.lenses.filter((n) => n <= 2.01) : r.lenses) : defaultLenses(min, max, front);
      cam.zr = { mode: "native", min: Math.min(1, min), max: Math.max(1, max), lenses: cleanLenses(front && !lenses.includes(2) && max >= 2 ? [...lenses, 2] : lenses, min, max) };
    }
    if (r && Array.isArray(r.ev) && r.ev[1] > r.ev[0]) cam.evr = { min: Math.max(-2, r.ev[0]), max: Math.min(2, r.ev[1]), mode: "native" };
    cam.hdrAvail = !!(r && r.hdr);
  } else {
    const t = cam.stream && cam.stream.getVideoTracks()[0];
    let caps = {};
    try { caps = (t && t.getCapabilities && t.getCapabilities()) || {}; } catch {}
    if (caps.zoom && caps.zoom.max > caps.zoom.min && caps.zoom.max >= 1.5) {
      // Browsers report the camera's own zoom numbers (1 = the main lens on phones).
      const min = Math.max(0.3, caps.zoom.min), max = Math.min(front ? FRONT_MAX : 10, caps.zoom.max);
      cam.zr = { mode: "track", min: Math.min(1, min), max, lenses: cleanLenses(defaultLenses(min, max, front), min, max), track: t };
    } else cam.zr = { mode: "digital", min: 1, max: WEB_DIGITAL_MAX, lenses: [1, 2] };
    if (caps.exposureCompensation && caps.exposureCompensation.max > caps.exposureCompensation.min)
      cam.evr = { min: -2, max: 2, mode: "track", c: caps.exposureCompensation, track: t };
    else cam.evr = { min: -2, max: 2, mode: "digital" };
    cam.canLock = !!(caps.focusMode && caps.focusMode.includes("manual") && caps.exposureMode && caps.exposureMode.includes("manual"));
    cam.hdrAvail = false;
  }
  if (cam.native) cam.canLock = !!(r && r.focus);
  applyFlashMode();
  renderLenses(); buildDial(); applyEv(); hideFocus(true); renderQuick(); layoutCamFrame(); startLevel();
}
function camProStop() {
  cancelAnimationFrame(zAnim); cam.zr = null; $("camZoom").hidden = true; hideFocus(true); stopLevel();
  $("camCanvas").style.transform = ""; $("camCanvas").style.filter = "";
}

let zAnim = 0, zSent = 0, zBusy = false, zWant = null, lastStop = null;
// Sets the zoom. Lens taps glide there (about a quarter second), pinches and the dial follow the finger.
function camSetZoom(z, { animate = false } = {}) {
  const R = cam.zr; if (!R) return;
  z = Math.min(R.max, Math.max(R.min, z));
  cancelAnimationFrame(zAnim);
  if (animate && Math.abs(z - cam.zoom) > 0.01) {
    const a = Math.log(cam.zoom), b = Math.log(z), t0 = performance.now(), D = 260;
    const step = (now) => {
      const k = Math.min(1, (now - t0) / D), e = 1 - Math.pow(1 - k, 3);
      applyZoom(Math.exp(a + (b - a) * e));
      if (k < 1) zAnim = requestAnimationFrame(step);
    };
    zAnim = requestAnimationFrame(step);
  } else applyZoom(z);
}
function applyZoom(z) {
  const R = cam.zr; if (!R) return;
  // A light tick when the zoom passes one of the lenses, like the phones' dial.
  const stop = R.lenses.filter((n) => n <= z + 0.001).pop();
  if (lastStop != null && stop !== lastStop) Platform.haptic();
  lastStop = stop;
  cam.zoom = z;
  if (R.mode === "native") sendZoom(z);
  else if (R.mode === "track") sendZoom(z);
  else layoutCamFrame();
  renderLenses(); renderDial();
}
// One zoom call in flight at a time; the newest value wins.
async function sendZoom(z) {
  zWant = z;
  if (zBusy) return;
  zBusy = true;
  try {
    while (zWant != null) {
      const v = zWant; zWant = null;
      if (Math.abs(v - zSent) < 0.005) continue;
      zSent = v;
      if (cam.zr && cam.zr.mode === "native") await NativeCam.setZoom({ zoom: v }).catch(() => {});
      else if (cam.zr && cam.zr.mode === "track") await cam.zr.track.applyConstraints({ advanced: [{ zoom: v }] }).catch(() => {});
    }
  } finally { zBusy = false; }
}

function renderLenses() {
  const R = cam.zr, box = $("camLenses");
  $("camZoom").hidden = !R || cam.state !== "live" || !!cam.shot;
  if (!R) return;
  const z = cam.zoom, act = R.lenses.filter((n) => n <= z + 0.02).pop() ?? R.lenses[0];
  if (box.children.length !== R.lenses.length || box.dataset.key !== R.lenses.join()) {
    box.dataset.key = R.lenses.join();
    box.replaceChildren(...R.lenses.map((n) => {
      const b = document.createElement("button"); b.type = "button"; b.dataset.z = n;
      b.addEventListener("click", () => { if (lensDragged) return; Platform.haptic(); camSetZoom(n, { animate: true }); track("camera_zoom", { to: n }); });
      return b;
    }));
  }
  [...box.children].forEach((b) => {
    const n = Number(b.dataset.z), on = n === act;
    b.textContent = on ? fmtZoom(z) + "×" : fmtZoom(n);
    b.classList.toggle("on", on);
    b.setAttribute("aria-pressed", String(on && Math.abs(z - n) < 0.05));
    b.setAttribute("aria-label", `Zoom ${fmtZoom(n)} times`);
  });
}

// The dial: a ruler of tick marks under a fixed centre line; dragging moves the ruler.
function buildDial() {
  const R = cam.zr, t = $("camDialTrack");
  if (!R) { t.replaceChildren(); return; }
  const marks = [];
  for (let v = R.min; v <= R.max + 1e-6;) {
    const major = R.lenses.some((n) => Math.abs(n - v) < 0.02) || [5, 10, 15].some((n) => Math.abs(n - v) < 0.02);
    marks.push(`<i class="${major ? "mj" : ""}" style="left:${(Math.log2(v / R.min) * DIAL_PX).toFixed(1)}px">${major ? `<b>${fmtZoom(v)}</b>` : ""}</i>`);
    const s = v < 2 ? 0.1 : v < 5 ? 0.25 : v < 10 ? 0.5 : 1;
    v = Math.round((v + s) / s) * s;
  }
  t.innerHTML = marks.join("");
  renderDial();
}
function renderDial() {
  const R = cam.zr; if (!R) return;
  $("camDialTrack").style.transform = `translateX(${(-Math.log2(cam.zoom / R.min) * DIAL_PX).toFixed(1)}px)`;
  $("camDialVal").textContent = fmtZoom(cam.zoom) + "×";
}
let dialTimer = 0;
function showDial(on) {
  clearTimeout(dialTimer);
  if (on) { $("camDial").hidden = false; $("camZoom").classList.add("dialing"); renderDial(); }
  else dialTimer = setTimeout(() => { $("camDial").hidden = true; $("camZoom").classList.remove("dialing"); }, 1200);
}
// Drag sideways on the lens buttons (or the open dial) to turn the dial: left zooms in.
let lensDrag = null, lensDragged = false;
$("camZoom").addEventListener("pointerdown", (e) => {
  if (!cam.zr) return;
  lensDrag = { id: e.pointerId, x: e.clientX, z: cam.zoom, on: !$("camDial").hidden }; lensDragged = false;
});
$("camZoom").addEventListener("pointermove", (e) => {
  if (!lensDrag || e.pointerId !== lensDrag.id) return;
  const dx = e.clientX - lensDrag.x;
  if (!lensDrag.on && Math.abs(dx) < 8) return;
  if (!lensDrag.on) { lensDrag.on = true; try { $("camZoom").setPointerCapture(e.pointerId); } catch {} }
  lensDragged = true; showDial(true);
  camSetZoom(lensDrag.z * Math.pow(2, -dx / DIAL_PX));
});
const endLensDrag = (e) => {
  if (!lensDrag || e.pointerId !== lensDrag.id) return;
  const was = lensDragged; lensDrag = null;
  if (was) { showDial(false); setTimeout(() => { lensDragged = false; }, 0); }
};
["pointerup", "pointercancel"].forEach((n) => $("camZoom").addEventListener(n, endLensDrag));
// Keyboard: the lens buttons' group takes + and − like a zoom control.
$("camZoom").addEventListener("keydown", (e) => {
  if (!cam.zr) return;
  if (e.key === "+" || e.key === "=" || e.key === "ArrowUp") { e.preventDefault(); camSetZoom(cam.zoom * 1.25); }
  else if (e.key === "-" || e.key === "_" || e.key === "ArrowDown") { e.preventDefault(); camSetZoom(cam.zoom / 1.25); }
});

// ---------- Focus and exposure ----------

let focusTimer = 0;
function hideFocus(now) {
  clearTimeout(focusTimer);
  const el = $("camFocus");
  if (now) { el.hidden = true; el.classList.remove("dim"); $("camLocked").hidden = true; return; }
  el.classList.add("dim");
}
function showFocusAt(x, y) {
  const el = $("camFocus"), vf = $("viewfinder").getBoundingClientRect();
  el.style.left = Math.min(vf.width - 60, Math.max(44, x)) + "px"; el.style.top = Math.min(vf.height - 60, Math.max(60, y)) + "px";
  el.hidden = false; el.classList.remove("dim", "pop"); void el.offsetWidth; el.classList.add("pop");
  $("camLock").hidden = !cam.canLock;
  renderEv(); armFocusFade();
}
function armFocusFade() { clearTimeout(focusTimer); if (!(cam.focus && cam.focus.locked)) focusTimer = setTimeout(() => hideFocus(false), 3500); }
// Point (CSS px in the viewfinder) → the camera picture's own coordinates (0..1, not mirrored).
function camPoint(x, y) {
  const [nx, ny] = camToNorm(x, y), cl = (n) => Math.min(1, Math.max(0, n));
  return [cl(cam.facing === "user" ? 1 - nx : nx), cl(ny)];
}
async function camFocusAt(x, y, lock = false) {
  const [u, v] = camPoint(x, y);
  cam.focus = { x, y, u, v, locked: lock };
  $("camLocked").hidden = !lock; $("camLock").setAttribute("aria-pressed", String(lock));
  if (!lock) { cam.ev = 0; applyEv(); }
  showFocusAt(x, y);
  track("camera_focus", { lock });
  try {
    if (cam.native) await NativeCam.focus({ x: u, y: v, lock });
    else {
      const t = cam.stream && cam.stream.getVideoTracks()[0];
      if (!t) return;
      const sup = navigator.mediaDevices.getSupportedConstraints ? navigator.mediaDevices.getSupportedConstraints() : {};
      const c = {};
      if (sup.pointsOfInterest) c.pointsOfInterest = [{ x: u, y: v }];
      if (cam.canLock) { c.focusMode = lock ? "manual" : "continuous"; c.exposureMode = lock ? "manual" : "continuous"; }
      else if (sup.focusMode) c.focusMode = "single-shot";
      if (Object.keys(c).length) await t.applyConstraints({ advanced: [c] });
    }
  } catch {}
}
function camUnlock() {
  if (!cam.focus || !cam.focus.locked) return;
  cam.focus.locked = false; $("camLocked").hidden = true; $("camLock").setAttribute("aria-pressed", "false");
  if (cam.native) NativeCam.focus({ reset: true }).catch(() => {});
  else if (cam.canLock && cam.stream) cam.stream.getVideoTracks()[0].applyConstraints({ advanced: [{ focusMode: "continuous", exposureMode: "continuous" }] }).catch(() => {});
  armFocusFade();
}
$("camLock").addEventListener("click", (e) => {
  e.stopPropagation(); Platform.haptic();
  if (cam.focus && cam.focus.locked) camUnlock(); else if (cam.focus) camFocusAt(cam.focus.x, cam.focus.y, true);
  say(cam.focus && cam.focus.locked ? "Focus and exposure locked" : "Focus and exposure unlocked");
});
$("camLock").addEventListener("pointerdown", (e) => e.stopPropagation());

// Exposure, in stops (−2 to +2). Real exposure where the camera allows it, else a brightness
// change on the preview that is baked into the photo too.
function applyEv() {
  const R = cam.evr, ev = cam.ev;
  $("camCanvas").style.filter = R && R.mode === "digital" && Math.abs(ev) > 0.01 ? `brightness(${camEvGain().toFixed(3)})` : "";
  if (!R) return;
  if (R.mode === "native") sendEv(ev);
  else if (R.mode === "track") {
    const c = R.c, v = ev >= 0 ? (ev / 2) * Math.min(c.max, 2 * Math.max(1, c.max / 2)) : (ev / 2) * Math.min(-c.min, 2 * Math.max(1, -c.min / 2));
    const s = c.step || 0.1;
    sendEv(Math.min(c.max, Math.max(c.min, Math.round(v / s) * s)));
  }
}
const camEvGain = () => (cam.evr && cam.evr.mode === "digital" ? Math.pow(2, cam.ev * 0.6) : 1);
let evBusy = false, evWant = null;
async function sendEv(v) {
  evWant = v; if (evBusy) return; evBusy = true;
  try {
    while (evWant != null) {
      const x = evWant; evWant = null;
      if (cam.evr.mode === "native") await NativeCam.setExposure({ ev: x }).catch(() => {});
      else await cam.evr.track.applyConstraints({ advanced: [{ exposureCompensation: x }] }).catch(() => {});
    }
  } finally { evBusy = false; }
}
function renderEv() {
  const knob = $("camSun"), ev = cam.ev;
  knob.style.transform = `translateY(${(-ev / 2) * 44}px)`;
  $("camFocus").classList.toggle("ev-set", Math.abs(ev) > 0.01);
  $("camEvVal").textContent = Math.abs(ev) > 0.01 ? (ev > 0 ? "+" : "−") + Math.abs(ev).toFixed(1) : "";
}
function camSetEv(ev) {
  const R = cam.evr; if (!R) return;
  const was = cam.ev;
  cam.ev = Math.round(Math.min(R.max, Math.max(R.min, ev)) * 10) / 10;
  if (cam.ev !== was) { if (cam.ev === 0) Platform.haptic(); applyEv(); renderEv(); }
}

// ---------- Gestures on the preview ----------
// One finger: a tap focuses there; a slide up or down (after a tap) changes exposure; holding
// still shows the photo without the look (as before). Two fingers pinch to zoom.
const vfPtrs = new Map();
let vfGest = null, compareT = 0;
$("viewfinder").addEventListener("pointerdown", (e) => {
  if (cam.state !== "live" || cam.shot || e.target.closest(".vf-state") || e.target.closest("#camLock")) return;
  const vf = $("viewfinder").getBoundingClientRect();
  vfPtrs.set(e.pointerId, { x: e.clientX - vf.left, y: e.clientY - vf.top });
  clearTimeout(compareT);
  if (vfPtrs.size === 2) {
    const [a, b] = [...vfPtrs.values()];
    endCompare();
    vfGest = cam.zr ? { kind: "pinch", d: Math.hypot(a.x - b.x, a.y - b.y) || 1, z: cam.zoom } : { kind: "none" };
    if (cam.zr) showDial(true);
    return;
  }
  if (vfPtrs.size > 2) return;
  const p = vfPtrs.get(e.pointerId);
  vfGest = { kind: "tap", x: p.x, y: p.y, t: performance.now(), ev: cam.ev, focusShown: !$("camFocus").hidden };
  if (cam.gl) compareT = setTimeout(() => { if (vfGest && vfGest.kind === "tap") { vfGest.kind = "hold"; cam.compare = true; $("camCompare").hidden = false; renderCamFx(); } }, 350);
});
$("viewfinder").addEventListener("pointermove", (e) => {
  const q = vfPtrs.get(e.pointerId); if (!q || !vfGest) return;
  const vf = $("viewfinder").getBoundingClientRect();
  q.x = e.clientX - vf.left; q.y = e.clientY - vf.top;
  if (vfGest.kind === "pinch" && vfPtrs.size >= 2) {
    const [a, b] = [...vfPtrs.values()];
    camSetZoom(vfGest.z * Math.hypot(a.x - b.x, a.y - b.y) / vfGest.d);
  } else if (vfGest.kind === "tap" || vfGest.kind === "ev") {
    const dx = q.x - vfGest.x, dy = q.y - vfGest.y;
    if (vfGest.kind === "tap" && Math.hypot(dx, dy) > 10) {
      clearTimeout(compareT);
      // A vertical slide while the focus square is up changes exposure, like the phones' sun slider.
      // Otherwise a quick up or down swipe switches cameras (shoot.js), like Samsung's camera.
      vfGest.kind = vfGest.focusShown && cam.evr && Math.abs(dy) > Math.abs(dx) ? "ev" : Math.abs(dy) > Math.abs(dx) * 1.5 ? "swipe" : "none";
      if (vfGest.kind === "ev") { $("camFocus").classList.remove("dim"); clearTimeout(focusTimer); }
    }
    if (vfGest.kind === "ev") camSetEv(vfGest.ev - dy / 90);
  }
});
const vfUp = (e) => {
  if (!vfPtrs.has(e.pointerId)) return;
  const q = vfPtrs.get(e.pointerId); vfPtrs.delete(e.pointerId);
  clearTimeout(compareT);
  const g = vfGest;
  if (g && g.kind === "hold") endCompare();
  if (g && g.kind === "pinch") { if (vfPtrs.size === 0) { vfGest = null; showDial(false); } return; }
  vfGest = vfPtrs.size ? vfGest : null;
  if (!g || e.type === "pointercancel") return;
  // A tap focuses; so does a slow tap that only just started the compare (under half a second).
  if ((g.kind === "tap" || g.kind === "hold") && performance.now() - g.t < 500) {
    if (cam.focus && cam.focus.locked) camUnlock();
    camFocusAt(q.x, q.y);
  } else if (g.kind === "ev") armFocusFade();
  else if (g.kind === "swipe" && typeof camSwipe === "function") camSwipe(q.x - g.x, q.y - g.y, performance.now() - g.t);
};
["pointerup", "pointercancel"].forEach((n) => $("viewfinder").addEventListener(n, vfUp));
$("viewfinder").addEventListener("pointerleave", (e) => { if (vfGest && vfGest.kind === "hold") endCompare(); });
// Desktop: the mouse wheel over the preview zooms.
$("viewfinder").addEventListener("wheel", (e) => {
  if (!cam.zr || cam.state !== "live" || cam.shot) return;
  e.preventDefault(); showDial(true); camSetZoom(cam.zoom * Math.exp(-e.deltaY * 0.002)); showDial(false);
}, { passive: false });

// ---------- Flash (back camera): Off, Auto, On ----------

const FLASH_MODES = { auto: ["Auto", "Flash auto"], on: ["On", "Flash on"], off: ["Off", "Flash off"] };
const rearFlashMode = () => (FLASH_MODES[store.get("glowFlash")] ? store.get("glowFlash") : "auto");
function applyFlashMode() {
  if (cam.native && !cam.screenFlash && cam.nativeTorch) NativeCam.setFlash({ mode: rearFlashMode() }).catch(() => {});
}
function renderRearFlash(b) {
  const m = rearFlashMode();
  b.classList.add("sflash"); b.innerHTML = icon(m === "off" ? "flashoff" : "flash") + (m === "auto" ? '<span class="fa" aria-hidden="true">A</span>' : "");
  b.setAttribute("aria-pressed", String(m !== "off")); b.setAttribute("aria-label", FLASH_MODES[m][1]);
}
function cycleRearFlash() {
  const next = { auto: "on", on: "off", off: "auto" }[rearFlashMode()];
  store.set("glowFlash", next); Platform.haptic(); renderFlashBtn(); applyFlashMode();
  say(`Flash: ${FLASH_MODES[next][0]}`); track("setting", { flash: next });
}
// Browser cameras have a torch, not a flash: Auto and On light it for the moment of the shot.
async function webFlashOn(v) {
  const m = rearFlashMode();
  if (cam.native || cam.screenFlash || !cam.stream || !Platform.camera.torchSupported(cam.stream) || m === "off") return null;
  if (m === "auto" && sceneLight(v) > 70) return null;
  try { await Platform.camera.setTorch(cam.stream, true); } catch { return null; }
  await sleep(700);
  const s = cam.stream;
  return () => Platform.camera.setTorch(s, false).catch(() => {});
}

// ---------- Photo shape, quick settings (grid, level, HDR) ----------

function renderRatioBtn() {
  const r = camRatio(), b = $("camRatio");
  b.textContent = RATIOS[r][0]; b.setAttribute("aria-label", `Photo shape: ${RATIOS[r][0] === "Full" ? "full screen" : RATIOS[r][0]}`);
}
$("camRatio").addEventListener("click", () => {
  const next = RATIO_ORDER[(RATIO_ORDER.indexOf(camRatio()) + 1) % RATIO_ORDER.length];
  store.set("glowRatio", next); Platform.haptic(); renderRatioBtn(); layoutCamFrame();
  say(`Photo shape: ${RATIOS[next][0]}`); track("setting", { ratio: next });
});
function renderQuick() {
  const q = $("camQuick");
  q.querySelectorAll("[data-q]").forEach((b) => {
    const k = b.dataset.q;
    if (!["grid", "level", "hdr"].includes(k)) return;   // Palm and More settings: shoot.js
    if (k === "hdr") b.hidden = !cam.hdrAvail;
    b.setAttribute("aria-pressed", String(camOpt({ grid: "glowGrid", level: "glowLevel", hdr: "glowHdr" }[k])));
  });
}
$("camMore").addEventListener("click", () => {
  const open = $("camQuick").hidden;
  $("camQuick").hidden = !open; $("camMore").setAttribute("aria-expanded", String(open)); renderQuick(); Platform.haptic();
});
$("camQuick").addEventListener("click", async (e) => {
  const b = e.target.closest("[data-q]"); if (!b) return;
  const k = { grid: "glowGrid", level: "glowLevel", hdr: "glowHdr" }[b.dataset.q]; if (!k) return;
  const on = !camOpt(k);
  if (b.dataset.q === "level" && on) await askMotion();
  store.set(k, on ? "on" : "off"); Platform.haptic(); renderQuick(); layoutCamFrame();
  track("setting", { [b.dataset.q]: on });
  if (b.dataset.q === "level") { if (on) startLevel(); else stopLevel(); }
  // HDR changes how the phone app's camera is set up, so it reopens.
  if (b.dataset.q === "hdr" && cam.native) startCamera();
});

// The level: a line through the middle of the frame that stays level with the world and turns
// gold when the phone is straight (within a degree). Uses the phone's motion sensor.
let levelOn = false, levelAng = null;
async function askMotion() {
  try { if (window.DeviceMotionEvent && typeof DeviceMotionEvent.requestPermission === "function") await DeviceMotionEvent.requestPermission(); } catch {}
}
function onMotion(e) {
  const g = e.accelerationIncludingGravity; if (!g || g.x == null) return;
  const s = /iPhone|iPad|iPod/.test(navigator.userAgent) ? -1 : 1, ax = g.x * s, ay = g.y * s, az = (g.z || 0) * s;
  const el = $("camLevel");
  if (Math.abs(az) > 8.3) { el.classList.add("flat"); return; }   // lying flat: no horizon to show
  el.classList.remove("flat");
  // Degrees the phone is turned clockwise from upright, and how far that is from the nearest
  // way of holding it (upright or sideways).
  let a = (Math.atan2(-ax, ay) * 180) / Math.PI;
  if (!cam.native) a -= (window.screen.orientation && window.screen.orientation.angle) || 0;
  levelAng = levelAng == null ? a : levelAng + (((a - levelAng + 540) % 360) - 180) * 0.3;
  const off = ((levelAng % 90) + 135) % 90 - 45;
  el.style.setProperty("--lvl", `${(-levelAng).toFixed(2)}deg`);
  el.style.setProperty("--lvl-base", `${(-(levelAng - off)).toFixed(0)}deg`);
  const flat = Math.abs(off) < 1;
  if (flat && !el.classList.contains("ok")) Platform.haptic();
  el.classList.toggle("ok", flat);
}
function startLevel() {
  if (!camOpt("glowLevel") || levelOn || cam.state !== "live") return;
  levelOn = true; levelAng = null; window.addEventListener("devicemotion", onMotion);
}
function stopLevel() { if (!levelOn) return; levelOn = false; window.removeEventListener("devicemotion", onMotion); }

// Timer choices like the phones: Off, 3, 5 and 10 seconds.
TIMERS.splice(0, TIMERS.length, 0, 3, 5, 10);
renderRatioBtn(); setIcon($("camMore"), "chevdown");
setIcon($("camLock"), "lock");
if (cam.state === "live") camProStart(cam.nativeStart);
