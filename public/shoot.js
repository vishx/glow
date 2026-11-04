// Shooting methods and camera settings, like a Galaxy S26's camera (Settings → Shooting methods)
// and an iPhone's (2026-11-04):
//  - Show palm: hold an open hand up to the camera; after a moment a 2-second countdown starts
//    (or the timer, when it is longer) and the photo is taken. The hand finder is MediaPipe's
//    gesture recognizer: natively in the phone apps (PalmTracker), in palmworker.js on the web.
//  - Volume buttons take the photo or zoom (phone apps; the phone's own volume when set so).
//  - A floating shutter you can drag anywhere, for one-handed selfies.
//  - Swipe up or down on the preview to switch cameras.
//  - Save selfies as previewed (mirrored) or the way others see you.
//  - Shutter sound and vibration.
// The camera's gear opens these; "All Glow Studio settings" goes on to the app's Settings.
// Loaded after camerapro.js and shares its globals (cam, $, store, NativeCam, camShutter...).

const SHOOT = { palm: ["glowPalm", "on"], keys: ["glowVolKeys", "shoot"], float: ["glowFloatShutter", "off"], swipe: ["glowSwipeFlip", "on"],
  mirror: ["glowMirror", "on"], sound: ["glowShutterSound", "on"], vibrate: ["glowCamHaptics", "on"] };
const shootGet = (k) => store.get(SHOOT[k][0]) || SHOOT[k][1];
const shootOn = (k) => shootGet(k) === "on";
// An older phone app without the native hand finder (before versionCode 7) answers setPalm with
// an error: Show palm is then hidden there instead of seeming to do nothing.
const nativeMissing = { palm: false, keys: false };
const palmAvailable = () => featureOn("camera:palm") && !nativeMissing.palm;
const palmWanted = () => shootOn("palm") && palmAvailable();
const PALM_MODEL = "https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task";
const PALM_SIDE = 480;    // a hand at arm's length is still big enough for the model at this size
const PALM_HOLD = 450;    // ms an open palm must stay in view (so a wave doesn't take a photo)
const PALM_SECS = 2;      // the countdown after a palm, like Samsung's

// ---------- Show palm ----------

