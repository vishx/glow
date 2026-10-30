const $ = (id) => document.getElementById(id);

// Backend and store settings. The publishable key is safe to ship in the app.
const CONFIG = {
  supabaseUrl: "https://vahtdouihsnpnaskrtka.supabase.co",
  supabaseKey: "sb_publishable_UH4edWInYXUknGg_Piqkeg_8fvxPL0b",
  // From RevenueCat > Project settings > API keys (public app-specific keys).
  revenuecatIos: "REVENUECAT_IOS_PUBLIC_KEY",
  revenuecatAndroid: "REVENUECAT_ANDROID_PUBLIC_KEY",
  // From AdMob > Apps > Ad units (rewarded). These are Google's test units until real ones are added.
  admobRewardIos: "ca-app-pub-3940256099942544/1712485313",
  admobRewardAndroid: "ca-app-pub-3940256099942544/5224354917",
};
const native = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
const plugins = (window.Capacitor && window.Capacitor.Plugins) || {};
const store = {
  get(k) { try { return localStorage.getItem(k) || ""; } catch { return ""; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
};

const AI_LABELS = { mylook: "Apply My Look", pro: "Enhance", enhance: "Restore", faces: "Fix faces", retouch: "Retouch", smile: "Add a smile",
  relight: "Relight", golden: "Golden hour", upscale: "Upscale 4×", colorize: "Colorize" };
const STYLE_LABELS = { outfit: "Try on an outfit", gown: "Evening gown", suit: "Business suit", sundress: "Summer dress", street: "Streetwear",
  headshot: "Headshot", fashion: "Fashion shoot", anime: "Anime", watercolor: "Watercolor",
  toon3d: "3D Toon", clay: "Clay", older: "Make older", younger: "Make younger" };
const HAIR_LABELS = { hcolor: "Color hair", hair_waves: "Long waves", hair_bob: "Sleek bob", hair_pixie: "Pixie cut", hair_bangs: "Curtain bangs",
  hair_curls: "Curls", hair_bun: "High bun", hair_braids: "Braids", hair_butterfly: "Butterfly cut" };
const BODY_LABELS = { bwaist: "Slim waist", bhips: "Slim hips", barms: "Slim arms", bslimlegs: "Slim legs", blegs: "Longer legs" };
const EDIT_LABELS = { erase: "Erase marked area", expand: "Expand photo" };
const FACE_LABELS = { fauto: "Auto beauty", fsmooth: "Smooth skin", fblemish: "Remove blemishes", fundereye: "Brighten under-eyes",
  fteeth: "Whiten teeth", feyes: "Brighten eyes", fbigeyes: "Bigger eyes", fslim: "Slim face", fnose: "Slim nose", flips: "Add lip color", fblush: "Add blush",
  fbrows: "Fill brows", fshadow: "Add eyeshadow", fliner: "Add eyeliner", fglam: "Full glam" };
const ALL_LABELS = { ...AI_LABELS, ...STYLE_LABELS, ...EDIT_LABELS, ...FACE_LABELS, ...HAIR_LABELS, ...BODY_LABELS };
// Tools that run on the phone with a strength slider (free, no AI edit used).
const onPhone = () => tab === "face" || tab === "body" || tool === "hcolor";
// Tools that use an AI credit: everything that goes to the AI server.
const usesCredit = () => !onPhone() && !["bg", "filters"].includes(tab) && tool !== "mylook";
// The portrait styles run on a costlier model, so they use 2 credits.
const TWO_CREDITS = ["headshot", "anime", "watercolor", "fashion"];
const creditCost = () => (TWO_CREDITS.includes(tool) ? 2 : 1);
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

let tab = "ai", tool = "pro";
let lastShot = null;    // { original, stamp } from the live camera, saved alongside the result on the web
let origData = null;    // photo as picked (data URL)
let current = null;     // latest edit (data URL or Replicate URL); null = no edits yet
let filterBase = null;  // image filters are applied on top of, so filters don't stack
let cutoutCache = {};   // source -> transparent cut-out URL
let outfitData = null;  // the outfit photo picked for try-on

function say(text, isErr) { $("msg").textContent = text || ""; $("msg").classList.toggle("err", !!isErr); }
function busy(on, text) { $("busy").classList.toggle("on", on); if (text) $("busyText").textContent = text; $("goBtn").disabled = on || !origData; if (!on) showCost(); }

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

function canvasFor(img, maxSide = 2048) {
  const s = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement("canvas");
  c.width = Math.round(img.naturalWidth * s); c.height = Math.round(img.naturalHeight * s);
  return c;
}

// Shrink big phone photos so uploads are fast and fit the model's limits.
async function loadAndShrink(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImg(url);
    const c = canvasFor(img, 1280);
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.9);
  } catch { throw new Error("Couldn't read that photo."); }
  finally { URL.revokeObjectURL(url); }
}

function source() { return current || origData; }

async function show(newCurrent, note) {
  current = newCurrent;
  const st = $("stage");
  $("resetBtn").hidden = !current;
  $("saveBtn").hidden = !current;
  if (!current) {
    $("after").hidden = true; st.classList.remove("compare", "checker"); return;
  }
  await new Promise((resolve, reject) => {
    $("after").onload = resolve; $("after").onerror = () => reject(new Error("Couldn't load the result."));
    $("after").src = current;
  });
  $("after").hidden = false; st.classList.add("compare");
  st.classList.toggle("checker", tool === "bgremove" && tab === "bg");
  sweep();
  if (note) say(note);
}

function showOriginal(data) {
  lastShot = null;
  origData = data; current = null; filterBase = null; cutoutCache = {}; faceLast = null;
  $("placeholder").hidden = true;
  $("before").src = data; $("before").hidden = false;
  $("stage").classList.add("has-img"); setEmpty(false);
  show(null); busy(false); say(""); renderFilterSwatches(); setButton();
}

// Slide the line across once so it's clear the photo can be compared.
function sweep() {
  const st = $("stage");
  st.classList.add("sweep"); setSplit(95);
  setTimeout(() => setSplit(5), 650);
  setTimeout(() => setSplit(50), 1300);
  setTimeout(() => st.classList.remove("sweep"), 1950);
}