const palm = { worker: null, ready: false, failed: false, busy: false, sent: 0, tick: 0, since: 0, cool: 0, hideT: 0 };
function palmWorker() {
  if (palm.worker || palm.failed) return;
  try {
    const base = native ? new URL("vendor/mediapipe", location.href).href : MP_CDN;
    const model = native ? new URL("vendor/gesture_recognizer.task", location.href).href : PALM_MODEL;
    const w = (palm.worker = new Worker("palmworker.js"));
    w.onmessage = (e) => {
      const m = e.data;
      if (m.type === "ready") palm.ready = true;
      else if (m.type === "failed") { palm.failed = true; palm.ready = false; reportError(`Show palm hand finder failed: ${m.error || ""}`); }
      else if (m.type === "result") { palm.busy = false; if (!cam.native) onHand(m.hand); }
    };
    w.onerror = () => { palm.failed = true; palm.ready = false; };
    w.postMessage({ type: "init", base, model });
  } catch { palm.failed = true; }
}
// Web camera: a small copy of the frame to the worker, about six times a second.
const palmCopy = newCanvas(1, 1);
function palmWebTick() {
  const v = $("camVideo"), now = performance.now();
  if (palm.busy && now - palm.sent > 4000) palm.busy = false;
  if (cam.native || cam.state !== "live" || cam.shot || !palm.ready || palm.busy || !v.videoWidth || now - palm.sent < 160) return;
  const W = v.videoWidth, H = v.videoHeight, s = Math.min(1, PALM_SIDE / Math.max(W, H)), w = Math.round(W * s), h = Math.round(H * s);
  if (palmCopy.width !== w || palmCopy.height !== h) { palmCopy.width = w; palmCopy.height = h; }
  palmCopy.getContext("2d").drawImage(v, 0, 0, w, h);
  palm.busy = true; palm.sent = now;
  createImageBitmap(palmCopy).then((image) => {
    if (!palm.worker) { image.close(); palm.busy = false; return; }
    palm.worker.postMessage({ type: "frame", image, t: now }, [image]);
  }).catch(() => { palm.busy = false; });
}
function palmApply() {
  const on = palmWanted() && cam.state === "live";
  if (cam.native) NativeCam.setPalm({ on }).catch(() => { nativeMissing.palm = true; renderShootQuick(); });
  else if (on) { palmWorker(); if (!palm.tick) palm.tick = setInterval(palmWebTick, 60); }
  if (!on || cam.native) { clearInterval(palm.tick); palm.tick = 0; }
  if (!on) { palm.since = 0; showPalmBox(null); }
  renderShootQuick();
}
// hand: [score, x, y, w, h], a box in the camera's upright, unmirrored picture (0..1), or null.
function onHand(hand) {
  const now = performance.now();
  const ok = Array.isArray(hand) && hand.length === 5 && hand.every(Number.isFinite) && hand[0] >= 0.6 && hand[4] >= 0.08 &&
    palmWanted() && cam.state === "live" && !cam.shot && !cam.shooting && !cam.counting && now > palm.cool && !document.querySelector("dialog[open]");
  if (!ok) { palm.since = 0; if (!cam.counting) showPalmBox(null); return; }
  if (!palm.since) palm.since = now;
  const held = now - palm.since >= PALM_HOLD;
  showPalmBox(hand, held);
  if (held) firePalm();
}
async function firePalm() {
  palm.since = 0; palm.cool = performance.now() + 3500;
  Platform.haptic("success");
  const secs = Math.max(PALM_SECS, timerSecs());
  $("alertLive").textContent = `Palm seen. Taking the photo in ${secs} seconds.`;
  clearTimeout(palm.hideT); palm.hideT = setTimeout(() => showPalmBox(null), 800);
  track("palm_shot", { engine: cam.native ? "native" : "web" });
  await camShutter(secs, "palm");
}
// Where a point of the camera picture (upright, unmirrored, 0..1) shows in the viewfinder (CSS px):
// the inverse of camToNorm (camerapro.js), mirroring the front camera like the preview.
function camFromPicture(nx, ny) {
  const vf = $("viewfinder").getBoundingClientRect();
  const W = cam.native ? cam.native.w : $("camVideo").videoWidth, H = cam.native ? cam.native.h : $("camVideo").videoHeight;
  if (!W || !H || !vf.width) return [nx * vf.width, ny * vf.height];
  const k = Math.max(vf.width / W, vf.height / H), dw = W * k, dh = H * k;
  const ox = (vf.width - dw) / 2, oy = (vf.height - dh) * (cam.posY == null ? 0.5 : cam.posY);
  const f = camFrameRect(), fx = f.x + f.w / 2, fy = f.y + f.h / 2, z = digitalZoom();
  const px = (cam.facing === "user" ? 1 - nx : nx) * dw + ox, py = ny * dh + oy;
  return [fx + (px - fx) * z, fy + (py - fy) * z];
}
function showPalmBox(hand, held) {
  const el = $("camPalm");
  if (!hand) { el.hidden = true; el.classList.remove("held"); return; }
  const [a, b] = [camFromPicture(hand[1], hand[2]), camFromPicture(hand[1] + hand[3], hand[2] + hand[4])];
  const x = Math.min(a[0], b[0]), y = Math.min(a[1], b[1]), w = Math.abs(b[0] - a[0]), h = Math.abs(b[1] - a[1]), pad = Math.max(w, h) * 0.12;
  Object.assign(el.style, { left: `${(x - pad).toFixed(1)}px`, top: `${(y - pad).toFixed(1)}px`, width: `${(w + pad * 2).toFixed(1)}px`, height: `${(h + pad * 2).toFixed(1)}px` });
  el.hidden = false; el.classList.toggle("held", !!held);
}
// The first few times the camera opens with Show palm on, a short note says how it works.
function palmHint() {
  const n = Number(store.get("glowPalmHints")) || 0, el = $("camPalmHint");
  if (n >= 3 || !palmWanted() || cam.state !== "live") return;
  store.set("glowPalmHints", String(n + 1));
  el.innerHTML = icon("palm") + "Show your palm to take a photo";
  el.hidden = false; clearTimeout(el.t); el.t = setTimeout(() => { el.hidden = true; }, 3500);
}

// ---------- Volume buttons (phone apps) ----------