function setSplit(pct) {
  pct = Math.max(0, Math.min(100, pct));
  $("after").style.clipPath = `inset(0 0 0 ${pct}%)`;
  $("divider").style.left = pct + "%";
}

let dragging = false;
function dragTo(e) {
  const r = $("stage").getBoundingClientRect();
  setSplit(((e.clientX - r.left) / r.width) * 100);
}
$("stage").addEventListener("pointerdown", (e) => {
  if (!$("stage").classList.contains("compare") || $("stage").classList.contains("brushing")) return;
  dragging = true; $("stage").classList.remove("sweep");
  $("stage").setPointerCapture(e.pointerId); dragTo(e);
});
$("stage").addEventListener("pointermove", (e) => { if (dragging) dragTo(e); });
["pointerup", "pointercancel"].forEach((ev) => $("stage").addEventListener(ev, () => { dragging = false; }));

$("stage").addEventListener("click", () => { if (!origData) $("file").click(); });
$("pickBtn").addEventListener("click", (e) => { e.stopPropagation(); $("file").click(); });
$("cameraBtn").addEventListener("click", (e) => { e.stopPropagation(); openCamera(); });
async function onPicked(e) {
  const f = e.target.files[0]; e.target.value = "";
  if (!f) return;
  try { showOriginal(await loadAndShrink(f)); }
  catch (err) { say(err.message, true); }
}
$("file").addEventListener("change", onPicked);
$("camera").addEventListener("change", onPicked);
$("resetBtn").addEventListener("click", () => { filterBase = null; show(null); say("Back to the original."); });

// Tabs and tools
function setButton() {
  if (tab === "bg") $("goBtn").textContent = BG_LABELS[tool] || "Pick a background";
  else $("goBtn").textContent = ALL_LABELS[tool] || "Enhance";
  $("goBtn").hidden = tab === "filters";
  setBrushing(tab === "edit" && tool === "erase" && !!origData);
  if (tab === "edit" && origData) say(tool === "erase" ? "Paint over what you want gone, then tap Erase." : "Adds more scene around the edges of your photo.");
  if (tab === "styles" && origData) say("Works best on a clear, front-facing selfie.");
  if (tool === "mylook" && origData) say(`Gives this photo your camera look (${lookName()}).`);
  if (tab === "body" && origData) say("Works best on a photo that shows your whole body.");
  if (tab === "hair" && tool !== "hcolor" && origData) say("Works best on a clear, front-facing photo.");
  if (["face", "bg", "filters"].includes(tab) || tool === "hcolor") say("");
  if (tool === "outfit" && origData) say("Tap the button, then pick a photo or screenshot of the outfit you want to try on.");
  renderFaceOpts(); showCost();
}
// The tool panel shows the chosen tool, what it costs, and one Apply button.
function showCost() {
  $("toolName").textContent = tab === "bg" ? BG_LABELS[tool] || "Backdrop" : ALL_LABELS[tool] || "Enhance";
  $("panel").hidden = tab === "filters";
  const el = $("cost");
  if (!usesCredit()) {
    el.textContent = "Free · on-device"; el.classList.add("free"); $("goBtn").textContent = "Apply"; return;
  }
  const n = creditCost(), c = `${n} credit${n > 1 ? "s" : ""}`;
  el.textContent = `AI · ${c}`; el.classList.remove("free");
  $("goBtn").textContent = `Apply · ${c}`;
}
// Line icons on every tool and button; tools that use AI credits get a small "AI" badge.
document.querySelectorAll(".tool[data-tool]").forEach((b) => {
  b.querySelector(".ic").innerHTML = icon(b.dataset.tool);
  if (b.closest("#tools-ai, #tools-hair, #tools-styles, #tools-edit") && !["mylook", "hcolor", "clearmask"].includes(b.dataset.tool)) b.classList.add("ai");
  if (TWO_CREDITS.includes(b.dataset.tool)) b.classList.add("ai2");
});
[["settingsBtn", "settings"], ["backBtn", "back"], ["resetBtn", "undo"], ["camClose", "close"], ["camGallery", "gallery"], ["camFlip", "flip"]]
  .forEach(([id, name]) => { $(id).innerHTML = icon(name); });
$("camBeauty").innerHTML = icon("sliders") + "Adjust";
document.querySelector("[data-icon]").innerHTML = icon("imageplus");
function setEmpty(on) {
  document.body.classList.toggle("empty", on);
  $("backBtn").hidden = on; $("settingsBtn").hidden = !on;
}
$("backBtn").addEventListener("click", () => {
  origData = null; current = null; filterBase = null; faceLast = null; lastShot = null;
  $("before").hidden = $("after").hidden = $("resetBtn").hidden = $("saveBtn").hidden = true;
  $("stage").classList.remove("compare", "checker", "has-img");
  setBrushing(false); $("placeholder").hidden = false; setEmpty(true); say("");
});
$("tabs").addEventListener("click", (e) => {
  const b = e.target.closest(".tab"); if (!b) return;
  tab = b.dataset.tab;
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("on", t === b));
  ["ai", "face", "hair", "body", "styles", "bg", "edit", "filters"].forEach((t) => { $("tools-" + t).hidden = t !== tab; });
  let on = document.querySelector(`#tools-${tab} .tool.on`);
  if (!on && tab !== "filters") { on = document.querySelector(`#tools-${tab} .tool`); on.classList.add("on"); }
  if (on) tool = on.dataset.tool;
  if (tab === "filters") { filterBase = source(); renderFilterSwatches(); say(origData ? "Tap a filter. Filters are free." : ""); }
  if (tab === "bg" && origData) say("Background tools run on your phone and are free.");
  rememberTool(); setButton();
});
["ai", "face", "hair", "body", "styles", "bg", "edit"].forEach((t) => $("tools-" + t).addEventListener("click", (e) => {
  const b = e.target.closest(".tool"); if (!b) return;
  if (b.dataset.tool === "clearmask") { strokes = []; drawStrokes(); return; }
  $("tools-" + t).querySelectorAll(".tool").forEach((m) => m.classList.toggle("on", m === b));
  tool = b.dataset.tool; rememberTool(); setButton();
}));
function rememberTool() { if (tab !== "filters") store.set("glowTool", JSON.stringify({ tab, tool })); }

function renderFilterSwatches() {
  const box = $("tools-filters");
  box.innerHTML = "";
  FILTERS.forEach((flt) => {
    const b = document.createElement("button");
    b.className = "tool"; b.dataset.filter = flt.id;
    const sw = document.createElement("i"); sw.className = "sw";
    if (origData) { sw.style.backgroundImage = `url(${origData})`; sw.style.filter = flt.f; }
    b.append(sw, flt.name);
    box.append(b);
  });
}
$("tools-filters").addEventListener("click", async (e) => {
  const b = e.target.closest(".tool"); if (!b || !origData) return;
  $("tools-filters").querySelectorAll(".tool").forEach((m) => m.classList.toggle("on", m === b));
  const flt = FILTERS.find((f) => f.id === b.dataset.filter);
  try {
    if (!filterBase) filterBase = source();
    if (flt.id === "none") { await show(filterBase === origData ? null : filterBase, "No filter."); return; }
    const img = await loadImg(filterBase);
    const c = canvasFor(img), ctx = c.getContext("2d");
    ctx.filter = flt.f; ctx.drawImage(img, 0, 0, c.width, c.height); ctx.filter = "none";
    if (flt.wash) { ctx.globalCompositeOperation = "soft-light"; ctx.fillStyle = flt.wash; ctx.fillRect(0, 0, c.width, c.height); ctx.globalCompositeOperation = "source-over"; }
    const alpha = /\.png($|\?)|^data:image\/png/.test(filterBase);
    await show(alpha ? c.toDataURL("image/png") : c.toDataURL("image/jpeg", 0.92), `${flt.name} filter applied. Drag the line to compare.`);
  } catch (err) { say(err.message, true); }
});

// Magic-erase brush: strokes are kept in image pixel coordinates.
let strokes = [], painting = false;
function imageRect() {
  const img = current ? $("after") : $("before"), st = $("stage").getBoundingClientRect();
  const s = Math.min(st.width / img.naturalWidth, st.height / img.naturalHeight);
  const w = img.naturalWidth * s, h = img.naturalHeight * s;
  return { x: (st.width - w) / 2, y: (st.height - h) / 2, s, nw: img.naturalWidth, nh: img.naturalHeight };
}
function setBrushing(on) {
  $("stage").classList.toggle("brushing", on);
  if (on) { if (current) setSplit(0); strokes = []; drawStrokes(); }
}
function drawStrokes() {
  const cv = $("brush"), st = $("stage").getBoundingClientRect(), dpr = devicePixelRatio || 1;
  cv.width = st.width * dpr; cv.height = st.height * dpr;
  if (!origData) return;
  const ctx = cv.getContext("2d"), r = imageRect();
  ctx.scale(dpr, dpr);
  ctx.strokeStyle = "rgba(255,80,120,0.55)"; ctx.lineCap = ctx.lineJoin = "round";
  for (const st of strokes) {
    ctx.lineWidth = st.w * r.s; ctx.beginPath();
    st.pts.forEach(([x, y], i) => (i ? ctx.lineTo : ctx.moveTo).call(ctx, r.x + x * r.s, r.y + y * r.s));
    if (st.pts.length === 1) ctx.lineTo(r.x + st.pts[0][0] * r.s + 0.1, r.y + st.pts[0][1] * r.s);
    ctx.stroke();
  }
}
function brushPoint(e) {
  const st = $("stage").getBoundingClientRect(), r = imageRect();
  return [(e.clientX - st.left - r.x) / r.s, (e.clientY - st.top - r.y) / r.s];
}
$("brush").addEventListener("pointerdown", (e) => {
  e.stopPropagation(); painting = true; $("brush").setPointerCapture(e.pointerId);
  const r = imageRect();
  strokes.push({ w: 28 / r.s, pts: [brushPoint(e)] }); drawStrokes();
});
$("brush").addEventListener("pointermove", (e) => { if (!painting) return; strokes[strokes.length - 1].pts.push(brushPoint(e)); drawStrokes(); });
["pointerup", "pointercancel"].forEach((ev) => $("brush").addEventListener(ev, () => { painting = false; }));