function keysApply() { if (cam.native) NativeCam.setKeys({ mode: shootGet("keys") }).catch(() => { nativeMissing.keys = true; }); }
function onKey(m) {
  if (!m || screen !== "cameraScreen" || cam.state !== "live" || cam.shot || document.querySelector("dialog[open]")) return;
  const mode = shootGet("keys");
  if (mode === "zoom") {
    if (!m.down || !cam.zr) return;
    showDial(true); camSetZoom(cam.zoom * (m.key === "up" ? 1.12 : 1 / 1.12)); showDial(false);
  } else if (mode === "shoot" && !m.down) camShutter(undefined, "volume");
}
if (NativeCam) {
  NativeCam.addListener("palm", (m) => onHand(m && Array.isArray(m.hand) ? m.hand.map(Number) : null));
  NativeCam.addListener("key", onKey);
}

// ---------- Floating shutter ----------

function floatPos() {
  const [x, y] = String(store.get("glowFloatPos") || "").split(",").map(Number);
  return Number.isFinite(x) && Number.isFinite(y) ? [x, y] : [0.82, 0.62];
}
function floatApply() {
  const b = $("camFloat"), on = shootOn("float") && cam.state === "live" && !cam.shot;
  b.hidden = !on; if (!on) return;
  const vf = $("viewfinder").getBoundingClientRect(), [fx, fy] = floatPos(), r = 32;
  b.style.left = `${Math.min(vf.width - r - 8, Math.max(r + 8, fx * vf.width)) - r}px`;
  b.style.top = `${Math.min(vf.height - r - 8, Math.max(r + 8, fy * vf.height)) - r}px`;
}
let floatDrag = null;
$("camFloat").addEventListener("pointerdown", (e) => {
  e.stopPropagation();
  floatDrag = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false };
  try { $("camFloat").setPointerCapture(e.pointerId); } catch {}
});
$("camFloat").addEventListener("pointermove", (e) => {
  if (!floatDrag || e.pointerId !== floatDrag.id) return;
  if (!floatDrag.moved && Math.hypot(e.clientX - floatDrag.x, e.clientY - floatDrag.y) < 8) return;
  floatDrag.moved = true;
  const vf = $("viewfinder").getBoundingClientRect();
  store.set("glowFloatPos", `${((e.clientX - vf.left) / vf.width).toFixed(4)},${((e.clientY - vf.top) / vf.height).toFixed(4)}`);
  floatApply();
});
const floatUp = (e) => {
  e.stopPropagation();
  if (!floatDrag || e.pointerId !== floatDrag.id) return;
  const moved = floatDrag.moved; floatDrag = null;
  if (!moved && e.type === "pointerup") { Platform.haptic(); camShutter(undefined, "float"); }
};
["pointerup", "pointercancel"].forEach((n) => $("camFloat").addEventListener(n, floatUp));
// Keyboard and screen readers: a click with no pointer (Enter, Space, double tap).
$("camFloat").addEventListener("click", (e) => { e.stopPropagation(); if (e.detail === 0) camShutter(undefined, "float"); });
window.addEventListener("resize", () => { if (!$("camFloat").hidden) floatApply(); });

// ---------- Swipe to switch cameras ----------

// From the preview's gestures (camerapro.js): a quick, mostly vertical swipe.
function camSwipe(dx, dy, ms) {
  if (!shootOn("swipe") || Math.abs(dy) < 70 || ms > 700 || $("camFlip").hidden || cam.state !== "live" || cam.shot) return;
  track("camera_swipe_flip");
  $("camFlip").click();
}

// ---------- Selfies as others see you ----------

// "Save selfies as previewed" off: the front camera's photo flipped back, as others see you. (A
// photo taken with the phone sideways was turned, so the screen's left-right is its up-down.)
async function unmirrorShot(s) {
  if (cam.facing !== "user" || shootOn("mirror") || !s) return s;
  const vert = s.deg === 90 || s.deg === 270;
  const flip = async (src) => {
    const img = await loadImg(src), c = newCanvas(img.naturalWidth, img.naturalHeight), x = c.getContext("2d");
    if (vert) { x.translate(0, c.height); x.scale(1, -1); } else { x.translate(c.width, 0); x.scale(-1, 1); }
    x.drawImage(img, 0, 0); return c;
  };
  const rc = await flip(s.raw);
  const out = { ...s, raw: rc.toDataURL("image/jpeg", 0.95), rawBlob: await canvasBlob(rc, "image/jpeg", 0.95) };
  if (s.processed) out.processed = (await flip(s.processed)).toDataURL("image/jpeg", 0.92);
  return out;
}