function eraseMask() {
  const r = imageRect(), c = document.createElement("canvas");
  c.width = r.nw; c.height = r.nh;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#000"; ctx.fillRect(0, 0, c.width, c.height);
  ctx.strokeStyle = "#fff"; ctx.lineCap = ctx.lineJoin = "round";
  for (const st of strokes) {
    ctx.lineWidth = st.w * 1.15; ctx.beginPath();
    st.pts.forEach(([x, y], i) => (i ? ctx.lineTo : ctx.moveTo).call(ctx, x, y));
    if (st.pts.length === 1) ctx.lineTo(st.pts[0][0] + 0.1, st.pts[0][1]);
    ctx.stroke();
  }
  return c.toDataURL("image/png");
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

// Sign-in: every install gets a private anonymous account, so there's no sign-up screen.
let session = null;
try { session = JSON.parse(store.get("glowSession") || "null"); } catch {}
async function authCall(path, body) {
  let res;
  try {
    res = await fetch(`${CONFIG.supabaseUrl}/auth/v1/${path}`, {
      method: "POST", headers: { apikey: CONFIG.supabaseKey, "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
  } catch { const e = new Error("Couldn't connect to Glow. Check your internet and try again."); e.offline = true; throw e; }
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    const e = new Error("Couldn't connect to Glow. Check your internet and try again.");
    e.offline = res.status >= 500 || res.status === 429; throw e;
  }
  session = { access_token: data.access_token, refresh_token: data.refresh_token, expires_at: data.expires_at, user_id: data.user && data.user.id };
  store.set("glowSession", JSON.stringify(session));
  return session;
}
// One sign-in at a time, so parallel calls can't create two accounts.
let sessionPromise = null;
function ensureSession(force) {
  if (session && !force && session.expires_at * 1000 > Date.now() + 60000) return Promise.resolve(session);
  if (!sessionPromise) sessionPromise = (async () => {
    if (session && session.refresh_token) {
      try { return await authCall("token?grant_type=refresh_token", { refresh_token: session.refresh_token }); }
      // Offline: keep this account (and any Pro plan) rather than starting a new one.
      catch (e) { if (e.offline) throw e; }
    }
    return authCall("signup", { data: {} });
  })().finally(() => { sessionPromise = null; });
  return sessionPromise;
}

// Server calls
async function call(path, opts = {}, retried) {
  const s = await ensureSession();
  const res = await fetch(`${CONFIG.supabaseUrl}/functions/v1/${path}`, {
    ...opts,
    headers: { "Content-Type": "application/json", apikey: CONFIG.supabaseKey, Authorization: `Bearer ${s.access_token}` },
  });
  if (res.status === 401 && !retried) { await ensureSession(true); return call(path, opts, true); }
  const body = await res.json().catch(() => ({}));
  if (body.usage) showUsage(body.usage);
  if (!res.ok) {
    const e = new Error(body.error || "Something went wrong."); e.status = res.status; e.limit = body.limit; throw e;
  }
  return body;
}

let account = null;
function showUsage(u) {
  account = { ...(account || {}), ...u };
  const b = $("usageBtn");
  b.hidden = false;
  b.classList.toggle("pro", u.plan === "pro");
  const n = u.remaining, credits = `${n} AI credit${n === 1 ? "" : "s"} left`;
  b.innerHTML = icon("sparkle") + (u.plan === "pro" ? `${credits} this week` : `${credits} today`);
  $("planLine").textContent = u.plan === "pro"
    ? `Glow Pro: ${u.remaining} of ${u.quota} AI credits left this week.`
    : `Free plan: ${u.remaining} of ${u.quota} AI credits left today. Face, body, filters and backgrounds are always free.`;
  $("goProBtn").hidden = u.plan === "pro";
  showCost();
}
async function refreshAccount() {
  try { showUsage(await call("account", { method: "GET" })); } catch {}
}
// Replicate URLs can be passed straight through; big client-made images get shrunk first.
async function uploadable(src) {
  if (!src.startsWith("data:") || src.length < 1_500_000) return src;
  const img = await loadImg(src), c = canvasFor(img, 1600);
  c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.9);
}
async function runModel(mode, src, label, mask, extra) {
  let job = await call("enhance", { method: "POST", body: JSON.stringify({ image: await uploadable(src), mode, mask, extra }) });
  const started = Date.now();
  while (!["succeeded", "failed", "canceled"].includes(job.status)) {
    await new Promise((r) => setTimeout(r, 1500));
    if (Date.now() - started > 180000) throw new Error("This is taking too long. Try again in a minute.");
    $("busyText").textContent = job.status === "starting" ? "Warming up the model…" : label + "…";
    job = await call("enhance?id=" + job.id, { method: "GET" });
  }
  if (job.status !== "succeeded" || !job.output) throw new Error(job.error || "The model couldn't process this photo.");
  return keepLocal(job.output);
}
// AI results come back as links that expire after about an hour. Keep a copy in
// the app so Save and the next tool still work later.
async function keepLocal(url) {
  try {
    const blob = await (await fetch(url)).blob();
    return await new Promise((ok, fail) => { const fr = new FileReader(); fr.onload = () => ok(fr.result); fr.onerror = fail; fr.readAsDataURL(blob); });
  } catch { return url; }
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
  const result = seg.segment(img);
  const m = result.confidenceMasks[0], conf = m.getAsFloat32Array();
  // Turn the subject confidence into a soft alpha mask.
  const mc = document.createElement("canvas"); mc.width = m.width; mc.height = m.height;
  const mctx = mc.getContext("2d"), px = mctx.createImageData(m.width, m.height);
  for (let i = 0; i < conf.length; i++) px.data[i * 4 + 3] = Math.max(0, Math.min(255, ((conf[i] - 0.35) / 0.3) * 255));
  mctx.putImageData(px, 0, 0);
  if (result.close) result.close();
  const c = canvasFor(img), ctx = c.getContext("2d");
  ctx.drawImage(img, 0, 0, c.width, c.height);
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
let faceLast = null; // { tool, base, result }: changing the strength redoes the last face tool

function renderFaceOpts() {
  $("faceOpts").hidden = !onPhone();
  if (!onPhone()) return;
  $("faceAmt").value = $("faceAmtVal").textContent = faceSet.amt[tool] ?? 50;
  const shades = SHADES[tool] || [];
  $("shades").replaceChildren(...shades.map((c) => {
    const b = document.createElement("button");
    b.className = "shade" + (faceSet.shade[tool] === c ? " on" : ""); b.style.background = c; b.setAttribute("aria-label", "Color " + c);
    b.addEventListener("click", () => { faceSet.shade[tool] = c; saveFace(); renderFaceOpts(); redoFace(); });
    return b;
  }));
}
function saveFace() { store.set("glowFace", JSON.stringify(faceSet)); }
function redoFace() { if (faceLast && faceLast.tool === tool && current === faceLast.result && !$("busy").classList.contains("on")) $("goBtn").click(); }
$("faceAmt").addEventListener("input", (e) => { $("faceAmtVal").textContent = e.target.value; });
$("faceAmt").addEventListener("change", (e) => { faceSet.amt[tool] = +e.target.value; saveFace(); redoFace(); });

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
  const faces = finder.detect(c).faceLandmarks || [];
  if (!faces.length) throw new Error("Couldn't find a face. Try a clear, front-facing photo.");
  for (const f of faces) faceOps(ctx, f.map((p) => [p.x * c.width, p.y * c.height]), amt, toolId);
  return /^data:image\/png/.test(src) ? c.toDataURL("image/png") : c.toDataURL("image/jpeg", 0.92);
}

// Edge-preserving skin smoothing for still photos, using the camera's beauty shader.
function glSmooth(srcCanvas, spread) {
  const c = newCanvas(srcCanvas.width, srcCanvas.height), g = initGl(c);
  if (!g) return filtered(srcCanvas, `blur(${Math.round(spread * 3)}px)`);
  g.gl.viewport(0, 0, c.width, c.height);
  g.gl.texImage2D(g.gl.TEXTURE_2D, 0, g.gl.RGB, g.gl.RGB, g.gl.UNSIGNED_BYTE, srcCanvas);
  drawBeauty(g, c.width / spread, c.height / spread, false, { smooth: 100, bright: 0, warm: 0 });
  const out = newCanvas(c.width, c.height); out.getContext("2d").drawImage(c, 0, 0);
  const lose = g.gl.getExtension("WEBGL_lose_context"); if (lose) lose.loseContext();
  return out;
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
  const res = seg.segment(c), masks = res.confidenceMasks || [];
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

$("goBtn").addEventListener("click", async () => {
  if (!origData) return;
  let src = source();
  const label = tab === "bg" ? BG_LABELS[tool] : ALL_LABELS[tool];
  // Redoing the same on-phone tool (new strength or color) replaces it instead of stacking.
  if (onPhone() && faceLast && faceLast.tool === tool && current === faceLast.result) src = faceLast.base;
  if (tool === "outfit" && !(outfitData = await pickOutfit())) return;
  if (tool === "erase" && !strokes.length) { say("Paint over the thing you want to remove first.", true); return; }
  busy(true, label + "…"); say("");
  try {
    let out;
    if (tool === "erase") {
      out = await runModel("erase", src, label, eraseMask());
      strokes = [];
    } else if (tool === "expand") {
      const x = await expandInputs(src);
      out = await runModel("expand", x.image, label, x.mask);
    } else if (tool === "mylook") {
      out = await applyLook(src);
    } else if (onPhone()) {
      const amt = (faceSet.amt[tool] ?? 50) / 100;
      out = tab === "face" ? await faceEdit(src, tool, amt) : tab === "body" ? await bodyEdit(src, tool, amt) : await hairColor(src, amt, faceSet.shade.hcolor);
      faceLast = { tool, base: src, result: out };
    } else if (tool === "outfit") {
      out = await runModel("outfit", src, label, undefined, outfitData);
    } else if (tab !== "bg") {
      out = await runModel(tool, src, label);
    } else {
      const cut = await cutout(src);
      if (tool === "bgremove") out = cut;
      else if (tool === "bgblur") {
        out = await composite(src, cut, (ctx, w, h, base) => {
          ctx.filter = `blur(${Math.round(Math.max(w, h) / 90)}px)`;
          ctx.drawImage(base, -20, -20, w + 40, h + 40); ctx.filter = "none";
        });
      } else out = await composite(src, cut, BG_FILLS[tool]);
    }
    filterBase = null;
    await show(out);
    if (tool === "erase") { setSplit(50); drawStrokes(); $("stage").classList.remove("brushing"); setTimeout(() => setBrushing(tab === "edit" && tool === "erase"), 2000); }
    say(onPhone()
      ? `✓ ${label} done. Drag the line to compare, or change the strength to redo it.`
      : `✓ ${label} done. Drag the line to compare.`);
  } catch (err) {
    say(err.message, true);
    if (err.limit && (!account || account.plan !== "pro")) openPaywall();
  } finally { busy(false); }
});

// Outfit try-on: the user picks a photo or screenshot of the clothes.
function pickOutfit() {
  return new Promise((done) => {
    const input = $("outfitFile");
    const onFocus = () => setTimeout(() => { if (!input.files.length) finish(null); }, 800);
    const finish = async (f) => {
      window.removeEventListener("focus", onFocus); input.onchange = null;
      if (!f) return done(null);
      try { done(await loadAndShrink(f)); } catch (err) { say(err.message, true); done(null); } finally { input.value = ""; }
    };
    input.onchange = () => finish(input.files[0]);
    window.addEventListener("focus", onFocus);
    input.click();
  });
}

$("saveBtn").addEventListener("click", async () => {
  if (!current) return;
  try {
    const blob = await (await fetch(current)).blob();
    const ext = (blob.type.split("/")[1] || "png").replace("jpeg", "jpg");
    const file = new File([blob], `glow-${Date.now()}.${ext}`, { type: blob.type });
    const files = [file];
    if (lastShot) files.unshift(new File([await (await fetch(lastShot.original)).blob()], `glow-${lastShot.stamp}-original.jpg`, { type: "image/jpeg" }));
    if (native && plugins.Media) {
      const data = current.startsWith("data:") ? current : await keepLocal(current);
      await saveToPhotos(data, `glow-${Date.now()}`);
      say("✓ Saved to your Glow album.");
      return;
    }
    if (native && plugins.Filesystem && plugins.Share) {
      const data = await new Promise((ok) => { const fr = new FileReader(); fr.onload = () => ok(fr.result.split(",")[1]); fr.readAsDataURL(blob); });
      const saved = await plugins.Filesystem.writeFile({ path: file.name, data, directory: "CACHE" });
      await plugins.Share.share({ title: "Glow", files: [saved.uri] });
      return;
    }
    if (navigator.canShare && navigator.canShare({ files })) {
      await navigator.share({ files, title: "Glow" });
    } else {
      for (const f of files) { const a = document.createElement("a"); a.href = URL.createObjectURL(f); a.download = f.name; a.click(); }
    }
  } catch (err) {
    if (native && plugins.Media) say("Couldn't save. Allow photo access for Glow in your phone's settings.", true);
    else if (err.name !== "AbortError" && !current.startsWith("data:")) window.open(current, "_blank");
  }
});

$("settingsBtn").addEventListener("click", () => { refreshAccount(); $("settings").showModal(); });
$("usageBtn").addEventListener("click", () => (account && account.plan === "pro" ? $("settings").showModal() : openPaywall()));
$("closeSettings").addEventListener("click", () => $("settings").close());
$("goProBtn").addEventListener("click", () => { $("settings").close(); openPaywall(); });
$("deleteAccount").addEventListener("click", async (e) => {
  e.preventDefault();
  if (!confirm("Delete your Glow account and all its data? This can't be undone. Cancel any subscription in your store settings too.")) return;
  try {
    await call("account", { method: "DELETE" });
    session = null; store.set("glowSession", "");
    $("settings").close(); say("Your account and data were deleted.");
    refreshAccount();
  } catch (err) { say(err.message, true); }
});
$("manageSubs").addEventListener("click", (e) => {
  e.preventDefault();
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
  window.open(ios ? "https://apps.apple.com/account/subscriptions" : "https://play.google.com/store/account/subscriptions", "_blank");
});

// Subscriptions through RevenueCat (only inside the iPhone/Android app).
let plan = "yearly", rcReady = null;
const packages = {};
const purchases = () => plugins.Purchases;
function setupPurchases() {
  if (!native || !purchases()) return Promise.resolve(false);
  if (!rcReady) rcReady = (async () => {
    const s = await ensureSession();
    const ios = window.Capacitor.getPlatform() === "ios";
    const apiKey = ios ? CONFIG.revenuecatIos : CONFIG.revenuecatAndroid;
    if (apiKey.startsWith("REVENUECAT_")) return false; // store not set up yet
    await purchases().configure({ apiKey, appUserID: s.user_id });
    const offerings = await purchases().getOfferings();
    for (const p of (offerings.current && offerings.current.availablePackages) || []) {
      if (p.packageType === "WEEKLY") packages.weekly = p;
      if (p.packageType === "ANNUAL") packages.yearly = p;
    }
    if (packages.weekly) $("priceWeekly").textContent = `${packages.weekly.product.priceString}/week`;
    if (packages.yearly) $("priceYearly").textContent = `${packages.yearly.product.priceString}/year`;
    return true;
  })().catch((e) => { rcReady = null; console.warn(e); return false; });
  return rcReady;
}
function openPaywall() {
  $("pwNote").textContent = native
    ? "Subscription renews automatically at the price shown until you cancel. Cancel anytime in your App Store or Google Play settings, at least 24 hours before renewal. Payment is charged to your store account."
    : "Glow Pro is available in the Glow app for iPhone and Android.";
  $("buyBtn").disabled = !native;
  $("adBtn").hidden = !(native && plugins.AdMob && account && account.plan !== "pro" && account.remaining === 0 && account.adsLeft > 0);
  setupPurchases();
  $("paywall").showModal();
}
$("plans").addEventListener("click", (e) => {
  const b = e.target.closest(".plan"); if (!b) return;
  plan = b.dataset.plan;
  document.querySelectorAll(".plan").forEach((p) => p.classList.toggle("on", p === b));
  $("buyBtn").textContent = buyLabel();
});
const buyLabel = () => (plan === "yearly" ? "Get yearly Pro" : "Get weekly Pro");
// The store tells our server through RevenueCat; check a few times until Pro shows up.
async function afterPurchase() {
  for (let i = 0; i < 6; i++) {
    await refreshAccount();
    if (account && account.plan === "pro") return true;
    await new Promise((r) => setTimeout(r, 2000));
  }
  return false;
}
$("buyBtn").addEventListener("click", async () => {
  try {
    if (!(await setupPurchases()) || !packages[plan]) throw new Error("The store isn't available right now. Try again in a moment.");
    $("buyBtn").disabled = true; $("buyBtn").textContent = "Opening store…";
    await purchases().purchasePackage({ aPackage: packages[plan] });
    $("paywall").close();
    say((await afterPurchase()) ? "Welcome to Glow Pro! ✨" : "Purchase complete. Pro will switch on within a minute.");
  } catch (err) {
    if (!(err && err.userCancelled)) say((err && err.message) || "Purchase didn't go through.", true);
  } finally { $("buyBtn").disabled = !native; $("buyBtn").textContent = buyLabel(); }
});
async function restore() {
  try {
    if (!(await setupPurchases())) throw new Error("Restore works in the Glow app for iPhone and Android.");
    await purchases().restorePurchases();
    say((await afterPurchase()) ? "Glow Pro restored ✨" : "No active subscription found for this store account.");
    $("paywall").close(); $("settings").close();
  } catch (err) { say(err.message, true); }
}
$("restoreBtn").addEventListener("click", restore);
$("restoreBtn2").addEventListener("click", restore);
$("closePaywall").addEventListener("click", () => $("paywall").close());

// Optional rewarded ad: when free edits run out, the user can choose to watch one
// ad for one more edit (up to 3 a day). Google confirms the finished ad to our
// server, which adds the edit, so it can't be faked from the phone.
let adsReady = null;
function setupAds() {
  if (!native || !plugins.AdMob) return Promise.resolve(false);
  if (!adsReady) adsReady = (async () => {
    const ad = plugins.AdMob;
    await ad.initialize({});
    // Ask for ad consent where the law requires it (EU, UK).
    const info = await ad.requestConsentInfo().catch(() => null);
    if (info && info.status === "REQUIRED" && info.isConsentFormAvailable) await ad.showConsentForm().catch(() => {});
    return true;
  })().catch((e) => { adsReady = null; console.warn(e); return false; });
  return adsReady;
}
async function watchAdForEdit() {
  const ad = plugins.AdMob, s = await ensureSession();
  if (!(await setupAds())) throw new Error("Ads aren't available right now.");
  const ios = window.Capacitor.getPlatform() === "ios";
  await ad.prepareRewardVideoAd({ adId: ios ? CONFIG.admobRewardIos : CONFIG.admobRewardAndroid, npa: true, ssv: { userId: s.user_id, customData: "edit" } });
  let rewarded = false;
  const handles = [];
  const closed = new Promise((done) => {
    ad.addListener("onRewardedVideoAdReward", () => { rewarded = true; }).then((h) => handles.push(h));
    ad.addListener("onRewardedVideoAdDismissed", done).then((h) => handles.push(h));
    ad.addListener("onRewardedVideoAdFailedToShow", done).then((h) => handles.push(h));
  });
  ad.showRewardVideoAd().then(() => { rewarded = true; }).catch(() => {});
  await closed;
  handles.forEach((h) => h.remove());
  if (!rewarded) return false;
  // Google's confirmation reaches our server within a few seconds.
  const before = (account && account.quota) || 3;
  for (let i = 0; i < 8; i++) {
    await refreshAccount();
    if (account && account.quota > before) return true;
    await new Promise((r) => setTimeout(r, 1500));
  }
  return false;
}
$("adBtn").addEventListener("click", async () => {
  $("adBtn").disabled = true;
  try {
    const ok = await watchAdForEdit();
    $("paywall").close();
    if (ok) say("You earned 1 more AI credit ✨ Tap the button again to use it.");
    else say("The ad didn't finish, so no edit was added.", true);
  } catch (err) { say(err.message, true); }
  finally { $("adBtn").disabled = false; }
});

// Saving to the photo library: automatic in the phone app, share sheet on the web.
async function saveToPhotos(dataUrl, name) {
  const media = plugins.Media;
  if (!native || !media) return false;
  let album;
  if (window.Capacitor.getPlatform() === "android") {
    const find = async () => ((await media.getAlbums()).albums || []).find((a) => a.name === "Glow");
    album = await find();
    if (!album) { await media.createAlbum({ name: "Glow" }); album = await find(); }
  }
  await media.savePhoto({ path: dataUrl, albumIdentifier: album && album.identifier, fileName: name });
  return true;
}

// Looks: one-tap beauty settings. Whatever the user last chose is remembered, so
// every photo, in the camera or from the gallery, gets the same look.
const PRESET_LOOKS = [
  { id: "natural", name: "Natural", smooth: 35, bright: 20, warm: 15, filter: "none" },
  { id: "softglam", name: "Soft Glam", smooth: 60, bright: 35, warm: 30, filter: "glow" },
  { id: "glam", name: "Glam", smooth: 80, bright: 45, warm: 40, filter: "warm" },
  { id: "bare", name: "No beauty", smooth: 0, bright: 0, warm: 0, filter: "none" },
];
const beauty = { smooth: 35, bright: 20, warm: 15, filter: "none" };
try { Object.assign(beauty, JSON.parse(store.get("glowBeauty") || "{}")); } catch {}
let myLooks = [];
try { myLooks = JSON.parse(store.get("glowLooks") || "[]"); } catch {}
let lookId = store.get("glowLook") || "natural";
const allLooks = () => [...PRESET_LOOKS, ...myLooks];
const lookName = () => (allLooks().find((l) => l.id === lookId) || { name: "Custom" }).name;
function saveBeauty() {
  store.set("glowBeauty", JSON.stringify(beauty)); store.set("glowLook", lookId); store.set("glowLooks", JSON.stringify(myLooks));
}
function useLook(l) {
  lookId = l.id; Object.assign(beauty, { smooth: l.smooth, bright: l.bright, warm: l.warm, filter: l.filter });
  saveBeauty(); renderLooks();
}
function renderLooks() {
  $("sSmooth").value = beauty.smooth; $("sBright").value = beauty.bright; $("sWarm").value = beauty.warm;
  const flt = FILTERS.find((f) => f.id === beauty.filter) || FILTERS[0];
  $("camCanvas").style.filter = flt.f === "none" ? "" : flt.f;
  const chip = (text, on, extra, fn) => {
    const b = document.createElement("button"); b.className = "look" + (on ? " on" : "") + (extra || ""); b.textContent = text;
    b.addEventListener("click", fn); return b;
  };
  $("camLooks").replaceChildren(
    ...allLooks().map((l) => chip(l.name, l.id === lookId, "", () => {
      // Tapping your own look again offers to delete it.
      if (l.id === lookId && l.id.startsWith("my") && confirm(`Delete "${l.name}"?`)) {
        myLooks = myLooks.filter((m) => m.id !== l.id); useLook(PRESET_LOOKS[0]); return;
      }
      useLook(l);
    })),
    ...(lookId === "custom" ? [chip("Custom", true, "", () => {})] : []),
    chip("♡ Save look", false, " add", () => {
      const n = myLooks.length ? `My Look ${myLooks.length + 1}` : "My Look";
      const l = { id: "my" + Date.now(), name: n, smooth: beauty.smooth, bright: beauty.bright, warm: beauty.warm, filter: beauty.filter };
      myLooks = [...myLooks, l].slice(-4); useLook(l);
    }),
  );
  $("camFilters").replaceChildren(...FILTERS.map((f) => chip(f.name, f.id === beauty.filter, "", () => {
    beauty.filter = f.id; lookId = "custom"; saveBeauty(); renderLooks();
  })));
}
// Draws a canvas or image with one of the photo filters baked in.
function withFilter(srcEl, w, h, filterId) {
  const flt = FILTERS.find((f) => f.id === filterId) || FILTERS[0];
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  const ctx = c.getContext("2d");
  ctx.filter = flt.f; ctx.drawImage(srcEl, 0, 0, w, h); ctx.filter = "none";
  if (flt.wash) { ctx.globalCompositeOperation = "soft-light"; ctx.fillStyle = flt.wash; ctx.fillRect(0, 0, w, h); }
  return c.toDataURL("image/jpeg", 0.92);
}

// Live beauty camera: a WebGL filter smooths skin, brightens and warms the
// picture in real time. The shutter keeps the untouched original as well.
let autoFix = store.get("glowAutoFix") !== "off";
let camStream = null, facing = "user", camGl = null, camRaf = 0;

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

function drawBeauty(g, w, h, mirror, b = beauty) {
  const { gl } = g;
  gl.uniform2f(g.px, 1 / w, 1 / h);
  gl.uniform1f(g.smooth, b.smooth / 100);
  gl.uniform1f(g.bright, b.bright / 100);
  gl.uniform1f(g.warm, b.warm / 100);
  gl.uniform1f(g.mirror, mirror ? 1 : 0);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}

// "My Look" for gallery photos: the same beauty filter as the camera, run once on a still photo.
async function applyLook(src) {
  const img = await loadImg(src), c = canvasFor(img, 2048);
  const base = document.createElement("canvas"); base.width = c.width; base.height = c.height;
  base.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
  const g = initGl(c);
  if (!g) throw new Error("This phone can't run My Look.");
  g.gl.viewport(0, 0, c.width, c.height);
  g.gl.texImage2D(g.gl.TEXTURE_2D, 0, g.gl.RGB, g.gl.RGB, g.gl.UNSIGNED_BYTE, base);
  drawBeauty(g, c.width, c.height, false);
  const out = withFilter(c, c.width, c.height, beauty.filter);
  const lose = g.gl.getExtension("WEBGL_lose_context"); if (lose) lose.loseContext();
  return out;
}

function drawFrame() {
  const v = $("camVideo"), c = $("camCanvas");
  if (!camStream || !camGl) return;
  if (v.videoWidth) {
    const { gl } = camGl;
    if (c.width !== v.videoWidth) { c.width = v.videoWidth; c.height = v.videoHeight; gl.viewport(0, 0, c.width, c.height); }
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, v);
    drawBeauty(camGl, c.width, c.height, facing === "user");
  }
  camRaf = requestAnimationFrame(drawFrame);
}

async function startStream() {
  stopStream();
  camStream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: facing, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false,
  });
  const v = $("camVideo"); v.srcObject = camStream; await v.play();
  drawFrame();
}
function stopStream() {
  cancelAnimationFrame(camRaf);
  if (camStream) camStream.getTracks().forEach((t) => t.stop());
  camStream = null;
}

async function openCamera() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { $("camera").click(); return; }
  camGl = camGl || initGl($("camCanvas"));
  if (!camGl) { $("camera").click(); return; }
  renderLooks();
  $("camAuto").textContent = `Auto fix: ${autoFix ? "On" : "Off"}`; $("camAuto").classList.toggle("off", !autoFix);
  $("cam").hidden = false;
  try { await startStream(); }
  catch { $("cam").hidden = true; say("Camera access was blocked. Allow camera access for Glow in your phone's settings.", true); }
}
function closeCamera() { stopStream(); $("cam").hidden = true; }
// Turn the camera off while Glow is in the background, and back on when it returns.
document.addEventListener("visibilitychange", () => {
  if ($("cam").hidden) return;
  if (document.hidden) stopStream(); else startStream().catch(() => closeCamera());
});
// Android back button: close the camera or an open panel instead of leaving the app.
if (native && plugins.App) plugins.App.addListener("backButton", () => {
  const open = document.querySelector("dialog[open]");
  if (open) open.close();
  else if (!$("cam").hidden) closeCamera();
  else plugins.App.exitApp();
});

$("camClose").addEventListener("click", closeCamera);
$("camGallery").addEventListener("click", () => { closeCamera(); $("file").click(); });
$("camFlip").addEventListener("click", () => { facing = facing === "user" ? "environment" : "user"; startStream().catch(() => {}); });
$("camBeauty").addEventListener("click", () => { $("camSliders").hidden = !$("camSliders").hidden; });
$("camAuto").addEventListener("click", () => {
  autoFix = !autoFix; store.set("glowAutoFix", autoFix ? "on" : "off");
  $("camAuto").textContent = `Auto fix: ${autoFix ? "On" : "Off"}`; $("camAuto").classList.toggle("off", !autoFix);
});
[["sSmooth", "smooth"], ["sBright", "bright"], ["sWarm", "warm"]].forEach(([id, k]) => $(id).addEventListener("input", (e) => {
  beauty[k] = +e.target.value;
  if (lookId !== "custom") { lookId = "custom"; renderLooks(); }
  saveBeauty();
}));