// ---------- Shutter sound and vibration ----------

let shootAudio = null;
function audioCtx() {
  try { shootAudio = shootAudio || new (window.AudioContext || window.webkitAudioContext)(); if (shootAudio.state === "suspended") shootAudio.resume(); } catch {}
  return shootAudio;
}
// A soft two-part mechanical click, made on the spot (no sound file).
function shutterSound() {
  if (!shootOn("sound")) return;
  const a = audioCtx(); if (!a) return;
  try {
    const click = (at, len, freq, gain) => {
      const n = Math.round(a.sampleRate * len), buf = a.createBuffer(1, n, a.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 4);
      const src = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain();
      f.type = "bandpass"; f.frequency.value = freq; f.Q.value = 1.2; g.gain.value = gain;
      src.buffer = buf; src.connect(f); f.connect(g); g.connect(a.destination); src.start(a.currentTime + at);
    };
    click(0, 0.05, 3200, 0.9); click(0.075, 0.06, 1800, 0.6);
  } catch {}
}
// The sound needs one touch first in browsers; any touch on the camera screen unlocks it.
$("cameraScreen").addEventListener("pointerdown", () => { if (shootOn("sound") && !shootAudio) audioCtx(); }, { passive: true });
// Vibration feedback off: the camera screen stays still (the rest of the app is unchanged).
{
  const haptic0 = Platform.haptic.bind(Platform);
  Platform.haptic = (kind) => { if (screen === "cameraScreen" && !shootOn("vibrate")) return; haptic0(kind); };
}

// ---------- Camera settings sheet ----------

const CS_SWITCHES = { csPalm: "palm", csFloat: "float", csSwipe: "swipe", csMirror: "mirror", csSound: "sound", csVibrate: "vibrate" };
function openCamSettings() {
  for (const [id, k] of Object.entries(CS_SWITCHES)) $(id).checked = shootOn(k);
  $("csPalm").closest(".setting").hidden = !palmAvailable();
  $("csKeysRow").hidden = !NativeCam || nativeMissing.keys;
  $("csKeys").value = shootGet("keys");
  $("camQuick").hidden = true; $("camMore").setAttribute("aria-expanded", "false");
  $("camSettings").showModal();
  track("camera_settings");
}
$("camSettingsBtn").addEventListener("click", openCamSettings);
for (const [id, k] of Object.entries(CS_SWITCHES)) {
  $(id).addEventListener("change", (e) => {
    store.set(SHOOT[k][0], e.target.checked ? "on" : "off"); Platform.haptic();
    track("setting", { [`cam_${k}`]: e.target.checked });
    if (k === "palm") palmApply();
    if (k === "float") floatApply();
    if (k === "sound" && e.target.checked) { audioCtx(); shutterSound(); }
  });
}
$("csKeys").addEventListener("change", (e) => { store.set(SHOOT.keys[0], e.target.value); keysApply(); track("setting", { cam_keys: e.target.value }); });
$("csAll").addEventListener("click", () => { $("camSettings").close(); openSettings(); });

// The Palm chip in the camera's quick settings (the arrow in the top bar), and More settings.
function renderShootQuick() {
  const b = $("camQuick").querySelector('[data-q="palm"]');
  b.hidden = !palmAvailable(); b.setAttribute("aria-pressed", String(palmWanted()));
}
$("camQuick").addEventListener("click", (e) => {
  const b = e.target.closest("[data-q]"); if (!b) return;
  if (b.dataset.q === "more") { openCamSettings(); return; }
  if (b.dataset.q !== "palm") return;
  const on = !shootOn("palm");
  store.set(SHOOT.palm[0], on ? "on" : "off"); Platform.haptic(); palmApply();
  say(on ? "Show palm on: hold up your open hand to take a photo" : "Show palm off");
  track("setting", { cam_palm: on });
});

// ---------- Camera start and stop (app.js) ----------

function shootStart() {
  palm.since = 0; palm.cool = performance.now() + 1200;   // a hand already up as the camera opens waits a moment
  palmApply(); keysApply(); floatApply(); palmHint();
}
function shootStop() {
  clearInterval(palm.tick); palm.tick = 0; palm.since = 0; palm.busy = false;
  showPalmBox(null); $("camPalmHint").hidden = true; $("camFloat").hidden = true;
}
renderShootQuick();
if (cam.state === "live") shootStart();