$("shutter").addEventListener("click", async () => {
  const v = $("camVideo"); if (!v.videoWidth) return;
  const flash = document.createElement("div"); flash.className = "flash"; document.body.append(flash); setTimeout(() => flash.remove(), 400);
  // Original: the raw camera frame, mirrored like the preview for selfies.
  const o = document.createElement("canvas"); o.width = v.videoWidth; o.height = v.videoHeight;
  const octx = o.getContext("2d");
  if (facing === "user") { octx.translate(o.width, 0); octx.scale(-1, 1); }
  octx.drawImage(v, 0, 0);
  const original = o.toDataURL("image/jpeg", 0.92);
  const beautified = withFilter($("camCanvas"), o.width, o.height, beauty.filter);
  closeCamera();
  const stamp = Date.now();
  showOriginal(await shrinkData(original));
  if (!native) lastShot = { original, stamp };
  await show(beautified, "Beauty shot ready. Drag the line to compare with the original.");
  saveToPhotos(original, `glow-${stamp}-original`).catch(() => {});
  if (!autoFix) { saveToPhotos(beautified, `glow-${stamp}-beauty`).catch(() => {}); return; }
  busy(true, "Auto fix…");
  try {
    const fixed = await runModel("pro", await shrinkData(beautified), "Auto fix");
    filterBase = null;
    await show(fixed, native ? "✓ Auto fixed. Original and fixed photos are saved." : "✓ Auto fixed. Tap Save to keep the original and fixed photos.");
    saveToPhotos(await keepLocal(fixed), `glow-${stamp}-fixed`).catch(() => {});
  } catch (err) {
    // Out of AI edits or offline: keep the on-phone beauty version instead.
    saveToPhotos(beautified, `glow-${stamp}-beauty`).catch(() => {});
    say(err.limit ? "Saved your beauty shot. " + err.message : err.message, true);
    if (err.limit && (!account || account.plan !== "pro")) openPaywall();
  } finally { busy(false); }
});
async function shrinkData(dataUrl) {
  const img = await loadImg(dataUrl), c = canvasFor(img, 1280);
  c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.9);
}

ensureSession().then(refreshAccount).catch((e) => say(e.message, true));
setupPurchases();
setupAds();

// Open on the tool the user used last.
try {
  const last = JSON.parse(store.get("glowTool") || "null");
  if (last && document.querySelector(`#tools-${last.tab} [data-tool="${last.tool}"]`)) {
    document.querySelector(`.tab[data-tab="${last.tab}"]`).click();
    document.querySelector(`#tools-${last.tab} [data-tool="${last.tool}"]`).click();
  }
} catch {}
renderFilterSwatches(); setButton();
if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
