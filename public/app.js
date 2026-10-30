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

// ---------- Tools ----------
// kind: "ai" runs on the AI server and uses credits; every other kind runs on the device and is free.
// cat is the original category, used by the All tab.
const TOOLS = [];
const tool = (id, label, title, kind, cat, extra = {}) => TOOLS.push({ id, label, title, kind, cat, ...extra });
tool("mylook", "My Look", "My Look", "look", "fix", { hint: "Gives this photo one of your camera looks." });
tool("pro", "Enhance", "Enhance", "ai", "fix", { hint: "A photographer-style edit: color, light, skin and background." });
tool("enhance", "Restore", "Restore", "ai", "fix", { hint: "Sharpens and repairs old, blurry or low-quality photos." });
tool("faces", "Face repair", "Face repair", "ai", "fix", { hint: "Restores blurry or damaged faces." });
tool("retouch", "Retouch", "AI retouch", "ai", "fix", { hint: "Evens skin and tone while keeping texture." });
tool("smile", "Smile", "Add a smile", "ai", "fix", { hint: "Works best on a clear, front-facing photo." });
tool("relight", "Relight", "Relight", "ai", "fix", { hint: "Soft, flattering studio light." });
tool("golden", "Golden hour", "Golden hour", "ai", "fix", { hint: "Warm, low sunlight." });
tool("upscale", "Upscale 4×", "Upscale 4×", "ai", "fix", { hint: "Makes the photo 4 times larger with sharper detail." });
tool("colorize", "Colorize", "Colorize", "ai", "fix", { hint: "Adds natural color to black-and-white photos." });
const FACE_TOOLS = [["fauto", "Auto", "Auto beauty"], ["fsmooth", "Smooth", "Smooth skin"], ["fblemish", "Blemish", "Remove blemishes"],
  ["fundereye", "Under-eye", "Brighten under-eyes"], ["fteeth", "Teeth", "Whiten teeth"], ["feyes", "Eyes", "Brighten eyes"],
  ["fbigeyes", "Eye size", "Eye size", 1], ["fslim", "Face shape", "Face shape", 1], ["fnose", "Nose", "Nose shape", 1],
  ["flips", "Lips", "Lip color"], ["fblush", "Blush", "Cheek blush"], ["fbrows", "Brows", "Fill brows"], ["fshadow", "Eyeshadow", "Eyeshadow"],
  ["fliner", "Liner", "Eyeliner"], ["fglam", "Full glam", "Full glam"]];
FACE_TOOLS.forEach(([id, label, title, reshape]) => tool(id, label, title, "face", "face", { reshape: !!reshape }));
tool("hcolor", "Color", "Hair color", "hair", "hair");
[["hair_waves", "Waves", "Long waves"], ["hair_bob", "Bob", "Sleek bob"], ["hair_pixie", "Pixie", "Pixie cut"], ["hair_bangs", "Bangs", "Curtain bangs"],
  ["hair_curls", "Curls", "Curls"], ["hair_bun", "Bun", "High bun"], ["hair_braids", "Braids", "Braids"], ["hair_butterfly", "Butterfly", "Butterfly cut"]]
  .forEach(([id, label, title]) => tool(id, label, title, "ai", "hair", { hint: "Works best on a clear, front-facing photo." }));
[["bwaist", "Waist", "Waist"], ["bhips", "Hips", "Hips"], ["barms", "Arms", "Arms"], ["bslimlegs", "Slim legs", "Slim legs"], ["blegs", "Longer legs", "Longer legs"]]
  .forEach(([id, label, title]) => tool(id, label, title, "body", "body", { reshape: true, hint: "Works best on a photo that shows your whole body." }));
const SELFIE_HINT = "Works best on a clear, front-facing selfie.";
tool("outfit", "Try on", "Try on an outfit", "ai", "styles", { hint: "Pick a photo or screenshot of the outfit you want to try on." });
[["gown", "Gown", "Evening gown"], ["suit", "Suit", "Business suit"], ["sundress", "Sundress", "Summer dress"], ["street", "Street", "Streetwear"],
  ["headshot", "Headshot", "Headshot"], ["fashion", "Fashion", "Fashion shoot"], ["anime", "Anime", "Anime"], ["watercolor", "Watercolor", "Watercolor"],
  ["toon3d", "3D Toon", "3D Toon"], ["clay", "Clay", "Clay"], ["older", "Older", "Make older"], ["younger", "Younger", "Make younger"]]
  .forEach(([id, label, title]) => tool(id, label, title, "ai", "styles", { hint: SELFIE_HINT }));
[["bgblur", "Portrait blur", "Portrait blur"], ["bgremove", "Remove", "Remove background"], ["bgwhite", "White", "White background"],
  ["bgblush", "Blush", "Blush background"], ["bgsky", "Sky", "Sky background"]].forEach(([id, label, title]) => tool(id, label, title, "bg", "bg"));
tool("erase", "Magic erase", "Magic erase", "ai", "edit", { hint: "Paint over what you want removed, then tap Apply." });
tool("expand", "Expand", "Expand", "ai", "edit", { hint: "Adds more scene around the edges of your photo." });
tool("crop", "Crop", "Crop and rotate", "crop", "edit");
tool("light", "Light", "Light", "adjust", "edit");
tool("color", "Color", "Color", "adjust", "edit");
tool("warmth", "Warmth", "Warmth", "adjust", "edit");
tool("detail", "Detail", "Detail", "adjust", "edit");
FILTERS.filter((f) => f.id !== "none").forEach((f) => tool("filter:" + f.id, f.name, `${f.name} filter`, "filter", "filters", { filter: f }));
const TOOL = Object.fromEntries(TOOLS.map((t) => [t.id, t]));

// AI cost per tool. Must match ai_edit_cost() on the server, which is what actually charges.
const TWO_CREDITS = ["headshot", "anime", "watercolor", "fashion"];
const costOf = (t) => (t.kind !== "ai" ? 0 : TWO_CREDITS.includes(t.id) ? 2 : 1);
const credits = (n) => `${n} credit${n === 1 ? "" : "s"}`;

const ORIGINAL_CATS = [["fix", "Fix"], ["face", "Face"], ["hair", "Hair"], ["body", "Body"], ["styles", "Styles"], ["bg", "Backdrop"], ["edit", "Edit"], ["filters", "Filters"]];
const FILTER_IDS = TOOLS.filter((t) => t.kind === "filter").map((t) => t.id);
const CATS = {
  retouch: [["face", "Face", ["fauto", "feyes", "fundereye", "fteeth", "smile", "faces", "fbigeyes", "fslim", "fnose"]],
    ["skin", "Skin", ["fsmooth", "fblemish", "retouch"]],
    ["makeup", "Makeup", ["flips", "fblush", "fbrows", "fshadow", "fliner", "fglam"]],
    ["hair", "Hair", ["hcolor", "hair_waves", "hair_bob", "hair_pixie", "hair_bangs", "hair_curls", "hair_bun", "hair_braids", "hair_butterfly"]],
    ["body", "Body", ["bwaist", "bhips", "barms", "bslimlegs", "blegs"]]],
  looks: [["filters", "Filters", ["mylook", ...FILTER_IDS]],
    ["styles", "Styles", ["headshot", "fashion", "anime", "watercolor", "toon3d", "clay", "older", "younger"]],
    ["outfits", "Outfits", ["outfit", "gown", "suit", "sundress", "street"]]],
  edit: [["crop", "Crop", ["crop", "expand"]], ["light", "Light", ["light", "relight", "golden"]], ["color", "Color", ["color", "warmth", "colorize"]],
    ["detail", "Detail", ["pro", "detail", "enhance", "upscale"]], ["bg", "Background", ["bgblur", "bgremove", "bgwhite", "bgblush", "bgsky", "erase"]]],
};
// Fixed starting points, not image analysis. Reshaping is never suggested.
const SUGGESTED = ["pro", "fauto", "relight", "bgblur"];
const CROPS = [["Free", "free"], ["Original", 0], ["Square", 1], ["4:5", 4 / 5], ["3:4", 3 / 4], ["9:16", 9 / 16], ["16:9", 16 / 9]];

// ---------- Small UI helpers ----------
let toastTimer = 0;
function say(text, isErr) {
  const t = $("toast");
  clearTimeout(toastTimer);
  if (!text) { t.classList.remove("on"); return; }
  t.textContent = text; t.classList.toggle("err", !!isErr); t.classList.add("on");
  if (isErr) $("alertLive").textContent = text;
  toastTimer = setTimeout(() => t.classList.remove("on"), isErr ? 7000 : 3800);
}
// A small in-app dialog. Resolves with the chosen action's value, or null.
function ask({ title, text, actions }) {
  return new Promise((done) => {
    const d = $("ask");
    $("askTitle").textContent = title; $("askText").textContent = text || ""; $("askText").hidden = !text;
    $("askActions").replaceChildren(...actions.map((a) => {
      const b = document.createElement("button"); b.className = "btn" + (a.kind ? " " + a.kind : ""); b.textContent = a.label;
      b.addEventListener("click", () => { d.returnValue = a.value || ""; d.close(); }); return b;
    }));
    d.returnValue = "";
    d.onclose = () => done(d.returnValue || null);
    d.showModal();
  });
}
const setIcon = (el, name) => { el.innerHTML = icon(name); };
document.querySelectorAll("[data-icon]").forEach((el) => setIcon(el, el.dataset.icon));
document.querySelectorAll("[data-icon-li]").forEach((li) => li.insertAdjacentHTML("afterbegin", icon(li.dataset.iconLi)));
document.querySelectorAll("dialog [data-close]").forEach((b) => { setIcon(b, "close"); b.addEventListener("click", () => b.closest("dialog").close()); });
[["camSettingsBtn", "settings"], ["homeSettingsBtn", "settings"], ["backBtn", "back"], ["undoBtn", "undo"], ["redoBtn", "redo"], ["favBtn", "star"],
  ["camGallery", "gallery"], ["camFlip", "flip"], ["flashBtn", "flashoff"], ["obBack", "back"], ["expandBtn", "chevup"]].forEach(([id, n]) => setIcon($(id), n));
setIcon(document.querySelector("#handle i"), "compare");
$("retakeBtn").innerHTML = icon("retake") + "<span>Retake</span>";
const fmtTime = (d) => d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

// ---------- Theme ----------
function applyTheme() {
  const t = store.get("glowTheme") || "system";
  if (t === "system") document.documentElement.removeAttribute("data-theme"); else document.documentElement.dataset.theme = t;
  document.querySelectorAll("#themeSeg button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.theme === t)));
}
applyTheme();

// ---------- Screens and navigation ----------
let screen = "";
function showScreen(id) {
  if (screen === "cameraScreen" && id !== "cameraScreen") stopCamera();
  screen = id;
  ["onboarding", "cameraScreen", "editorHome", "editorScreen"].forEach((s) => { $(s).hidden = s !== id; });
  const dest = id === "cameraScreen" ? "camera" : id === "editorHome" ? "editor" : "";
  $("nav").hidden = !dest || (id === "cameraScreen" && !!cam.shot);
  $("nav").classList.toggle("dark", id === "cameraScreen");
  document.querySelectorAll("#nav button").forEach((b) => { if (b.dataset.dest === dest) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current"); });
  if (dest) store.set("glowLastDest", dest);
  if (id === "cameraScreen") enterCamera();
  if (id === "editorHome") renderHome();
}
function go(dest) { showScreen(dest === "camera" ? "cameraScreen" : "editorHome"); }
$("nav").addEventListener("click", (e) => { const b = e.target.closest("button[data-dest]"); if (b) { Platform.haptic(); go(b.dataset.dest); } });

// ---------- Onboarding ----------
// Three short screens with the sample portrait. Screen 2 shows a real Glow result on it: a
// prepared AI preview when one exists, otherwise the Glow filter made on this device.
// Nothing asks for a permission here; the camera asks when it opens.
const INTRO = "/samples/demo/intro.jpg";
const SLIDES = [
  { title: "Your light. Your look.", text: "Take a photo with Glow, or make a favorite photo your own.", pair: true },
  { title: "Start natural. Adjust to your taste.", text: "Explore light, retouching, and looks. You choose how much.", compare: true },
  { title: "Make your first Glow.", text: "Free on-device tools, plus 3 AI credits each day.", last: true },
];
let slide = 0, introResult = null;
// The result for screen 2, made once: { src, label }.
function introAfter() {
  return introResult || (introResult = (async () => {
    try {
      const m = await (await fetch(DEMO_DIR + "manifest.json", { cache: "no-cache" })).json();
      for (const e of m.previews || []) {
        if (e.status !== "ready" || !e.result || !TOOL[e.tool] || e.aligned === false) continue;
        const r = await fetch(DEMO_DIR + e.result); if (!r.ok) continue;
        return { src: URL.createObjectURL(await r.blob()), label: "Prepared preview", tool: TOOL[e.tool].title };
      }
    } catch {}
    const glow = FILTERS.find((f) => f.id === "glow");
    return { src: await applyFilter(INTRO, glow), label: "Glow filter · free", tool: "the free Glow filter" };
  })().catch(() => { introResult = null; return null; }));
}
function renderSlide() {
  const s = SLIDES[slide];
  const photo = s.compare
    ? `<div class="ob-photo"><img src="${INTRO}" alt=""><img class="ob-after" id="obAfter" alt="" hidden><span class="ob-line" hidden></span>
        <span class="tag left">Original</span><span class="tag right" id="obAfterTag"></span><span class="tag bottom">AI-generated sample</span></div>`
    : `<div class="ob-photo"><img src="${INTRO}" alt=""><span class="tag bottom">AI-generated sample</span></div>`;
  $("obSlide").innerHTML = photo + `<h1>${s.title}</h1><p>${s.text}</p>` +
    (s.pair ? `<div class="ob-pair"><span>${icon("camera")}<b>Camera</b>Take a new photo</span><span>${icon("editor")}<b>Editor</b>Edit a photo you love</span></div>` : "");
  $("obSlide").querySelector(".ob-photo").setAttribute("aria-label", s.compare ? "AI-generated sample portrait, original and edited side by side" : "AI-generated sample portrait");
  $("obSlide").querySelector(".ob-photo").setAttribute("role", "img");
  if (s.compare) introAfter().then((r) => {
    const a = $("obAfter"); if (!r || !a) return;
    a.src = r.src; a.hidden = false; a.nextElementSibling.hidden = false; $("obAfterTag").textContent = r.label;
    a.closest(".ob-photo").setAttribute("aria-label", `AI-generated sample portrait: the original next to Glow's ${r.tool} result`);
  });
  [...$("obDots").children].forEach((d, i) => d.classList.toggle("on", i === slide));
  $("obDots").setAttribute("aria-label", `Step ${slide + 1} of ${SLIDES.length}`);
  $("obBack").style.visibility = slide ? "visible" : "hidden";
  const act = (label, kind, fn) => { const b = document.createElement("button"); b.className = "btn" + (kind ? " " + kind : ""); b.textContent = label; b.addEventListener("click", fn); return b; };
  $("obActions").replaceChildren(...(s.last
    ? [act("Open camera", "", () => finishOnboarding("camera")), act("Choose a photo", "quiet", () => finishOnboarding("pick")), act("Try a sample", "ghost", () => finishOnboarding("sample"))]
    : [act("Next", "", () => { slide++; renderSlide(); })]));
  $("obSkip").hidden = !!s.last;
  if (slide < SLIDES.length - 1) introAfter();
}
// Explicit choices here (and the sample or a picked photo) override the startup preference.
function finishOnboarding(dest) {
  store.set("glowOnboarded", "1");
  if (dest === "pick") { go("editor"); pickAndOpen(); }
  else if (dest === "sample") { go("editor"); openSample(); }
  else if (dest === "camera") go("camera");
  else { const pref = store.get("glowStart") || "last"; go(pref === "last" ? store.get("glowLastDest") || "camera" : pref); }
}
$("obBack").addEventListener("click", () => { if (slide > 0) { slide--; renderSlide(); } });
$("obSkip").addEventListener("click", () => finishOnboarding());
function showOnboarding() { slide = 0; renderSlide(); showScreen("onboarding"); }

// ---------- Editor state ----------
// hist[i] = { data, op, full }. data is the working-size picture (up to 2048px) used for
// previews; op records how to redo the step at full size on export; full holds a fixed
// result (an AI output or a camera look) at the size it was made.
// hist[0] is the photo as opened; hist[idx] is the committed result Save exports.
// pending is an on-device preview that only becomes part of the photo on Apply.
const ed = { hist: [], idx: 0, floor: 0, pending: null, savedIdx: 0, original: null, originalSaved: false, name: "", view: "split", split: 50, session: "", job: null };
const MAX_UNDO = 25;
let savingEdit = false;
let sel = null;          // selected tool id, or null when no panel is open
let cat = store.get("glowCat") || "foryou";
let chipFor = {};
try { chipFor = JSON.parse(store.get("glowChips") || "{}"); } catch {}
let favs = [], recent = [];
try { favs = JSON.parse(store.get("glowFavs") || "[]"); recent = JSON.parse(store.get("glowRecent") || "[]"); } catch {}
let lastCommitTool = null;  // the AI tool behind the latest commit, to disclose a repeat charge
let outfitData = null, strokes = [], painting = false, busyNow = false, thumb = "";

const hasPhoto = () => ed.hist.length > 0;
const committed = () => ed.hist[ed.idx].data;
const unsaved = () => hasPhoto() && ed.idx > 0 && ed.savedIdx !== ed.idx;
const newSession = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

// Tool settings. Reshaping tools start at 0, so nothing is reshaped unless the user asks.
const toolAmt = { light: 0, color: 0, warmth: 0, detail: 0 };
for (const t of TOOLS) if (t.reshape) faceSet.amt[t.id] = 0;
try {
  const s = JSON.parse(store.get("glowFace2") || "null") || { shade: (JSON.parse(store.get("glowFace") || "{}").shade) || {} };
  Object.assign(faceSet.amt, s.amt || {}); Object.assign(faceSet.shade, s.shade || {});
} catch {}
const saveFace = () => store.set("glowFace2", JSON.stringify(faceSet));
let lookPick = null;
let cr = null;            // the open crop: { base, baseIdx, img, canvas, turns, W, H, aspect, rect, start, view, hint }
let reshapeNote = null;   // why a reshape tool can't be used on this face (null while checking)

// Reads a photo once at full size: the untouched file is kept as the original, and a
// working copy of up to 2048px drives previews.
async function readPhoto(blob, name) {
  const url = URL.createObjectURL(blob);
  try {
    const img = await loadImg(url);
    const c = canvasFor(img, 2048);
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    const png = blob.type === "image/png";
    return { work: png ? c.toDataURL("image/png") : c.toDataURL("image/jpeg", 0.92),
      original: { blob, w: img.naturalWidth, h: img.naturalHeight, name: name || "photo", type: blob.type || "image/jpeg" } };
  } catch { throw new Error("Couldn't read that photo. Try a JPEG or PNG."); }
  finally { URL.revokeObjectURL(url); }
}

async function openPhoto(work, original, opts = {}) {
  if (!opts.demo && demo) exitDemo();
  ed.demo = !!opts.demo;
  ed.hist = [{ data: work, op: null }]; ed.idx = 0; ed.floor = 0; ed.pending = null; ed.savedIdx = 0;
  ed.original = original; ed.originalSaved = !!opts.originalSaved; ed.session = newSession();
  ed.name = opts.name || "Photo"; ed.shotStamp = opts.shotStamp || 0; lastCommitTool = null; cutoutCache = {}; strokes = [];
  if (opts.processed) { ed.hist.push({ data: opts.processed.data, full: opts.processed.full, op: { tool: "camlook", fixed: true, label: opts.processed.label } }); ed.idx = 1; }
  if (opts.savedAlready) ed.savedIdx = ed.idx;
  sel = null; ed.view = "edited"; ed.split = 50; toolsOpen = false;
  showScreen("editorScreen");
  renderEditor(); saveDraft();
}
async function confirmReplace() {
  if (jobActive() && job.session === ed.session) {
    const c = await ask({ title: `${job.title} is still running`, text: "If you start a new edit, its result will wait on the Editor screen instead of being added to this photo.",
      actions: [{ label: "Start a new edit", value: "go" }, { label: "Keep this one", value: "", kind: "ghost" }] });
    if (!c) return false;
  }
  if (!unsaved() || ed.demo) return true; // sample edits are only for trying things out
  const c = await ask({ title: "Start a new edit?", text: "Your current edit hasn't been saved.", actions: [
    { label: "Save it first", value: "save" }, { label: "Discard it", value: "discard", kind: "ghost" }, { label: "Keep editing", value: "", kind: "ghost" }] });
  if (c === "save") return saveEdit();
  return c === "discard";
}
async function openFile(f, name, opts = {}) {
  const r = await readPhoto(f, name || f.name);
  await openPhoto(r.work, r.original, { name: name || f.name, ...opts });
}
async function pickAndOpen() {
  if (!(await confirmReplace())) return;
  const f = await Platform.pickPhoto("file");
  if (!f) return;
  try { await openFile(f); } catch (err) { say(err.message, true); }
}
$("pickBtn").addEventListener("click", pickAndOpen);
$("sampleBtn").addEventListener("click", openSample);

// ---------- Try a sample: a free demo ----------
// The sample is an AI-generated portrait. On-device tools work on it normally. AI tools show
// results prepared once with Glow's real pipeline (see samples/demo/manifest.json), loaded as
// static files: no AI request, no credits, no sign-in, no paywall. This is only a display
// path; the server still enforces credits on every real AI request, whatever the app says.
const DEMO_DIR = "/samples/demo/";
const DEMO_FREE = ["fblemish", "fsmooth", "fauto", "light", "filter:glow", "bgblur"];
let demo = null; // { manifest, ready: [toolId], entry: {toolId: entry}, cache: {toolId: dataURL}, failed: {toolId: true}, saved }
const demoOffers = (id) => !ed.demo || TOOL[id].kind !== "ai" || (!!demo && demo.ready.includes(id));

async function openSample() {
  if (!(await confirmReplace())) return;
  let manifest = null;
  try { const r = await fetch(DEMO_DIR + "manifest.json", { cache: "no-cache" }); if (r.ok) manifest = await r.json(); } catch {}
  const file = (manifest && manifest.original && manifest.original.file) || "original.png";
  let blob;
  try {
    const r = await fetch(DEMO_DIR + file); if (!r.ok) throw new Error();
    blob = await r.blob();
  } catch {
    const c = await ask({ title: "Couldn't load the sample", text: "Check your connection and try again.", actions: [{ label: "Try again", value: "retry" }, { label: "Not now", value: "", kind: "ghost" }] });
    if (c) openSample();
    return;
  }
  // Settings people change while trying the sample don't stick to their own photos.
  const saved = demo ? demo.saved : { amt: { ...faceSet.amt }, shade: { ...faceSet.shade }, toolAmt: { ...toolAmt } };
  const entries = (manifest && manifest.previews) || [];
  demo = { manifest, saved, entry: Object.fromEntries(entries.map((e) => [e.tool, e])), cache: {}, failed: {},
    ready: entries.filter((e) => e.status === "ready" && e.result && TOOL[e.tool] && TOOL[e.tool].kind === "ai").map((e) => e.tool) };
  cat = "foryou";
  try { await openFile(new File([blob], "glow-ai-sample.png", { type: blob.type || "image/png" }), "AI-generated sample", { demo: true }); }
  catch (err) { exitDemo(); say(err.message, true); return; }
  $("alertLive").textContent = "AI-generated sample opened. Demo, no credits used.";
  // Only offer previews whose files are really there, then warm up the first two.
  const ok = await Promise.all(demo.ready.map((id) => fetch(DEMO_DIR + demo.entry[id].result, { method: "HEAD" }).then((r) => r.ok).catch(() => false)));
  if (!demo) return;
  demo.ready = demo.ready.filter((_, i) => ok[i]);
  demo.ready.slice(0, 2).forEach((id) => demoAsset(id).catch(() => {}));
  if (screen === "editorScreen") renderEditor();
}
async function demoAsset(id) {
  if (demo.cache[id]) return demo.cache[id];
  const r = await fetch(DEMO_DIR + demo.entry[id].result);
  if (!r.ok) throw new Error("missing");
  return (demo.cache[id] = await blobToData(await r.blob()));
}
function demoReset(msg) {
  ed.hist = ed.hist.slice(0, 1); ed.idx = 0; ed.floor = 0; ed.savedIdx = 0; ed.pending = null;
  if (msg) say(msg);
}
async function showDemoPreview(id) {
  const t = TOOL[id], mine = ++previewToken;
  demoReset(); sel = id; delete demo.failed[id]; demo.loading = id;
  renderEditor();
  try {
    const data = await demoAsset(id);
    if (mine !== previewToken || sel !== id || !ed.demo) return;
    ed.hist.push({ data, full: data, op: { tool: id, fixed: true, demo: true } }); ed.idx = 1;
    $("alertLive").textContent = `${t.title} prepared preview shown. Use Compare to see it next to the original.`;
  } catch {
    if (mine !== previewToken || !demo) return;
    demo.failed[id] = true;
    $("alertLive").textContent = `Couldn't load the ${t.title} preview.`;
  } finally {
    if (demo && demo.loading === id) demo.loading = null;
    if (mine === previewToken) renderEditor();
  }
}
function demoPanelState(t) {
  const chip = $("cost"), apply = $("applyBtn");
  chip.textContent = "Prepared preview"; chip.className = "chip";
  apply.disabled = false;
  if (demo && demo.failed[t.id]) {
    apply.textContent = "Retry";
    $("panelNote").textContent = "Couldn't load this preview. Check your connection and try again.";
  } else if (demo && demo.loading === t.id) {
    apply.textContent = "Done"; apply.disabled = true;
    $("panelNote").textContent = "Loading the prepared preview…";
  } else {
    apply.textContent = "Done";
    const shifted = demo && demo.entry[t.id] && demo.entry[t.id].aligned === false ? " The AI reframed the picture a little, so Compare won't line up exactly." : "";
    $("panelNote").textContent = `A saved result from Glow's ${t.title} tool on this photo. Nothing is generated and no credits are used. Sample previews show one effect at a time.${shifted}`;
  }
}
// "prepared-preview-relight-" when the shown result is a prepared preview, so the file says what it is.
function demoSaveTag() { const op = ed.hist[ed.idx].op; return op && op.demo ? `prepared-preview-${op.tool}-` : ""; }
function exitDemo() {
  if (!demo) return;
  Object.assign(faceSet.amt, demo.saved.amt); Object.assign(faceSet.shade, demo.saved.shade); saveFace();
  Object.assign(toolAmt, demo.saved.toolAmt);
  demo = null; ed.demo = false; sel = null; lastCommitTool = null;
}
$("demoOwnBtn").addEventListener("click", pickAndOpen);

// ---------- Draft: keeps the session (and any AI job) through a refresh or the app closing ----------
let draftWarn = false;
async function saveDraft() {
  if (!hasPhoto() || ed.demo) return Drafts.clear(); // the sample is never kept as a project
  try {
    await Drafts.put({ v: 2, original: ed.original, hist: ed.hist.slice(0, ed.idx + 1), idx: ed.idx, floor: ed.floor, savedIdx: ed.savedIdx,
      originalSaved: ed.originalSaved, name: ed.name, session: ed.session, ts: Date.now() });
    draftWarn = false;
  } catch { draftWarn = true; }
}
window.addEventListener("beforeunload", (e) => { if (draftWarn && unsaved()) { e.preventDefault(); e.returnValue = ""; } });
async function restoreDraft() {
  const d = await Drafts.get();
  if (d && d.v === 2 && d.hist && d.hist.length) {
    Object.assign(ed, { original: d.original, hist: d.hist, idx: d.idx, floor: d.floor || 0, savedIdx: d.savedIdx, originalSaved: !!d.originalSaved,
      name: d.name || "Photo", session: d.session || newSession() });
  }
  recovered = await Drafts.getRecovered();
  job = await Drafts.getJob();
  if (screen === "editorHome") renderHome();
  if (screen === "editorScreen") renderEditor();
  if (job && job.status === "starting") { job.status = "unknown"; job.error = "Glow was closed before it heard back."; }
  if (jobActive()) checkJob(); // a free status check, never a new charge
}
async function discardSession() {
  if (unsaved()) {
    const c = await ask({ title: "Discard this edit?", text: "Your changes will be lost. The original photo isn't affected.",
      actions: [{ label: "Discard", value: "yes" }, { label: "Keep it", value: "", kind: "ghost" }] });
    if (!c) return;
  }
  exitDemo();
  ed.hist = []; ed.idx = 0; ed.pending = null; sel = null; ed.session = "";
  await Drafts.clear(); renderHome(); say("Edit discarded.");
}
$("discardBtn").addEventListener("click", discardSession);
$("resumeBtn").addEventListener("click", () => { showScreen("editorScreen"); renderEditor(); });
// A result that finished after its photo was replaced opens as a new photo of its own.
$("recoveredOpen").addEventListener("click", async () => {
  const r = recovered; if (!r) return;
  if (!(await confirmReplace())) return;
  try {
    const blob = await (await fetch(r.full)).blob();
    await openFile(new File([blob], "glow-ai-result", { type: blob.type || "image/jpeg" }), `${r.title} result`);
    recovered = null; Drafts.clearRecovered();
  } catch { say("Couldn't open that result. Try again.", true); }
});
$("recoveredDiscard").addEventListener("click", async () => {
  const c = await ask({ title: "Discard this AI result?", text: "It hasn't been saved. The credit it used isn't returned.",
    actions: [{ label: "Discard", value: "yes" }, { label: "Keep it", value: "", kind: "ghost" }] });
  if (!c) return;
  recovered = null; await Drafts.clearRecovered(); renderHome();
});

function renderHome() {
  $("resumeCard").hidden = !hasPhoto();
  if (hasPhoto()) {
    $("resumeImg").src = committed();
    const j = job && job.session === ed.session ? ` · ${job.title}: ${JOB_SHORT[job.status]}` : "";
    $("resumeMeta").textContent = ed.demo ? "AI-generated sample · Demo" : (unsaved() ? "Not saved yet" : ed.idx > 0 ? "Saved" : "No edits yet") + j;
  }
  $("recoveredCard").hidden = !recovered;
  if (recovered) {
    $("recoveredImg").src = recovered.data;
    $("recoveredTitle").textContent = `Your ${recovered.title} result is ready`;
  }
  renderCredits();
}

// ---------- Editor rendering ----------
// The photo sits on a neutral charcoal canvas, whole (contain), never cropped or stretched.
// The canvas color is only on screen: Save exports the picture alone.
function renderEditor() {
  if (!hasPhoto()) return;
  const st = $("stage"), brushing = sel === "erase";
  const after = ed.pending ? ed.pending.data : ed.idx > 0 ? committed() : null;
  const b = $("before"), a = $("after");
  const wantBefore = brushing ? committed() : ed.hist[0].data;
  if (b.getAttribute("src") !== wantBefore) { b.classList.remove("alpha"); b.onload = () => { markAlpha(b); layoutFrame(); }; b.src = wantBefore; }
  if (after && !brushing) {
    if (a.getAttribute("src") !== after) {
      // A short crossfade once the new result has loaded (instant with reduced motion).
      a.classList.add("fade"); a.classList.remove("alpha");
      a.onload = () => { markAlpha(a); layoutFrame(); requestAnimationFrame(() => a.classList.remove("fade")); };
      a.src = after;
    }
    a.hidden = false;
  } else a.hidden = true;
  const hasAfter = !!after && !brushing;
  if (!hasAfter && ed.view !== "edited") ed.view = "edited";
  st.classList.toggle("has-after", hasAfter);
  st.dataset.view = brushing ? "original" : ed.view;
  // Comparing only means something once there's an edit or a preview.
  document.querySelectorAll(".views button").forEach((v) => {
    v.setAttribute("aria-pressed", String(v.dataset.view === ed.view)); v.disabled = !hasAfter || !!cr;
  });
  const prepared = !ed.pending && ed.idx > 0 && ed.hist[ed.idx].op && ed.hist[ed.idx].op.demo;
  const editedName = ed.pending ? "Preview" : prepared ? "Prepared preview" : "Edited";
  const view = st.dataset.view;
  $("tagLeft").textContent = hasAfter && (view === "split" || view === "original") ? "Original" : "";
  $("tagRight").textContent = hasAfter && view === "split" ? editedName : hasAfter && view === "edited" && editedName !== "Edited" ? editedName : "";
  $("demoBar").hidden = !ed.demo; $("tagSample").hidden = !ed.demo;
  layoutFrame(); setSplit(ed.split);
  if ($("frame").classList.contains("narrow") && view === "split") $("tagRight").textContent = editedName.replace(" preview", "");
  $("brush").hidden = !brushing;
  if (brushing) requestAnimationFrame(drawStrokes);
  $("undoBtn").disabled = !!busyNow || (ed.idx <= ed.floor && !ed.pending);
  $("redoBtn").disabled = !!busyNow || ed.idx >= ed.hist.length - 1;
  // Saving the same version twice would only make a duplicate copy.
  const savedNow = ed.idx > 0 && ed.savedIdx === ed.idx && !ed.pending;
  $("saveBtn").disabled = !!busyNow || savingEdit || (ed.idx === 0 && !ed.pending) || savedNow;
  $("saveBtn").textContent = savedNow ? "Saved" : "Save";
  $("editorScreen").classList.toggle("editing-tool", !!sel);
  $("editorScreen").classList.toggle("tools-open", toolsOpen && cat === "all" && !sel);
  if (thumbFor !== committed()) { thumbFor = committed(); refreshThumb(); }
  renderTabs(); renderTools(); renderPanel(); renderCredits(); renderJob();
  if (sel) { const tb = $("tools").querySelector(`.tool[data-tool="${CSS.escape(sel)}"]`); if (tb) tb.scrollIntoView({ block: "nearest", inline: "nearest" }); }
}
let thumbFor = null, toolsOpen = false;
// Checkerboard only behind pictures that really have transparent pixels.
function markAlpha(img) {
  try {
    if (!/^data:image\/(png|webp)/.test(img.getAttribute("src") || "")) return;
    const w = 48, h = Math.max(1, Math.round(48 * img.naturalHeight / img.naturalWidth)), c = newCanvas(w, h), ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, w, h);
    const d = ctx.getImageData(0, 0, w, h).data;
    for (let i = 3; i < d.length; i += 4) if (d[i] < 250) { img.classList.add("alpha"); return; }
  } catch {}
}
// Sizes the frame to the photo as shown (the edited picture when there is one), so the
// divider and labels sit on the picture and both images stay aligned at any size.
function layoutFrame() {
  const st = $("stage"), a = $("after"), b = $("before");
  const main = !a.hidden && a.naturalWidth ? a : b;
  const W = st.clientWidth, H = st.clientHeight, f = $("frame");
  if (!main.naturalWidth || !W || !H) { Object.assign(f.style, { left: "0px", top: "0px", width: W + "px", height: H + "px" }); return; }
  const s = Math.min(W / main.naturalWidth, H / main.naturalHeight), w = Math.round(main.naturalWidth * s), h = Math.round(main.naturalHeight * s);
  Object.assign(f.style, { left: Math.round((W - w) / 2) + "px", top: Math.round((H - h) / 2) + "px", width: w + "px", height: h + "px" });
  f.classList.toggle("narrow", w < 220);
}
new ResizeObserver(() => { layoutFrame(); if (sel === "erase") drawStrokes(); if (cr) renderCrop(); }).observe($("stage"));
function setSplit(pct) {
  ed.split = Math.max(0, Math.min(100, pct));
  $("after").style.clipPath = $("stage").dataset.view === "split" ? `inset(0 0 0 ${ed.split}%)` : "";
  $("divider").style.left = ed.split + "%";
  $("handle").setAttribute("aria-valuenow", String(Math.round(ed.split)));
  $("handle").setAttribute("aria-valuetext", `${Math.round(ed.split)}% original`);
}
document.querySelector(".views").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-view]"); if (!b || b.disabled) return;
  if (b.dataset.view === "split" && ed.view !== "split") centerDividerOnFace();
  ed.view = b.dataset.view; renderEditor();
  if (ed.view === "split") $("alertLive").textContent = "Compare: drag the divider, or use the arrow keys on it.";
});
// Compare starts with the divider down the middle of the face when one is known (the
// landmarks found by a face tool), otherwise down the middle of the photo.
function centerDividerOnFace() {
  const faces = faceCache.get(committed()) || faceCache.get(ed.pending ? ed.pending.data : "") || [];
  ed.split = faces.length ? Math.max(5, Math.min(95, faces[0][1][0] * 100)) : 50;
}
// Drag the divider (or anywhere on the photo) to compare; arrow keys move the handle.
let dragging = false;
const dragTo = (e) => { const r = $("frame").getBoundingClientRect(); setSplit(((e.clientX - r.left) / r.width) * 100); };
$("stage").addEventListener("pointerdown", (e) => {
  if (!$("stage").classList.contains("has-after") || $("stage").dataset.view !== "split" || e.target.closest(".history")) return;
  dragging = true; $("stage").setPointerCapture(e.pointerId); dragTo(e);
});
$("stage").addEventListener("pointermove", (e) => { if (dragging) dragTo(e); });
["pointerup", "pointercancel"].forEach((ev) => $("stage").addEventListener(ev, () => { dragging = false; }));
$("handle").addEventListener("keydown", (e) => {
  const step = e.shiftKey ? 10 : 2, k = e.key;
  if (k === "ArrowLeft" || k === "ArrowDown") setSplit(ed.split - step);
  else if (k === "ArrowRight" || k === "ArrowUp") setSplit(ed.split + step);
  else if (k === "Home") setSplit(0); else if (k === "End") setSplit(100); else return;
  e.preventDefault();
});

// History
// Every step's recipe is kept so Save can redo it at full size; only the working-size
// pictures of steps older than MAX_UNDO are dropped (those steps can no longer be undone).
function commit(data, t, op, full) {
  ed.hist = ed.hist.slice(0, ed.idx + 1); ed.hist.push({ data, op: op || { tool: t.id }, full });
  ed.idx = ed.hist.length - 1; ed.pending = null;
  while (ed.idx - ed.floor > MAX_UNDO) { ed.floor++; if (ed.floor > 1) ed.hist[ed.floor - 1].data = null; }
  lastCommitTool = t && t.kind === "ai" ? t.id : null;
  if (t) { recent = [t.id, ...recent.filter((x) => x !== t.id)].slice(0, 8); store.set("glowRecent", JSON.stringify(recent)); }
  ed.view = "edited"; ed.split = 50;
  saveDraft();
}
$("undoBtn").addEventListener("click", () => {
  if (ed.pending) { ed.pending = null; previewToken++; }
  else if (ed.idx > ed.floor) ed.idx--;
  lastCommitTool = null; renderEditor(); saveDraft(); say("Undone.");
});
$("redoBtn").addEventListener("click", () => {
  if (ed.idx < ed.hist.length - 1) { ed.pending = null; ed.idx++; lastCommitTool = null; renderEditor(); saveDraft(); say("Redone."); }
});

// ---------- Categories and tools ----------
function groupsFor(c) {
  if (c === "foryou" && ed.demo) {
    const ready = demo ? demo.ready : [];
    return [["demo", ready.length ? "Prepared AI previews" : "AI previews aren't prepared for the sample yet", ready.length ? ready : []],
      ["free", "Free on-device", DEMO_FREE]];
  }
  if (c === "foryou") {
    const g = [];
    if (favs.length) g.push(["fav", "Favorites", favs]);
    if (recent.length) g.push(["recent", "Recent", recent.filter((id) => !favs.includes(id)).slice(0, 6)]);
    const shown = new Set(g.flatMap((x) => x[2]));
    g.push(["start", "Good places to start", SUGGESTED.filter((id) => !shown.has(id)).slice(0, 4)]);
    return g.filter((x) => x[2].length);
  }
  if (c === "all") {
    const q = $("searchInput").value.trim().toLowerCase();
    return ORIGINAL_CATS.map(([k, name]) => [k, name, TOOLS.filter((t) => t.cat === k &&
      (!q || `${t.label} ${t.title} ${name}`.toLowerCase().includes(q))).map((t) => t.id)]).filter((x) => x[2].length);
  }
  const groups = CATS[c], pick = chipFor[c] || groups[0][0];
  return groups.filter((g) => g[0] === pick);
}
function renderTabs() {
  document.querySelectorAll("#tabs .tab").forEach((t) => {
    const on = t.dataset.cat === cat;
    t.setAttribute("aria-selected", String(on)); t.tabIndex = on ? 0 : -1;
  });
  const groups = CATS[cat];
  $("chips").hidden = !groups;
  $("searchBox").hidden = cat !== "all";
  // For You has no subgroups; its slot says what's there instead.
  const note = cat === "foryou" ? (ed.demo ? (demo && demo.ready.length ? "Sample previews show one effect at a time."
    : "Prepared AI previews aren't available for the sample yet. Try the free tools.") : "Suggestions, your favorites and recent tools.") : "";
  $("slotNote").textContent = note; $("slotNote").hidden = !note;
  const open = toolsOpen && cat === "all";
  $("expandBtn").setAttribute("aria-expanded", String(open));
  $("expandBtn").setAttribute("aria-label", open ? "Show fewer tools" : "Show more tools");
  setIcon($("expandBtn"), open ? "chevdown" : "chevup");
  if (groups) {
    const pick = chipFor[cat] || groups[0][0];
    $("chips").replaceChildren(...groups.map(([k, name]) => {
      const b = document.createElement("button"); b.className = "subchip"; b.textContent = name; b.dataset.chip = k;
      b.setAttribute("aria-pressed", String(k === pick)); return b;
    }));
  }
}
function toolButton(t) {
  const b = document.createElement("button");
  b.className = "tool"; b.dataset.tool = t.id;
  b.setAttribute("aria-pressed", String(sel === t.id));
  const cost = ed.demo ? 0 : costOf(t), prepared = ed.demo && t.kind === "ai";
  b.setAttribute("aria-label", t.label + (prepared ? ", prepared preview, no credits" : cost ? `, uses ${credits(cost)}` : ", free"));
  const well = document.createElement("i"); well.className = "well";
  if (t.kind === "filter") {
    if (thumb) { well.style.backgroundImage = `url(${thumb})`; well.style.filter = t.filter.f; }
  } else well.innerHTML = icon(t.id);
  if (cost || prepared) { const c = document.createElement("span"); c.className = "cost"; c.textContent = prepared ? "Preview" : `AI · ${cost}`; c.setAttribute("aria-hidden", "true"); well.append(c); }
  const name = document.createElement("span"); name.className = "name"; name.textContent = t.label;
  b.append(well, name);
  return b;
}
function renderTools() {
  const groups = groupsFor(cat).map((g) => [g[0], g[1], g[2].filter((id) => TOOL[id] && demoOffers(id))]).filter((g) => g[2].length), box = $("tools");
  if (!groups.length && ed.demo) { box.innerHTML = `<p class="empty-note">This tool group needs your own photo. Tap Try your own photo above.</p>`; return; }
  if (!groups.length) { box.innerHTML = `<p class="empty-note">No tools match that search.</p>`; return; }
  renderToolGroups(box, groups, cat === "foryou" || cat === "all");
}
function renderToolGroups(box, groups, showLabels) {
  box.replaceChildren(...groups.map(([, name, ids]) => {
    const g = document.createElement("div"); g.className = "group"; g.setAttribute("role", "group"); g.setAttribute("aria-label", name);
    if (showLabels) { const l = document.createElement("span"); l.className = "group-label"; l.textContent = name; l.setAttribute("aria-hidden", "true"); g.append(l); }
    const items = document.createElement("div"); items.className = "group-items";
    items.append(...ids.filter((id) => TOOL[id] && demoOffers(id)).map((id) => toolButton(TOOL[id])));
    g.append(items); return g;
  }));
}
async function refreshThumb() {
  try {
    const img = await loadImg(committed()), c = canvasFor(img, 120);
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height); thumb = c.toDataURL("image/jpeg", 0.8);
  } catch { thumb = ""; }
  if (screen === "editorScreen") renderTools();
}
$("tabs").addEventListener("click", (e) => {
  const t = e.target.closest(".tab"); if (!t) return;
  cat = t.dataset.cat; store.set("glowCat", cat); $("tools").scrollTo(0, 0);
  $("editorScreen").classList.toggle("tools-open", toolsOpen && cat === "all" && !sel); renderTabs(); renderTools();
  if (cat === "all" && matchMedia("(pointer: fine)").matches) $("searchInput").focus();
});
$("tabs").addEventListener("keydown", (e) => {
  if (!["ArrowLeft", "ArrowRight"].includes(e.key)) return;
  const tabs = [...document.querySelectorAll("#tabs .tab")], i = tabs.findIndex((t) => t.dataset.cat === cat);
  const n = tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length]; n.click(); n.focus();
});
$("chips").addEventListener("click", (e) => {
  const b = e.target.closest(".subchip"); if (!b) return;
  chipFor[cat] = b.dataset.chip; store.set("glowChips", JSON.stringify(chipFor)); renderTabs(); renderTools();
});
$("searchInput").addEventListener("input", renderTools);
// All: a deliberate switch between one scrolling row and a taller catalog.
$("expandBtn").addEventListener("click", () => {
  toolsOpen = !toolsOpen; $("editorScreen").classList.toggle("tools-open", toolsOpen && cat === "all" && !sel); renderTabs();
});
$("tools").addEventListener("click", (e) => {
  const b = e.target.closest(".tool"); if (!b || busyNow) return;
  Platform.haptic();
  selectTool(sel === b.dataset.tool ? null : b.dataset.tool);
});

// ---------- Selected tool panel ----------
function discardPending() { if (ed.pending) { ed.pending = null; previewToken++; } }
function selectTool(id) {
  if (ed.pending && ed.pending.tool !== id) say(`${TOOL[ed.pending.tool].title} wasn't applied.`);
  discardPending();
  if (cr) closeCrop();
  sel = id; strokes = []; outfitData = null; toolsOpen = false; panelBuilt = null; reshapeNote = null;
  lookPick = editorLooks().some((l) => l.id === lookId) ? lookId : "natural";
  if (id in toolAmt) toolAmt[id] = 0; // adjustments start from the committed photo
  if (ed.demo && id) {
    const t = TOOL[id];
    // One effect at a time: a prepared preview always starts from the original, and so does
    // an on-device tool picked while a prepared preview is showing.
    if (t.kind === "ai") { showDemoPreview(id); return; }
    if (ed.idx > 0 && ed.hist.some((h) => h.op && h.op.demo)) demoReset("Back to the original. Sample previews show one effect at a time.");
  }
  renderEditor();
  if (id) {
    const t = TOOL[id];
    if (t.kind === "adjust") return; // previews once changed
    if (t.kind === "crop") { openCrop().catch((err) => { say(err.message, true); selectTool(null); }); return; }
    if (t.kind === "face" && t.reshape) checkReshape(id);
    if (t.kind === "face" || t.kind === "body" || t.kind === "hair") { if ((faceSet.amt[id] ?? 50) > 0) preview(); return; }
    if (t.kind === "look") { preview(); return; }
    if (t.kind === "filter" || t.kind === "bg") preview();
  }
}
$("cancelBtn").addEventListener("click", () => selectTool(null));
$("favBtn").addEventListener("click", () => {
  if (!sel) return;
  favs = favs.includes(sel) ? favs.filter((x) => x !== sel) : [sel, ...favs].slice(0, 8);
  store.set("glowFavs", JSON.stringify(favs)); renderPanel(); if (cat === "foryou") renderTools();
  say(favs.includes(sel) ? "Added to favorites in For You." : "Removed from favorites.");
});

function slider(label, min, max, value, onInput, onChange, fmt = (v) => v) {
  const l = document.createElement("label"); l.className = "slider";
  const r = document.createElement("input"); r.type = "range"; r.min = min; r.max = max; r.value = value;
  // Screen readers hear the tool's name and a spoken value, e.g. "Smooth skin strength, 50 percent".
  if (sel) r.setAttribute("aria-label", `${TOOL[sel].title} ${label.toLowerCase()}`);
  const spoken = (v) => (min < 0 ? (v === 0 ? "No change" : v > 0 ? `Plus ${v}` : `Minus ${-v}`) : `${v} percent`);
  const o = document.createElement("output"); o.textContent = fmt(value); o.setAttribute("aria-hidden", "true");
  r.setAttribute("aria-valuetext", spoken(value));
  r.addEventListener("input", () => { o.textContent = fmt(+r.value); r.setAttribute("aria-valuetext", spoken(+r.value)); onInput && onInput(+r.value); });
  r.addEventListener("change", () => onChange(+r.value));
  l.append(label, r, o); return l;
}
function swatches(list, current, onPick) {
  const box = document.createElement("div"); box.className = "swatches"; box.setAttribute("role", "group"); box.setAttribute("aria-label", "Color");
  box.append(...list.map((c, i) => {
    const b = document.createElement("button"); b.className = "swatch"; b.setAttribute("aria-label", `Shade ${i + 1}`);
    b.setAttribute("aria-pressed", String(c === current)); b.innerHTML = `<i style="background:${c}"></i>`;
    b.addEventListener("click", () => onPick(c)); return b;
  }));
  return box;
}
function options(list, isOn, onPick) {
  const box = document.createElement("div"); box.className = "opts";
  box.append(...list.map(([label, v]) => {
    const b = document.createElement("button"); b.className = "opt"; b.textContent = label; b.setAttribute("aria-pressed", String(isOn(v)));
    b.addEventListener("click", () => onPick(v)); return b;
  }));
  return box;
}
const signed = (v) => (v > 0 ? "+" + v : String(v));
let adjustTimer = 0;

// The panel's controls are built once per tool (so a slider isn't replaced mid-drag);
// its cost, note and Apply button are refreshed on every render.
let panelBuilt = null;
function renderPanel(rebuild) {
  const t = sel && TOOL[sel];
  $("panel").hidden = !t;
  if (!t) { panelBuilt = null; return; }
  if (rebuild || panelBuilt !== t.id) { buildPanel(t); panelBuilt = t.id; }
  panelState(t);
}
function buildPanel(t) {
  $("toolName").textContent = t.title; $("toolName").tabIndex = -1;
  $("favBtn").setAttribute("aria-pressed", String(favs.includes(t.id)));
  $("favBtn").setAttribute("aria-label", favs.includes(t.id) ? "Remove from favorites" : "Add to favorites");
  const body = $("panelBody");
  body.replaceChildren();

  if (t.kind === "face" || t.kind === "body" || t.kind === "hair") {
    body.append(slider("Strength", 0, 100, faceSet.amt[t.id] ?? 50, null, (v) => { faceSet.amt[t.id] = v; saveFace(); preview(); }));
    const shades = SHADES[t.id];
    if (shades) body.append(swatches(shades, faceSet.shade[t.id], (c) => { faceSet.shade[t.id] = c; saveFace(); renderPanel(true); preview(); }));
  } else if (t.kind === "adjust") {
    body.append(slider("Amount", -50, 50, toolAmt[t.id], (v) => {
      toolAmt[t.id] = v; clearTimeout(adjustTimer); adjustTimer = setTimeout(preview, 120);
    }, (v) => { toolAmt[t.id] = v; clearTimeout(adjustTimer); preview(); }, signed));
  } else if (t.kind === "crop") {
    if (!cr) return;
    const shapes = options(CROPS, (v) => v === cr.aspect, (v) => setCropAspect(v));
    shapes.setAttribute("role", "group"); shapes.setAttribute("aria-label", "Crop shape"); body.append(shapes);
    const z = slider("Zoom", 100, ZOOM_MAX * 100, Math.round(cropZoom() * 100), (v) => {
      const { F } = cropView(); zoomCrop((v / 100) / cropZoom(), F.x + F.w / 2, F.y + F.h / 2);
    }, () => {}, (v) => (v / 100).toFixed(1) + "×");
    const zi = z.querySelector("input"); zi.id = "cropZoom"; zi.setAttribute("aria-valuetext", `${(zi.value / 100).toFixed(1)} times`);
    zi.addEventListener("input", () => zi.setAttribute("aria-valuetext", `${(zi.value / 100).toFixed(1)} times`));
    body.append(z);
    const row = document.createElement("div"); row.className = "crop-tools";
    const rot = document.createElement("button"); rot.className = "btn quiet small"; rot.innerHTML = icon("rotate") + "Rotate 90°";
    rot.addEventListener("click", rotateCrop);
    const rs = document.createElement("button"); rs.className = "btn quiet small"; rs.id = "cropReset"; rs.textContent = "Reset";
    rs.addEventListener("click", resetCrop);
    row.append(rot, rs); body.append(row);
  } else if (t.kind === "look") {
    body.append(options(editorLooks().map((l) => [l.name, l.id]), (v) => v === lookPick, (v) => { lookPick = v; renderPanel(true); preview(); }));
  } else if (t.id === "outfit") {
    const row = document.createElement("div"); row.className = "outfit-pick";
    if (outfitData) { const im = document.createElement("img"); im.src = outfitData; im.alt = "Outfit you picked"; row.append(im); }
    const b = document.createElement("button"); b.className = "btn quiet small"; b.textContent = outfitData ? "Change outfit photo" : "Choose outfit photo";
    b.addEventListener("click", async () => {
      const f = await Platform.pickPhoto("outfitFile");
      if (f) { try { outfitData = await loadAndShrink(f); } catch (err) { say(err.message, true); } renderPanel(true); }
    });
    row.append(b); body.append(row);
  } else if (t.id === "erase") {
    const b = document.createElement("button"); b.className = "btn quiet small"; b.id = "clearMarks"; b.textContent = "Clear marks";
    b.addEventListener("click", () => { strokes = []; drawStrokes(); renderPanel(); }); body.append(b);
  }
}
function panelState(t) {
  if (ed.demo && t.kind === "ai") return demoPanelState(t);
  const cost = costOf(t), chip = $("cost"), apply = $("applyBtn");
  let note = t.hint || "";
  if (!cost) { chip.textContent = "Free · on-device"; chip.className = "chip free"; }
  else { chip.textContent = `AI · ${credits(cost)}`; chip.className = "chip"; }
  if (t.reshape && !(faceSet.amt[t.id] > 0)) note = (note ? note + " " : "") + "Starts at 0. Move the slider to reshape.";
  const blocked = t.reshape && t.kind === "face" && reshapeNote && reshapeNote.tool === t.id ? reshapeNote : null;
  if (blocked) note = blocked.msg === null ? "Finding the face…" : blocked.msg || note;
  if (t.kind === "crop") note = "";
  if ($("clearMarks")) $("clearMarks").disabled = !strokes.length;

  // Apply: on-device tools commit the preview; AI tools charge here, once.
  apply.disabled = busyNow;
  if (!cost) {
    apply.textContent = "Apply";
    if (t.kind === "adjust") apply.disabled ||= !ed.pending;
    if (t.reshape) apply.disabled ||= !(faceSet.amt[t.id] > 0) || !!(blocked && blocked.msg !== "");
    if (t.kind === "crop") apply.disabled ||= !cropChanged();
    const sl = $("panelBody").querySelector(".slider input");
    if (sl && t.reshape && t.kind === "face") sl.disabled = !!(blocked && blocked.msg);
  } else {
    const again = lastCommitTool === t.id;
    const a = account, short = a && a.remaining < cost;
    if (short) {
      apply.textContent = "Get more AI credits";
      note = a.remaining
        ? `This uses ${credits(cost)} and you have ${a.remaining} left.`
        : `You're out of AI credits ${a.plan === "pro" ? "for now" : "for today"}. On-device tools are still free.`;
    } else {
      apply.textContent = `${again ? "Run again" : "Apply"} · ${credits(cost)}`;
      const bal = a ? ` You have ${a.remaining} left ${a.plan === "pro" ? "this week" : "today"}.` : "";
      note = again ? `Running it again makes a new version and uses another ${credits(cost).replace(/^1 /, "")}.${bal}` : `${note}${bal}`.trim();
    }
    if (jobActive()) { apply.disabled = true; note = `Wait for ${job.title} to finish, or check its status above. Glow runs one AI edit at a time so nothing is charged twice.`; }
    if (t.id === "outfit" && !outfitData && !short) apply.disabled = true;
    if (t.id === "erase" && !strokes.length && !short) apply.disabled = true;
  }
  $("panelNote").textContent = note;
}

// On-device steps are recorded as recipes (tool + settings), so the same step can be
// previewed at working size and redone at full size when the photo is saved.
let previewToken = 0;
function opFor(t) {
  const op = { tool: t.id };
  if (t.kind === "face" || t.kind === "body" || t.kind === "hair") { op.amt = (faceSet.amt[t.id] ?? 50) / 100; op.shades = { ...faceSet.shade }; }
  if (t.kind === "adjust") op.value = toolAmt[t.id];
  if (t.kind === "look") op.look = { ...(editorLooks().find((l) => l.id === lookPick) || PRESET_LOOKS[1]) };
  return op;
}
async function computeOp(op, base) {
  const t = TOOL[op.tool];
  if (t.kind === "face" || t.kind === "body" || t.kind === "hair") {
    const keep = { ...faceSet.shade };
    Object.assign(faceSet.shade, op.shades);
    try {
      if (t.kind === "face") return await faceEdit(base, t.id, op.amt);
      if (t.kind === "body") return await bodyEdit(base, t.id, op.amt);
      return await hairColor(base, op.amt, op.shades.hcolor);
    } finally { Object.assign(faceSet.shade, keep); }
  }
  if (t.kind === "filter") return applyFilter(base, t.filter);
  if (t.kind === "adjust") return op.value ? adjust(base, t.id, op.value) : null;
  if (t.kind === "crop") {
    if (op.rect) return cropRect(base, op.turns, op.rect, op.aspect);
    return op.ratio || op.turns % 4 ? cropRotate(base, op.ratio, op.turns) : null; // steps saved before interactive crop
  }
  if (t.kind === "look") return applyLook(base, op.look);
  if (t.kind === "bg") {
    const cut = await cutout(base);
    if (t.id === "bgremove") return cut;
    if (t.id === "bgblur") return composite(base, cut, (ctx, w, h, img) => {
      ctx.filter = `blur(${Math.round(Math.max(w, h) / 90)}px)`; ctx.drawImage(img, -20, -20, w + 40, h + 40); ctx.filter = "none";
    });
    return composite(base, cut, BG_FILLS[t.id]);
  }
  return null;
}
async function preview() {
  const t = sel && TOOL[sel]; if (!t || costOf(t) || t.kind === "crop") return;
  const token = ++previewToken, base = committed(), op = opFor(t);
  const slow = setTimeout(() => { if (token === previewToken) setBusy(true, t.kind === "face" || t.kind === "body" || t.kind === "hair" || t.kind === "bg" ? "Finding the details…" : "Working…"); }, 250);
  try {
    const out = await computeOp(op, base);
    if (token !== previewToken || sel !== t.id) return;
    ed.pending = out && out !== base ? { tool: t.id, data: out, op } : null;
    if (ed.pending) { if (ed.view === "original") ed.view = "edited"; $("alertLive").textContent = `${t.title} preview ready. Apply to keep it.`; }
  } catch (err) {
    if (token === previewToken) {
      ed.pending = null;
      // A face the reshape tools can't trust: say so in the panel instead of guessing.
      if (err.unavailable) reshapeNote = { tool: t.id, msg: err.message }; else say(err.message, true);
    }
  } finally {
    clearTimeout(slow);
    if (token === previewToken) { setBusy(false); renderEditor(); }
  }
}
function setBusy(on, text, note) {
  busyNow = on;
  $("busy").hidden = !on;
  if (text) $("busyText").textContent = text;
  $("busyNote").textContent = note || "";
  if (on) $("stage").setAttribute("aria-busy", "true"); else $("stage").removeAttribute("aria-busy");
  ["applyBtn", "cancelBtn", "undoBtn", "redoBtn", "saveBtn", "backBtn"].forEach((id) => { if (on) $(id).disabled = true; });
  if (!on) { $("cancelBtn").disabled = $("backBtn").disabled = false; renderEditor(); }
}

$("applyBtn").addEventListener("click", applyCurrent);
async function applyCurrent() {
  const t = sel && TOOL[sel]; if (!t || busyNow) return;
  // Sample: prepared previews are already showing. Nothing is generated or charged.
  if (ed.demo && t.kind === "ai") { if (demo && demo.failed[t.id]) showDemoPreview(t.id); else { sel = null; renderEditor(); } return; }
  const cost = costOf(t);
  if (t.kind === "crop") { if (cr && cropChanged()) await applyCrop(); return; }
  if (!cost) {
    let pend = ed.pending && ed.pending.tool === t.id ? ed.pending : null;
    if (!pend) {
      setBusy(true, "Working…");
      const op = opFor(t);
      try { const data = await computeOp(op, committed()); if (data && data !== committed()) pend = { data, op }; }
    catch (err) { if (err.unavailable) reshapeNote = { tool: t.id, msg: err.message }; say(err.message, true); } finally { setBusy(false); }
    }
    if (!pend) return;
    commit(pend.data, t, pend.op); sel = null; renderEditor();
    say(`${t.title} applied.`); Platform.haptic();
    return;
  }
  // AI: check the balance we know about first; the server makes the final call.
  if (account && account.remaining < cost) {
    if (account.plan === "pro") say("You've used this week's AI credits. Each one comes back 7 days after it was used.", true); else openPaywall();
    return;
  }
  if (jobActive()) { say(`${job.title} is still running. Check its status first.`, true); return; }
  await startAiEdit(t);
}


// Reshape tools first check that the face's landmarks can be trusted on this picture.
// null while checking, "" when fine, otherwise the reason shown in the panel.
async function checkReshape(id) {
  const base = committed();
  reshapeNote = { tool: id, msg: null }; renderPanel();
  let msg = "";
  try { msg = await reshapeStatus(base); } catch (err) { msg = err.message; }
  if (sel === id && committed() === base) { reshapeNote = { tool: id, msg }; renderPanel(); }
}

// ---------- Crop and rotate ----------
// The photo moves under a fixed frame. The crop is kept as a rectangle in the rotated
// photo's own pixels, so the frame on screen, the drag and zoom limits and the saved file
// all come from the same numbers. Applying records it as fractions of the photo, so Save
// can cut exactly the same area from the full-size original.
// Reopening Crop right after a crop shows the uncropped photo with that framing, so a crop
// can be widened again; applying then replaces the earlier crop instead of cropping twice.
const CROP_MARGIN = 20, CROP_MIN = 48, ZOOM_MAX = 8;
const aspectOf = (a) => (a === "free" ? 0 : a === 0 ? cr.W / cr.H : a);
function maxRect(asp) { return cr.W / cr.H > asp ? { w: cr.H * asp, h: cr.H } : { w: cr.W, h: cr.W / asp }; }
function rotatedCanvas(img, turns) {
  const q = ((turns % 4) + 4) % 4, W = img.naturalWidth, H = img.naturalHeight, c = newCanvas(q % 2 ? H : W, q % 2 ? W : H), x = c.getContext("2d");
  x.translate(c.width / 2, c.height / 2); x.rotate((q * Math.PI) / 2); x.drawImage(img, -W / 2, -H / 2);
  return c;
}
function setTurns(turns) {
  cr.turns = turns; cr.canvas = rotatedCanvas(cr.img, turns); cr.W = cr.canvas.width; cr.H = cr.canvas.height;
  const ci = $("cropImg"); ci.width = cr.W; ci.height = cr.H; ci.getContext("2d").drawImage(cr.canvas, 0, 0);
}
async function openCrop() {
  // Re-edit the last crop if that is what's showing, otherwise start on the current picture.
  const h = ed.hist[ed.idx], o = h.op;
  const bi = o && o.tool === "crop" && o.rect ? (o.base ?? ed.idx - 1) : -1;
  const reuse = bi >= 0 && ed.hist[bi] && ed.hist[bi].data;
  const base = reuse ? ed.hist[bi].data : committed(), id = sel;
  const img = await loadImg(base);
  if (sel !== id) return;
  cr = { base, baseIdx: reuse ? bi : null, img, aspect: 0, hint: true };
  setTurns(reuse ? o.turns : 0);
  if (reuse) { cr.aspect = o.aspectKey ?? "free"; cr.rect = { x: o.rect.x * cr.W, y: o.rect.y * cr.H, w: o.rect.w * cr.W, h: o.rect.h * cr.H }; }
  else cr.rect = { x: 0, y: 0, w: cr.W, h: cr.H };
  cr.start = cropKey();
  $("cropView").hidden = false; $("stage").classList.add("cropping"); $("cropHint").classList.remove("gone");
  setTimeout(hideCropHint, 5000);
  renderPanel(true); renderCrop();
}
function closeCrop() { cr = null; $("cropView").hidden = true; $("stage").classList.remove("cropping"); }
const cropKey = () => JSON.stringify([cr.turns % 4, cr.aspect, ...["x", "y", "w", "h"].map((k) => Math.round(cr.rect[k]))]);
const cropChanged = () => !!cr && (cropKey() !== cr.start || (cr.baseIdx === null && (cr.turns % 4 || cr.rect.w < cr.W - 0.5 || cr.rect.h < cr.H - 0.5)));
// Where things are on screen: frame F (stage pixels), scale k (screen px per photo px) and
// the photo's top-left t. Derived from the crop, except while a handle is being dragged.
function cropView() {
  if (cr.view) return cr.view;
  const st = $("stage"), aw = st.clientWidth - CROP_MARGIN * 2, ah = st.clientHeight - CROP_MARGIN * 2 - 24, r = cr.rect, asp = r.w / r.h;
  const w = Math.min(aw, ah * asp), h = w / asp, F = { x: (st.clientWidth - w) / 2, y: CROP_MARGIN + 24 + (ah - h) / 2, w, h };
  const k = w / r.w;
  return { F, k, t: { x: F.x - r.x * k, y: F.y - r.y * k } };
}
function renderCrop() {
  if (!cr) return;
  const { F, k, t } = cropView(), ci = $("cropImg"), bx = $("cropBox");
  Object.assign(ci.style, { left: t.x + "px", top: t.y + "px", width: cr.W * k + "px", height: cr.H * k + "px" });
  Object.assign(bx.style, { left: F.x + "px", top: F.y + "px", width: F.w + "px", height: F.h + "px" });
  bx.classList.toggle("small", Math.min(F.w, F.h) < 120);
  const z = $("cropZoom");
  if (z && document.activeElement !== z) { const v = Math.round(cropZoom() * 100); z.value = v; z.nextElementSibling.textContent = (v / 100).toFixed(1) + "×"; z.setAttribute("aria-valuetext", `${(v / 100).toFixed(1)} times`); }
  panelState(TOOL.crop);
}
function cropZoom() { const m = maxRect(cr.rect.w / cr.rect.h); return m.w / cr.rect.w; }
// Keeps the crop inside the photo (so the result never has blank edges) and within zoom limits.
function clampCrop() {
  const r = cr.rect, m = maxRect(r.w / r.h);
  let s = Math.min(1, m.w / r.w); const minW = Math.max(m.w / ZOOM_MAX, 16);
  if (r.w * s < minW) s = minW / r.w;
  const cx = r.x + r.w / 2, cy = r.y + r.h / 2; r.w *= s; r.h *= s; r.x = cx - r.w / 2; r.y = cy - r.h / 2;
  r.x = Math.max(0, Math.min(cr.W - r.w, r.x)); r.y = Math.max(0, Math.min(cr.H - r.h, r.y));
}
function panCrop(dx, dy) { const { k } = cropView(); cr.rect.x -= dx / k; cr.rect.y -= dy / k; clampCrop(); renderCrop(); }
// Zooms by `f` keeping the photo point under screen point (sx, sy) where it is.
function zoomCrop(f, sx, sy) {
  const { F, k, t } = cropView(), r = cr.rect, m = maxRect(r.w / r.h);
  const nw = Math.max(m.w / ZOOM_MAX, Math.min(m.w, r.w / f)), k2 = F.w / nw;
  const ix = (sx - t.x) / k, iy = (sy - t.y) / k;
  r.w = nw; r.h = F.h / k2; r.x = ix - (sx - F.x) / k2; r.y = iy - (sy - F.y) / k2;
  clampCrop(); renderCrop();
}
function hideCropHint() { if (cr && cr.hint) { cr.hint = false; $("cropHint").classList.add("gone"); } }
function setCropAspect(a) {
  const z = cropZoom(), cx = cr.rect.x + cr.rect.w / 2, cy = cr.rect.y + cr.rect.h / 2;
  cr.aspect = a;
  if (a !== "free") { const m = maxRect(aspectOf(a)); cr.rect = { w: m.w / z, h: m.h / z, x: cx - m.w / z / 2, y: cy - m.h / z / 2 }; }
  clampCrop(); settleCrop(); renderPanel(true); renderCrop();
}
function rotateCrop() {
  const r = cr.rect, oldH = cr.H, z = cropZoom();
  setTurns(cr.turns + 1);
  // A quarter turn clockwise: photo point (x, y) goes to (oldH - y, x).
  cr.rect = { x: oldH - (r.y + r.h), y: r.x, w: r.h, h: r.w };
  if (typeof cr.aspect === "number" && cr.aspect !== 0 && cr.aspect !== 1) {
    // A chosen shape (4:5, 9:16…) stays that shape; re-fit it around the same spot.
    const m = maxRect(cr.aspect), cx = cr.rect.x + cr.rect.w / 2, cy = cr.rect.y + cr.rect.h / 2;
    cr.rect = { w: m.w / z, h: m.h / z, x: cx - m.w / z / 2, y: cy - m.h / z / 2 };
  }
  clampCrop(); renderCrop();
  $("alertLive").textContent = `Rotated to ${(cr.turns % 4) * 90} degrees.`;
}
function resetCrop() {
  setTurns(0); cr.aspect = 0; cr.rect = { x: 0, y: 0, w: cr.W, h: cr.H };
  settleCrop(); renderPanel(true); renderCrop(); $("alertLive").textContent = "Framing reset.";
}
function settleCrop() { const v = $("cropView"); v.classList.add("settle"); clearTimeout(settleCrop.t); settleCrop.t = setTimeout(() => v.classList.remove("settle"), 220); }
// Dragging a corner or edge moves the frame over the photo, which stays still. The frame
// can't leave the photo or the canvas; a chosen shape keeps its proportions. On release
// the frame grows back to fill the canvas, showing the same area larger.
function resizeCrop(h, g, x, y) {
  const { F, k, t } = g.view, st = $("stage");
  const lim = { l: Math.max(t.x, 4), t: Math.max(t.y, 4), r: Math.min(t.x + cr.W * k, st.clientWidth - 4), b: Math.min(t.y + cr.H * k, st.clientHeight - 4) };
  const dx = x - g.x, dy = y - g.y, asp = cr.aspect === "free" ? 0 : F.w / F.h;
  let L = F.x, T = F.y, R = F.x + F.w, B = F.y + F.h;
  if (!asp) {
    if (h.includes("w")) L = Math.max(lim.l, Math.min(R - CROP_MIN, L + dx));
    if (h.includes("e")) R = Math.min(lim.r, Math.max(L + CROP_MIN, R + dx));
    if (h.includes("n")) T = Math.max(lim.t, Math.min(B - CROP_MIN, T + dy));
    if (h.includes("s")) B = Math.min(lim.b, Math.max(T + CROP_MIN, B + dy));
  } else if (h.length === 2) {
    // Corner: the opposite corner stays put; the larger of the two movements wins.
    const ax = h.includes("w") ? R : L, ay = h.includes("n") ? B : T, sx = h.includes("w") ? -1 : 1, sy = h.includes("n") ? -1 : 1;
    let w = Math.max(F.w + sx * dx, (F.h + sy * dy) * asp);
    const wmax = Math.min(sx > 0 ? lim.r - ax : ax - lim.l, (sy > 0 ? lim.b - ay : ay - lim.t) * asp);
    w = Math.max(Math.max(CROP_MIN, CROP_MIN * asp), Math.min(wmax, w));
    const hh = w / asp; L = sx > 0 ? ax : ax - w; R = L + w; T = sy > 0 ? ay : ay - hh; B = T + hh;
  } else {
    // Edge: that edge moves, the frame stays centred the other way.
    const cx = (L + R) / 2, cy = (T + B) / 2, horiz = h === "e" || h === "w";
    let w = horiz ? F.w + (h === "e" ? dx : -dx) : (F.h + (h === "s" ? dy : -dy)) * asp;
    const wmax = horiz ? Math.min(h === "e" ? lim.r - L : R - lim.l, 2 * Math.min(cy - lim.t, lim.b - cy) * asp)
      : Math.min(2 * Math.min(cx - lim.l, lim.r - cx), (h === "s" ? lim.b - T : B - lim.t) * asp);
    w = Math.max(Math.max(CROP_MIN, CROP_MIN * asp), Math.min(wmax, w));
    const hh = w / asp;
    if (horiz) { if (h === "e") R = L + w; else L = R - w; T = cy - hh / 2; B = cy + hh / 2; }
    else { if (h === "s") B = T + hh; else T = B - hh; L = cx - w / 2; R = cx + w / 2; }
  }
  const nF = { x: L, y: T, w: R - L, h: B - T };
  cr.view = { F: nF, k, t };
  cr.rect = { x: (nF.x - t.x) / k, y: (nF.y - t.y) / k, w: nF.w / k, h: nF.h / k };
  renderCrop();
}
{
  const view = $("cropView"), ptrs = new Map();
  let handle = null;
  view.addEventListener("pointerdown", (e) => {
    if (!cr || e.button > 0) return;
    e.preventDefault(); view.focus({ preventScroll: true }); hideCropHint();
    const h = e.target.closest(".crop-h");
    if (h) { handle = { h: h.dataset.h, x: e.clientX, y: e.clientY, view: cropView(), id: e.pointerId }; h.setPointerCapture(e.pointerId); return; }
    view.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, [e.clientX, e.clientY]);
  });
  // Each gesture is measured from where it started (re-based whenever a finger is added or
  // lifted), so pushing against an edge and coming back feels natural, and a pinch keeps
  // the photo point under the fingers' midpoint exactly there.
  let g0 = null;
  const rebase = () => {
    const pts = [...ptrs.values()];
    g0 = !pts.length ? null : { rect: { ...cr.rect }, view: cropView(), pts,
      mid: pts.length > 1 ? [(pts[0][0] + pts[1][0]) / 2, (pts[0][1] + pts[1][1]) / 2] : pts[0],
      gap: pts.length > 1 ? Math.hypot(pts[0][0] - pts[1][0], pts[0][1] - pts[1][1]) : 0 };
  };
  view.addEventListener("pointerdown", () => { if (cr && ptrs.size) rebase(); });
  view.addEventListener("pointermove", (e) => {
    if (!cr) return;
    if (handle && e.pointerId === handle.id) { resizeCrop(handle.h, handle, e.clientX, e.clientY); return; }
    if (!ptrs.has(e.pointerId) || !g0) return;
    ptrs.set(e.pointerId, [e.clientX, e.clientY]);
    const now = [...ptrs.values()].slice(0, 2), { F, k, t } = g0.view, sr = $("stage").getBoundingClientRect();
    const mid = now.length > 1 ? [(now[0][0] + now[1][0]) / 2, (now[0][1] + now[1][1]) / 2] : now[0];
    const f = now.length > 1 && g0.gap > 0 ? Math.hypot(now[0][0] - now[1][0], now[0][1] - now[1][1]) / g0.gap : 1;
    const m = maxRect(g0.rect.w / g0.rect.h), w = Math.max(m.w / ZOOM_MAX, Math.min(m.w, g0.rect.w / f)), k2 = F.w / w;
    // The photo point that was under the starting midpoint goes under the current one.
    const ix = (g0.mid[0] - sr.left - t.x) / k, iy = (g0.mid[1] - sr.top - t.y) / k;
    cr.rect = { w, h: F.h / k2, x: ix - (mid[0] - sr.left - F.x) / k2, y: iy - (mid[1] - sr.top - F.y) / k2 };
    clampCrop(); renderCrop();
  });
  const end = (e) => {
    if (handle && e.pointerId === handle.id) { handle = null; if (cr) { cr.view = null; settleCrop(); renderCrop(); } return; }
    if (ptrs.delete(e.pointerId) && cr) rebase();
  };
  view.addEventListener("pointerup", end); view.addEventListener("pointercancel", end);
  view.addEventListener("wheel", (e) => {
    if (!cr) return;
    e.preventDefault(); hideCropHint();
    const sr = $("stage").getBoundingClientRect(), d = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    zoomCrop(Math.exp(-d * (e.ctrlKey ? 0.01 : 0.0015)), e.clientX - sr.left, e.clientY - sr.top);
  }, { passive: false });
  view.addEventListener("keydown", (e) => {
    if (!cr) return;
    const s = e.shiftKey ? 40 : 8, { F } = cropView(), k = e.key;
    if (k === "ArrowLeft") panCrop(s, 0); else if (k === "ArrowRight") panCrop(-s, 0);
    else if (k === "ArrowUp") panCrop(0, s); else if (k === "ArrowDown") panCrop(0, -s);
    else if (k === "+" || k === "=") zoomCrop(1.1, F.x + F.w / 2, F.y + F.h / 2);
    else if (k === "-" || k === "_") zoomCrop(1 / 1.1, F.x + F.w / 2, F.y + F.h / 2);
    else return;
    e.preventDefault(); hideCropHint();
  });
}
function cropOp() {
  const r = cr.rect, asp = cr.aspect === "free" ? 0 : r.w / r.h;
  const op = { tool: "crop", turns: cr.turns % 4, rect: { x: r.x / cr.W, y: r.y / cr.H, w: r.w / cr.W, h: r.h / cr.H }, aspect: asp, aspectKey: cr.aspect };
  if (cr.baseIdx !== null) op.base = cr.baseIdx;
  return op;
}
async function applyCrop() {
  const t = TOOL.crop, op = cropOp();
  setBusy(true, "Working…");
  try {
    const data = await computeOp(op, cr.base);
    if (!data) return;
    closeCrop(); commit(data, t, op); sel = null; renderEditor();
    say(`${t.title} applied.`); Platform.haptic();
  } catch (err) { say(err.message, true); } finally { setBusy(false); }
}

// ---------- AI jobs ----------
// A paid AI edit is started exactly once. Its job id, plus a request id of our own, are
// saved on the device, so a timeout, a refresh, the app going to the background or a
// dropped connection only means asking for its status again. Checking is free and
// never starts another paid request. The result goes back into the session it came from.
let job = null;        // { requestId, id, tool, title, session, baseIdx, status, startedAt, error, refunded, result }
let recovered = null;  // a finished result whose editing session is gone
let following = false;
const JOB_TEXT = { starting: "is starting…", processing: "is still being made…", unknown: "couldn't be confirmed.", failed: "failed.", done: "is ready." };
const JOB_SHORT = { starting: "starting", processing: "still processing", unknown: "status unknown", failed: "failed", done: "ready" };
const jobActive = () => !!job && ["starting", "processing", "unknown"].includes(job.status);
const saveJob = () => { (job ? Drafts.putJob(job) : Drafts.clearJob()).catch(() => {}); renderJob(); if (screen === "editorHome") renderHome(); };
const rid = () => (crypto.randomUUID ? crypto.randomUUID() : newSession() + newSession());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function startAiEdit(t) {
  if (ed.demo) return; // never: the sample has no paid path at all
  const before = account ? account.remaining : null;
  setBusy(true, `${t.title}…`, "AI edits can take up to a minute.");
  $("alertLive").textContent = `${t.title} is running.`;
  let body;
  try {
    const base = committed();
    if (t.id === "erase") {
      const up = await uploadable(base), dims = await loadImg(up);
      body = { image: up, mode: "erase", mask: eraseMask(dims.naturalWidth, dims.naturalHeight) };
    } else if (t.id === "expand") {
      const x = await expandInputs(base); body = { image: x.image, mode: "expand", mask: x.mask };
    } else body = { image: await uploadable(base), mode: t.id, extra: t.id === "outfit" ? outfitData : undefined };
  } catch (err) { setBusy(false); say(err.message, true); return; }
  job = { requestId: rid(), id: null, tool: t.id, title: t.title, session: ed.session, baseIdx: ed.idx, status: "starting", startedAt: Date.now(), before };
  saveJob();
  let res;
  try {
    res = await call("enhance", { method: "POST", body: JSON.stringify({ ...body, request_id: job.requestId }) });
  } catch (err) {
    setBusy(false);
    if (err.status) {
      // The server answered, so the edit didn't start. It returns the credit itself if it had taken one.
      job = null; saveJob();
      if (err.limit) { say(err.message, true); if (!account || account.plan !== "pro") openPaywall(); renderPanel(); return; }
      await refreshAccount();
      const extra = before != null && account ? (account.remaining >= before ? " No AI credit was used." : ` Your balance shows ${account.remaining} left.`) : "";
      say(err.message + extra, true);
      return;
    }
    // No answer: the edit may or may not have started. Don't send it again.
    job.status = "unknown"; job.error = "The connection dropped before Glow heard back."; saveJob();
    return;
  }
  if (t.id === "erase") strokes = [];
  job.id = res.id; job.status = "processing"; saveJob();
  await followJob(res, 60000, true);
}

// Polls the job. The first minute keeps the photo busy; after that the editor is free
// and polling continues in the bar for up to 10 minutes, then waits for Check status.
async function followJob(first, blockMs, blocking) {
  if (following || !job) return;
  following = true;
  const started = Date.now(), mine = job;
  let res = first;
  try {
    while (job === mine) {
      if (res && ["succeeded", "failed", "canceled"].includes(res.status)) { await settleJob(res); return; }
      if (blocking && Date.now() - started > blockMs) { blocking = false; setBusy(false); say(`${mine.title} is taking a while. You can keep editing; it will be added when it's ready.`); }
      if (Date.now() - started > 600000) { mine.status = "processing"; saveJob(); return; }
      if (blocking) $("busyText").textContent = res && res.status === "starting" ? "Warming up the model…" : `${mine.title}…`;
      await sleep(blocking ? 1500 : 4000);
      if (document.hidden) { mine.status = "processing"; saveJob(); return; } // checked again on return
      const q = mine.id ? "id=" + encodeURIComponent(mine.id) : "request=" + encodeURIComponent(mine.requestId);
      try { res = await call("enhance?" + q, { method: "GET" }); if (res.id) mine.id = res.id; mine.status = "processing"; }
      catch { mine.status = "unknown"; mine.error = "Glow couldn't reach its server to check."; saveJob(); return; }
    }
  } finally {
    following = false;
    if (blocking) setBusy(false);
    renderJob();
  }
}

// A free status check. Never starts a new paid request.
async function checkJob() {
  if (!job || following) return;
  const mine = job;
  if (mine.id) { mine.status = "processing"; renderJob(); return followJob(null, 0, false); }
  // We never got a job id: ask the server by our request id (needs the backend update).
  let res;
  try { res = await call("enhance?request=" + encodeURIComponent(mine.requestId), { method: "GET" }); }
  catch (err) {
    if (err.status === 404) { job = null; saveJob(); say(`${mine.title} never started, so no AI credit was used.`); return; }
    mine.status = "unknown";
    mine.error = err.status === 400 ? "Glow's server can't look up this edit yet." : "Glow couldn't reach its server to check.";
    saveJob(); await refreshAccount(); renderJob(); return;
  }
  mine.id = res.id || null; mine.status = "processing"; saveJob();
  return followJob(res, 0, false);
}

async function settleJob(res) {
  const mine = job;
  if (res.status !== "succeeded" || !res.output) {
    mine.status = "failed"; mine.error = res.error || "The AI service couldn't process this photo."; mine.refunded = res.refunded === true;
    saveJob(); await refreshAccount(); renderJob();
    $("alertLive").textContent = `${mine.title} failed.`;
    return;
  }
  let full;
  try {
    const r = await fetch(res.output); if (!r.ok) throw new Error();
    full = await blobToData(await r.blob());
  } catch { mine.status = "unknown"; mine.error = "The result couldn't be downloaded yet."; saveJob(); return; }
  const data = await shrinkData(full, 2048);
  const op = { tool: mine.tool, fixed: true };
  if (mine.session === ed.session && hasPhoto() && ed.idx === mine.baseIdx) {
    job = null; saveJob();
    commit(data, TOOL[mine.tool], op, full); if (sel === mine.tool) sel = null;
    renderEditor(); say(`${mine.title} done. Drag the line to compare.`); Platform.haptic();
  } else if (mine.session === ed.session && hasPhoto()) {
    mine.status = "done"; mine.result = { data, full }; saveJob();
  } else {
    recovered = { title: mine.title, data, full }; job = null; saveJob();
    Drafts.putRecovered(recovered).catch(() => {}); if (screen === "editorHome") renderHome();
    say(`${mine.title} is ready. Find it on the Editor screen.`);
  }
}
const blobToData = (b) => new Promise((ok, fail) => { const fr = new FileReader(); fr.onload = () => ok(fr.result); fr.onerror = fail; fr.readAsDataURL(b); });

function renderJob() {
  const bar = $("jobBar");
  const show = !!job && job.session === ed.session && screen === "editorScreen";
  bar.hidden = !show;
  if (!show) return;
  const working = job.status === "starting" || (job.status === "processing" && following);
  $("jobSpin").hidden = !working;
  let text = `${job.title} ${JOB_TEXT[job.status] || ""}`;
  if (job.status === "processing" && !following) text = `${job.title} may still be processing.`;
  if (job.status === "unknown") text += ` ${job.error || ""} Glow won't charge you again to check.`;
  if (job.status === "failed") text += ` ${job.error}` + (job.refunded ? " Glow's server returned the AI credit." : account ? ` Your balance shows ${balanceText(account)}.` : "");
  if (job.status === "done") text += " It was made from an earlier version of this photo.";
  $("jobText").textContent = text;
  const btn = (label, fn, kind) => { const b = document.createElement("button"); b.className = "btn small " + (kind || "quiet"); b.textContent = label; b.addEventListener("click", fn); return b; };
  const acts = [];
  if (job.status === "unknown" || (job.status === "processing" && !following)) acts.push(btn("Check status", () => checkJob()));
  if (job.status === "done") acts.push(btn("Use it", () => {
    const r = job.result, t = TOOL[job.tool]; job = null; saveJob();
    commit(r.data, t, { tool: t.id, fixed: true }, r.full); renderEditor(); say(`${t.title} added. Undo removes it.`);
  }, ""));
  if (job.status === "failed" || job.status === "done" || job.status === "unknown") acts.push(btn("Dismiss", () => { job = null; saveJob(); }, "ghost"));
  $("jobActions").replaceChildren(...acts);
}
document.addEventListener("visibilitychange", () => { if (!document.hidden && job && job.status === "processing" && !following) checkJob(); });
window.addEventListener("online", () => { if (jobActive() && !following) checkJob(); });

// Magic-erase brush: strokes are kept in the committed photo's pixel coordinates.
function imageRect() {
  const img = $("before"), st = $("stage").getBoundingClientRect();
  const s = Math.min(st.width / img.naturalWidth, st.height / img.naturalHeight);
  const w = img.naturalWidth * s, h = img.naturalHeight * s;
  return { x: (st.width - w) / 2, y: (st.height - h) / 2, s, nw: img.naturalWidth, nh: img.naturalHeight };
}
function drawStrokes() {
  const cv = $("brush"), st = $("stage").getBoundingClientRect(), dpr = devicePixelRatio || 1;
  cv.width = st.width * dpr; cv.height = st.height * dpr;
  if (!hasPhoto() || !$("before").naturalWidth) return;
  const ctx = cv.getContext("2d"), r = imageRect();
  ctx.scale(dpr, dpr);
  ctx.strokeStyle = "rgba(255,80,120,0.55)"; ctx.lineCap = ctx.lineJoin = "round";
  for (const s of strokes) {
    ctx.lineWidth = s.w * r.s; ctx.beginPath();
    s.pts.forEach(([x, y], i) => (i ? ctx.lineTo : ctx.moveTo).call(ctx, r.x + x * r.s, r.y + y * r.s));
    if (s.pts.length === 1) ctx.lineTo(r.x + s.pts[0][0] * r.s + 0.1, r.y + s.pts[0][1] * r.s);
    ctx.stroke();
  }
}
function brushPoint(e) {
  const st = $("stage").getBoundingClientRect(), r = imageRect();
  return [(e.clientX - st.left - r.x) / r.s, (e.clientY - st.top - r.y) / r.s];
}
$("brush").addEventListener("pointerdown", (e) => {
  e.stopPropagation(); painting = true; $("brush").setPointerCapture(e.pointerId);
  strokes.push({ w: 28 / imageRect().s, pts: [brushPoint(e)] }); drawStrokes();
});
$("brush").addEventListener("pointermove", (e) => { if (!painting) return; strokes[strokes.length - 1].pts.push(brushPoint(e)); drawStrokes(); });
["pointerup", "pointercancel"].forEach((ev) => $("brush").addEventListener(ev, () => { if (painting) { painting = false; renderPanel(); } }));
// The mask is drawn at the size of the image that is uploaded.
function eraseMask(w, h) {
  const r = imageRect(), k = w / r.nw, c = newCanvas(w, h), ctx = c.getContext("2d");
  ctx.fillStyle = "#000"; ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = "#fff"; ctx.lineCap = ctx.lineJoin = "round";
  for (const s of strokes) {
    ctx.lineWidth = s.w * 1.15 * k; ctx.beginPath();
    s.pts.forEach(([x, y], i) => (i ? ctx.lineTo : ctx.moveTo).call(ctx, x * k, y * k));
    if (s.pts.length === 1) ctx.lineTo(s.pts[0][0] * k + 0.1, s.pts[0][1] * k);
    ctx.stroke();
  }
  return c.toDataURL("image/png");
}
window.addEventListener("resize", () => { if (sel === "erase") drawStrokes(); });

// ---------- Save and leave ----------
// Saving redoes every step from the full-size original (or the latest AI result, at the size
// the AI returned it) instead of exporting the 2048px preview. Nothing is ever upscaled.
const EXPORT_AREA = 16e6, EXPORT_SIDE = 8192; // below iOS's canvas limit of 16.7 megapixels
function exportFit(w, h) { const s = Math.min(1, EXPORT_SIDE / Math.max(w, h), Math.sqrt(EXPORT_AREA / (w * h))); return { w: Math.round(w * s), h: Math.round(h * s), capped: s < 1 }; }
async function exportBase(src, png) {
  const url = src instanceof Blob ? URL.createObjectURL(src) : src;
  try {
    const img = await loadImg(url), f = exportFit(img.naturalWidth, img.naturalHeight);
    const c = newCanvas(f.w, f.h); c.getContext("2d").drawImage(img, 0, 0, f.w, f.h);
    return { data: png ? c.toDataURL("image/png") : c.toDataURL("image/jpeg", 0.95), capped: f.capped, srcW: img.naturalWidth, srcH: img.naturalHeight };
  } finally { if (src instanceof Blob) URL.revokeObjectURL(url); }
}
async function renderExport() {
  const steps = ed.hist.slice(0, ed.idx + 1);
  let k = 0;
  for (let i = steps.length - 1; i >= 1; i--) if (steps[i].op && steps[i].op.fixed) { k = i; break; }
  const from = k ? steps[k].full || steps[k].data : (ed.original && ed.original.blob) || steps[0].data;
  const png = from instanceof Blob ? from.type === "image/png" : isPng(from);
  const base = await exportBase(from, png);
  let data = base.data;
  const keep = IMG_MAX; IMG_MAX = EXPORT_SIDE;
  try {
    const keepFor = new Set(steps.map((s) => s.op && s.op.base).filter((b) => b != null)), kept = { [k]: data };
    for (let i = k + 1; i < steps.length; i++) {
      const op = steps[i].op, from = op && op.base != null && kept[op.base] !== undefined ? kept[op.base] : data;
      const out = await computeOp(op, from); if (out) data = out; else data = from;
      if (keepFor.has(i)) kept[i] = data;
    }
  } finally { IMG_MAX = keep; }
  const img = await loadImg(data);
  return { data, w: img.naturalWidth, h: img.naturalHeight, capped: base.capped, ai: k && steps[k].op.tool !== "camlook" ? TOOL[steps[k].op.tool] : null };
}
function exportNote(r) {
  if (r.preview) return ` Saved at ${r.w} × ${r.h}, the preview size, because the full-size version couldn't be made on this device.`;
  if (r.ai && ed.demo) return ` Saved at ${r.w} × ${r.h}, the prepared preview's size.`;
  if (r.ai) return ` Saved at ${r.w} × ${r.h}, the size ${r.ai.title} returned.`;
  if (r.capped) return ` Saved at ${r.w} × ${r.h}, Glow's 16-megapixel limit.`;
  return ` Saved at ${r.w} × ${r.h}.`;
}
async function saveEdit() {
  if (ed.pending) {
    const t = TOOL[ed.pending.tool];
    const c = await ask({ title: `Apply ${t.title} before saving?`, text: "This change is only a preview so far.", actions: [
      { label: "Apply and save", value: "apply" }, { label: "Save without it", value: "skip", kind: "ghost" }, { label: "Keep editing", value: "", kind: "ghost" }] });
    if (!c) return false;
    if (c === "apply") { commit(ed.pending.data, t, ed.pending.op); sel = null; } else { discardPending(); sel = null; }
    renderEditor();
  }
  if (ed.idx === 0) { say("Nothing to save yet. Apply a tool first."); return false; }
  if (savingEdit) return false;
  if (ed.demo) {
    const op = ed.hist[ed.idx].op, prep = op && op.demo ? TOOL[op.tool].title : "";
    const c = await ask({ title: prep ? "Save this prepared preview?" : "Save the AI-generated sample?",
      text: prep ? `A prepared preview of Glow's ${prep} tool on the AI-generated sample photo. It isn't a real person. The file name marks it as a prepared preview.`
        : "This is Glow's sample photo, made with AI. It isn't a real person. The file name marks it as a sample.",
      actions: [{ label: "Save sample", value: "yes" }, { label: "Cancel", value: "", kind: "ghost" }] });
    if (!c) return false;
  }
  savingEdit = true;
  setBusy(true, "Preparing the full-size photo…");
  let out;
  try { out = await renderExport(); }
  catch {
    out = null;
  } finally { setBusy(false); }
  if (!out) {
    const c = await ask({ title: "Couldn't make the full-size photo", text: "This device ran out of room while redoing your edits at full size. You can save the preview size instead.",
      actions: [{ label: "Save preview size", value: "preview" }, { label: "Cancel", value: "", kind: "ghost" }] });
    if (!c) { savingEdit = false; return false; }
    const img = await loadImg(committed());
    out = { data: committed(), w: img.naturalWidth, h: img.naturalHeight, preview: true };
  }
  const stamp = Date.now(), items = [{ data: out.data, name: ed.demo ? `glow-ai-sample-${demoSaveTag()}${stamp}` : `glow-${stamp}` }];
  const withOrig = !ed.demo && store.get("glowSaveOrig") === "on" && !ed.originalSaved && ed.original && ed.original.blob;
  if (withOrig) items.unshift({ blob: ed.original.blob, name: `glow-${stamp}-original` });
  try {
    const where = await Platform.savePhotos(items);
    ed.savedIdx = ed.idx; if (withOrig) ed.originalSaved = true;
    ed.lastExport = { w: out.w, h: out.h, original: ed.original ? [ed.original.w, ed.original.h] : null };
    saveDraft(); renderEditor();
    say(savedText(where, items.length, exportNote(out)));
    return true;
  } catch (err) {
    if (err && err.name === "AbortError") return false;
    say(saveFailText(), true);
    return false;
  } finally { savingEdit = false; }
}
$("saveBtn").addEventListener("click", saveEdit);
// Back keeps the session; it's waiting on the Editor landing under "Continue editing".
$("backBtn").addEventListener("click", () => { discardPending(); sel = null; go("editor"); });

// ---------- Credits ----------
let account = null;
function balanceText(a) { const n = a.remaining; return `${n} AI credit${n === 1 ? "" : "s"} left ${a.plan === "pro" ? "this week" : "today"}`; }
function nextUtcMidnight() { const d = new Date(); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1)); }
// A compact chip under the photo; the demo says "Demo · No credits used" in its own bar instead.
function renderCredits() {
  const a = account, chip = $("balanceBtn");
  chip.hidden = !a || (ed.demo && screen === "editorScreen"); $("homeCredits").hidden = !a;
  if (!a) return;
  const n = a.remaining;
  chip.innerHTML = `<span>${icon("sparkle")}${n} AI credit${n === 1 ? "" : "s"}</span>`;
  chip.setAttribute("aria-label", `${balanceText(a)}. Details`);
  $("homeCredits").innerHTML = icon("sparkle") + `<span>${balanceText(a)}. On-device tools are always free.</span>` + icon("chevron");
}
function renderCreditsSheet() {
  const a = account, p = (h) => `<p>${h}</p>`;
  let html = "";
  if (!a) html = p("Your balance will show once Glow can reach its server.");
  else if (a.plan === "pro") {
    html = p(`<b>${a.remaining} of ${a.quota} AI credits left.</b>`) +
      p("Glow Pro includes 40 AI credits each week. Each credit comes back 7 days after you use it. Unused credits don't carry over.");
  } else {
    const r = nextUtcMidnight(), mins = Math.max(1, Math.round((r - Date.now()) / 60000));
    const left = mins >= 60 ? `${Math.floor(mins / 60)} h ${mins % 60} min` : `${mins} min`;
    html = p(`<b>${a.remaining} of ${a.quota} AI credits left today.</b>`) +
      p(`You get 3 AI credits a day. They reset at midnight UTC, which is ${fmtTime(r)} your time (in ${left}). Unused credits don't carry over.`);
    if (native && plugins.AdMob && a.adsLeft > 0) html += p(`Out of credits? You can watch a short ad for 1 more credit, up to ${a.adsLeft} more today. Ads are always optional.`);
  }
  html += p("Most AI tools use 1 credit. Headshot, Fashion, Anime and Watercolor use 2. Each tool shows its cost before you apply it.") +
    p("The camera, filters, face, makeup, body, hair color, background, light and color tools run on your device and are always free. Undo and redo never use credits.") +
    p("If the AI service reports that an edit failed, its credit is returned automatically.");
  $("creditsBody").innerHTML = html;
  $("creditsPro").hidden = !!(a && a.plan === "pro");
}
function openCredits() { refreshAccount(); renderCreditsSheet(); $("creditsSheet").showModal(); }
$("balanceBtn").addEventListener("click", openCredits);
$("homeCredits").addEventListener("click", openCredits);
$("creditsPro").addEventListener("click", () => { $("creditsSheet").close(); openPaywall(); });

function showUsage(u) {
  account = { ...(account || {}), ...u };
  $("planLine").textContent = account.plan === "pro"
    ? `Glow Pro: ${account.remaining} of ${account.quota} AI credits left this week.`
    : `Free plan: ${account.remaining} of ${account.quota} AI credits left today. On-device tools are always free.`;
  $("goProBtn").hidden = account.plan === "pro";
  renderCredits();
  if (screen === "editorScreen") { renderPanel(); }
  if ($("creditsSheet").open) renderCreditsSheet();
}
async function refreshAccount() {
  try { showUsage(await call("account", { method: "GET" })); } catch {}
}

// ---------- Server ----------
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

// ---------- Camera ----------
// Looks: one-tap beauty settings, remembered between sessions.
const PRESET_LOOKS = [
  { id: "original", name: "Original", smooth: 0, bright: 0, warm: 0, filter: "none" },
  { id: "natural", name: "Natural", smooth: 25, bright: 15, warm: 10, filter: "none" },
  { id: "softglam", name: "Soft Glam", smooth: 55, bright: 30, warm: 25, filter: "glow" },
  { id: "glam", name: "Glam", smooth: 75, bright: 40, warm: 35, filter: "warm" },
];
const beauty = { ...PRESET_LOOKS[1] };
let myLooks = [];
try { myLooks = JSON.parse(store.get("glowLooks") || "[]"); } catch {}
let lookId = store.get("glowLook") || "natural";
if (lookId === "bare") lookId = "original";
const allLooks = () => [...PRESET_LOOKS, ...myLooks];
// Looks offered in the Editor: presets, saved looks, and unsaved camera settings.
const editorLooks = () => [...allLooks().filter((l) => l.id !== "original"), ...(lookId === "custom" ? [{ id: "custom", name: "Camera settings", ...beauty }] : [])];
try {
  const l = allLooks().find((x) => x.id === lookId);
  Object.assign(beauty, l || JSON.parse(store.get("glowBeauty") || "{}"));
} catch {}
const lookName = () => (allLooks().find((l) => l.id === lookId) || { name: "Custom look" }).name;
function saveBeauty() { store.set("glowBeauty", JSON.stringify(beauty)); store.set("glowLook", lookId); store.set("glowLooks", JSON.stringify(myLooks)); }
function useLook(l) { lookId = l.id; Object.assign(beauty, { smooth: l.smooth, bright: l.bright, warm: l.warm, filter: l.filter }); saveBeauty(); renderLooks(); }

const cam = { stream: null, facing: store.get("glowFacing") || "user", gl: null, raf: 0, state: "", torch: false, shot: null, thumb: "", gen: 0, opened: 0 };
const isOriginalLook = () => !beauty.smooth && !beauty.bright && !beauty.warm && beauty.filter === "none";
function renderLooks() {
  const live = !!cam.gl;
  $("camLooks").hidden = !live;
  ["sSmooth", "sBright", "sWarm"].forEach((id, i) => { const v = beauty[["smooth", "bright", "warm"][i]]; $(id).value = v; $(id).nextElementSibling.textContent = v; $(id).setAttribute("aria-valuetext", `${v} percent`); });
  const flt = FILTERS.find((f) => f.id === beauty.filter) || FILTERS[0];
  $("camCanvas").style.filter = flt.f === "none" ? "" : flt.f;
  const chip = (text, on, cls, fn) => {
    const b = document.createElement("button"); b.className = "look" + (cls ? " " + cls : ""); b.textContent = text;
    if (on != null) b.setAttribute("aria-pressed", String(on));
    b.addEventListener("click", fn); return b;
  };
  const adjustBtn = chip("Adjust", null, "adjust", () => {
    const open = $("adjustPanel").hidden; $("adjustPanel").hidden = !open; adjustBtn.setAttribute("aria-expanded", String(open));
  });
  adjustBtn.insertAdjacentHTML("afterbegin", icon("sliders"));
  adjustBtn.setAttribute("aria-expanded", String(!$("adjustPanel").hidden)); adjustBtn.setAttribute("aria-controls", "adjustPanel");
  $("camLooks").replaceChildren(
    ...allLooks().map((l) => chip(l.name, l.id === lookId, "", async () => {
      if (l.id === lookId && l.id.startsWith("my")) {
        if (await ask({ title: `Delete "${l.name}"?`, actions: [{ label: "Delete look", value: "yes" }, { label: "Keep it", value: "", kind: "ghost" }] })) {
          myLooks = myLooks.filter((m) => m.id !== l.id); useLook(PRESET_LOOKS[1]);
        }
        return;
      }
      Platform.haptic(); useLook(l);
    })),
    ...(lookId === "custom" ? [chip("Custom", true, "", () => {}), chip("Save look", null, "add", () => {
      const n = myLooks.length ? `My Look ${myLooks.length + 1}` : "My Look";
      const l = { id: "my" + Date.now(), name: n, smooth: beauty.smooth, bright: beauty.bright, warm: beauty.warm, filter: beauty.filter };
      myLooks = [...myLooks, l].slice(-4); useLook(l); say(`Saved as "${n}". It's also in Editor under My Look.`);
    })] : []),
    adjustBtn,
  );
  $("camFilters").replaceChildren(...FILTERS.map((f) => chip(f.name, f.id === beauty.filter, "", () => {
    beauty.filter = f.id; lookId = "custom"; saveBeauty(); renderLooks();
  })));
}
[["sSmooth", "smooth"], ["sBright", "bright"], ["sWarm", "warm"]].forEach(([id, k]) => $(id).addEventListener("input", (e) => {
  beauty[k] = +e.target.value; e.target.nextElementSibling.textContent = e.target.value; e.target.setAttribute("aria-valuetext", `${e.target.value} percent`);
  if (lookId !== "custom") { lookId = "custom"; renderLooks(); }
  saveBeauty();
}));

function camState(kind) {
  cam.state = kind;
  const S = {
    prompt: ["camera", "Take photos with Glow", "Glow needs your camera to show a live preview. Photos stay on your device until you save or edit them.", "Turn on camera"],
    denied: ["cameraoff", "Camera access is off", native
      ? "To take photos, allow camera access for Glow in your phone's Settings, then come back."
      : "To take photos, allow camera access for this site in your browser's settings (usually the icon next to the address), then try again.", "Try again"],
    busy: ["cameraoff", "The camera is busy", "Another app may be using the camera. Close it and try again.", "Try again"],
    none: ["cameraoff", "No camera found", "Glow couldn't find a camera on this device. You can still edit photos you already have.", "Try again"],
    unsupported: ["cameraoff", "Live camera isn't available here", "This browser can't show a live camera. You can still take a photo with your device's camera app.", "Use device camera"],
    starting: null, live: null,
  }[kind];
  $("camState").hidden = !S;
  $("shutter").disabled = kind !== "live";
  if (kind !== "live") $("camFlip").hidden = true;
  if (!S) return;
  setIcon($("camStateArt"), S[0]); $("camStateTitle").textContent = S[1]; $("camStateText").textContent = S[2]; $("camStateBtn").textContent = S[3];
}
$("camStateBtn").addEventListener("click", () => {
  if (cam.state === "unsupported") { $("sysCamera").click(); return; }
  startCamera();
});
$("camStateAlt").addEventListener("click", galleryToEditor);
$("sysCamera").addEventListener("change", async (e) => {
  const f = e.target.files[0]; e.target.value = ""; if (!f) return;
  if (!(await confirmReplace())) return;
  try { await openFile(f, "Camera photo"); } catch (err) { say(err.message, true); }
});

async function enterCamera() {
  renderReview();
  if (cam.shot) return;
  if (!Platform.camera.supported()) { camState("unsupported"); return; }
  const perm = await Platform.camera.permission();
  if (screen !== "cameraScreen") return;
  if (perm === "granted") startCamera();
  else camState(perm === "denied" ? "denied" : "prompt");
}
// Only the newest start may keep its stream: a flip, a return from the background or a second
// tap while the camera is opening never leaves an older stream running.
async function startCamera() {
  stopCamera();
  const gen = cam.gen;
  camState("starting");
  cam.gl = cam.gl || initGl($("camCanvas"));
  renderLooks();
  $("camNote").hidden = !!cam.gl;
  $("camNote").textContent = "Live looks aren't available on this device. Your photo is captured as is; tap Edit photo afterwards to add looks, filters and retouching.";
  let stream;
  try {
    stream = await Platform.camera.open(cam.facing);
  } catch (e) {
    if (gen !== cam.gen) return;
    const n = e && e.name;
    camState(n === "NotAllowedError" || n === "SecurityError" ? "denied" : n === "NotFoundError" || n === "OverconstrainedError" ? "none" : n === "NotReadableError" ? "busy" : "none");
    return;
  }
  if (gen !== cam.gen || screen !== "cameraScreen" || cam.shot || document.hidden) { stream.getTracks().forEach((t) => t.stop()); return; }
  cam.stream = stream; cam.opened++;
  const v = $("camVideo"); v.srcObject = stream;
  try { await v.play(); } catch {}
  camState("live");
  const torch = Platform.camera.torchSupported(cam.stream);
  $("flashBtn").hidden = !torch; $("flashSpacer").hidden = torch;
  if (torch && cam.torch) Platform.camera.setTorch(cam.stream, true).catch(() => {});
  $("camFlip").hidden = (await Platform.camera.count()) < 2;
  drawFrame();
}
function stopCamera() {
  cam.gen++;
  cancelAnimationFrame(cam.raf);
  if (cam.stream) cam.stream.getTracks().forEach((t) => t.stop());
  cam.stream = null;
  const v = $("camVideo"); if (v.srcObject) { v.pause(); v.srcObject = null; }
}
function drawFrame() {
  const v = $("camVideo"), c = $("camCanvas");
  if (!cam.stream) return;
  if (v.videoWidth) {
    if (c.width !== v.videoWidth) { c.width = v.videoWidth; c.height = v.videoHeight; if (cam.gl) cam.gl.gl.viewport(0, 0, c.width, c.height); }
    if (cam.gl) {
      const { gl } = cam.gl;
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, v);
      drawBeauty(cam.gl, c.width, c.height, cam.facing === "user", beauty);
    } else {
      const x = c.getContext("2d"); x.save();
      if (cam.facing === "user") { x.translate(c.width, 0); x.scale(-1, 1); }
      x.drawImage(v, 0, 0); x.restore();
    }
  }
  cam.raf = requestAnimationFrame(drawFrame);
}
// The camera light goes off whenever Glow is in the background, and comes back once on return.
document.addEventListener("visibilitychange", () => {
  if (screen !== "cameraScreen" || cam.shot) return;
  if (document.hidden) stopCamera(); else if (cam.state === "live" || cam.state === "starting") startCamera();
});
window.addEventListener("pagehide", stopCamera);
// Permission changed in the browser's or phone's settings while Glow is open.
(async () => {
  try {
    const st = await navigator.permissions.query({ name: "camera" });
    st.addEventListener("change", () => {
      if (screen !== "cameraScreen" || cam.shot) return;
      if (st.state === "denied") { stopCamera(); camState("denied"); }
      else if (st.state === "granted" && cam.state !== "live" && cam.state !== "starting") startCamera();
    });
  } catch {}
})();
$("camFlip").addEventListener("click", () => {
  cam.facing = cam.facing === "user" ? "environment" : "user"; store.set("glowFacing", cam.facing); Platform.haptic(); startCamera();
});
$("flashBtn").addEventListener("click", async () => {
  cam.torch = !cam.torch;
  try { await Platform.camera.setTorch(cam.stream, cam.torch); } catch { cam.torch = false; say("Flash isn't available right now.", true); }
  $("flashBtn").setAttribute("aria-pressed", String(cam.torch)); setIcon($("flashBtn"), cam.torch ? "flash" : "flashoff");
  $("flashBtn").setAttribute("aria-label", cam.torch ? "Flash on" : "Flash off");
});

// Capture: the preview and the photo match, mirroring included. The untouched frame is kept
// as the original; the look is baked into a second copy at the same size.
const canvasBlob = (c, type = "image/jpeg", q = 0.95) => new Promise((ok, fail) => c.toBlob((b) => (b ? ok(b) : fail(new Error("Couldn't take the photo."))), type, q));
$("shutter").addEventListener("click", async () => {
  const v = $("camVideo"); if (!v.videoWidth || cam.state !== "live" || cam.shot) return;
  Platform.haptic("heavy");
  const flash = document.createElement("div"); flash.className = "cam-flash"; document.body.append(flash); setTimeout(() => flash.remove(), 400);
  let shot;
  try {
    const o = newCanvas(v.videoWidth, v.videoHeight), octx = o.getContext("2d");
    if (cam.facing === "user") { octx.translate(o.width, 0); octx.scale(-1, 1); }
    octx.drawImage(v, 0, 0);
    const looked = cam.gl && !isOriginalLook();
    const processed = looked ? withFilter($("camCanvas"), o.width, o.height, beauty.filter) : null;
    const stamp = Date.now();
    shot = { raw: o.toDataURL("image/jpeg", 0.92), rawBlob: await canvasBlob(o), processed, w: o.width, h: o.height,
      look: looked ? lookName() : null, stamp, saved: false, originalSaved: false, saving: null };
  } catch {
    say("Couldn't take the photo. Try again.", true); return;
  }
  cam.shot = shot;
  stopCamera(); renderReview();
  makeThumb(shot.processed || shot.raw).then((t) => { cam.thumb = t; renderReview(); }).catch(() => {});
  if (store.get("glowAutoSave") === "on") {
    $("alertLive").textContent = "Photo taken. Saving it now.";
    saveShot(shot, true);
  } else $("alertLive").textContent = "Photo taken. Save it, edit it, or retake.";
});
function renderReview() {
  const s = cam.shot;
  $("reviewImg").hidden = !s; $("camCanvas").hidden = !!s;
  $("liveControls").hidden = !!s; $("reviewControls").hidden = !s;
  $("nav").hidden = screen !== "cameraScreen" ? $("nav").hidden : !!s;
  if (s) {
    $("reviewImg").src = s.processed || s.raw; $("camState").hidden = true; $("camNote").hidden = true;
    $("saveShotBtn").disabled = s.saved || !!s.saving;
    $("saveShotBtn").innerHTML = s.saved ? icon("check") + "Saved" : s.saving ? "Saving…" : "Save";
  }
  const g = $("camGallery");
  if (cam.thumb) { g.innerHTML = `<img alt="" src="${cam.thumb}">`; } else setIcon(g, "gallery");
}
async function makeThumb(src) { const img = await loadImg(src), c = canvasFor(img, 160); c.getContext("2d").drawImage(img, 0, 0, c.width, c.height); return c.toDataURL("image/jpeg", 0.8); }

// What a finished save means, in words that match what the platform confirmed.
function savedText(where, n, extra = "") {
  const what = n > 1 ? "Photos" : "Photo";
  if (where === "photos") return `${what} saved to your Glow album.${extra}`;
  if (where === "downloaded") return `Download started. Your browser keeps ${n > 1 ? "them" : "it"} in Downloads.${extra}`;
  return `Sent to the share sheet. Choose Save Image there to keep ${n > 1 ? "them" : "it"}.${extra}`;
}
const saveFailText = () => (native ? "Couldn't save. Allow photo access for Glow in your phone's Settings, then try Save again." : "Couldn't save the photo. Try again.");

// Saves a camera photo once. Auto-save and the Save button share this, so a photo is never
// saved twice; with "Also save the original", the untouched frame goes too (only when a look
// changed it). Success is only shown once the platform says the save finished.
function saveShot(s, auto) {
  if (s.saved) return Promise.resolve(true);
  if (s.saving) return s.saving;
  const items = [];
  const withOrig = store.get("glowSaveOrig") === "on" && !!s.processed && !s.originalSaved;
  if (withOrig) items.push({ blob: s.rawBlob, name: `glow-${s.stamp}-original` });
  items.push(s.processed ? { data: s.processed, name: `glow-${s.stamp}` } : { blob: s.rawBlob, name: `glow-${s.stamp}` });
  s.saving = (async () => {
    try {
      // Auto-save never opens a share sheet on its own; browsers get a download.
      const where = await Platform.savePhotos(items, { download: auto });
      s.saved = true; if (withOrig || !s.processed) s.originalSaved = true;
      if (cam.shot === s || ed.shotStamp === s.stamp) say(savedText(where, items.length));
      if (ed.shotStamp === s.stamp) {
        ed.originalSaved = ed.originalSaved || s.originalSaved;
        if (ed.idx <= 1 && !ed.pending) ed.savedIdx = ed.idx;
        saveDraft(); if (screen === "editorScreen") renderEditor();
      }
      return true;
    } catch (err) {
      if (!(err && err.name === "AbortError")) say(auto ? "Auto-save didn't finish. " + saveFailText() : saveFailText(), true);
      return false;
    } finally { s.saving = null; if (cam.shot === s) renderReview(); }
  })();
  renderReview();
  return s.saving;
}
$("retakeBtn").addEventListener("click", () => {
  cam.shot = null; renderReview(); $("nav").hidden = false; startCamera();
});
$("saveShotBtn").addEventListener("click", () => { if (cam.shot) saveShot(cam.shot, false); });
$("editShotBtn").addEventListener("click", async () => {
  const s = cam.shot; if (!s) return;
  if (!(await confirmReplace())) return;
  const original = { blob: s.rawBlob, w: s.w, h: s.h, name: "Camera photo", type: "image/jpeg" };
  const work = await shrinkData(s.raw), processed = s.processed ? { data: await shrinkData(s.processed), full: s.processed, label: s.look } : null;
  cam.shot = null; renderReview();
  // Still saving in the background: the editor learns the result when it lands.
  await openPhoto(work, original, { name: "Camera photo", processed, savedAlready: s.saved, originalSaved: s.originalSaved, shotStamp: s.saving ? s.stamp : 0 });
  if (processed) say(`${s.look} look applied. Undo removes it.`);
});
async function galleryToEditor() {
  stopCamera();
  if (!(await confirmReplace())) { if (screen === "cameraScreen") enterCamera(); return; }
  const f = await Platform.pickPhoto("file");
  if (!f) { if (screen === "cameraScreen") enterCamera(); return; }
  try { cam.shot = null; await openFile(f); } catch (err) { say(err.message, true); }
}
$("camGallery").addEventListener("click", galleryToEditor);

// ---------- Settings ----------
function openSettings() {
  refreshAccount();
  const start = store.get("glowStart") || "last";
  document.querySelectorAll("#startSeg button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.start === start)));
  $("saveOrigToggle").checked = store.get("glowSaveOrig") === "on";
  $("autoSaveToggle").checked = store.get("glowAutoSave") === "on";
  applyTheme(); showBuild();
  $("settings").showModal();
}
// Which build this is, so a test on a phone can be matched to a commit. build.json is written
// by the Vercel build (vercel.json); FEATURES names what this code contains either way.
const FEATURES = "reshape-v2 · crop-v2";
async function showBuild() {
  let b = null;
  try { const r = await fetch("/build.json", { cache: "no-store" }); if (r.ok) b = await r.json(); } catch {}
  const sha = b && b.sha ? b.sha.slice(0, 7) : "";
  $("buildId").textContent = sha ? `Build ${sha} · ${b.env || "?"} · ${b.ref || "?"} · ${FEATURES}` : `Build: local copy (no deployment info) · ${FEATURES}`;
}
$("camSettingsBtn").addEventListener("click", openSettings);
$("homeSettingsBtn").addEventListener("click", openSettings);
$("startSeg").addEventListener("click", (e) => {
  const b = e.target.closest("button"); if (!b) return;
  store.set("glowStart", b.dataset.start);
  document.querySelectorAll("#startSeg button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
});
$("themeSeg").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) { store.set("glowTheme", b.dataset.theme); applyTheme(); } });
$("saveOrigToggle").addEventListener("change", (e) => store.set("glowSaveOrig", e.target.checked ? "on" : "off"));
$("autoSaveToggle").addEventListener("change", (e) => store.set("glowAutoSave", e.target.checked ? "on" : "off"));
$("autoSaveHelp").textContent = native && plugins.Media
  ? "Off: after each photo you choose Save, Retake or Edit photo. On: each photo is saved to the Glow album as soon as you take it, and you can still edit or retake it. Edits are saved separately when you tap Save in the editor."
  : "Off: after each photo you choose Save, Retake or Edit photo. On: each photo is downloaded to this device as soon as you take it. Browsers can't put photos straight into your photo library, so look in Downloads.";
$("replayIntro").addEventListener("click", () => { $("settings").close(); showOnboarding(); });
$("goProBtn").addEventListener("click", () => { $("settings").close(); openPaywall(); });
$("deleteAccount").addEventListener("click", async (e) => {
  e.preventDefault();
  const ok = await ask({ title: "Delete your account and data?", text: "This permanently deletes your Glow account and its data. It can't be undone. Cancel any subscription in your store settings too.",
    actions: [{ label: "Delete everything", value: "yes" }, { label: "Keep my account", value: "", kind: "ghost" }] });
  if (!ok) return;
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
    // Show the store's own localized prices.
    if (packages.weekly) $("priceWeekly").textContent = `${packages.weekly.product.priceString}/week`;
    if (packages.yearly) {
      const y = packages.yearly.product;
      $("priceYearly").textContent = `${y.priceString}/year`;
      $("yearlyNote").textContent = y.pricePerMonthString ? `About ${y.pricePerMonthString} a month, billed yearly` : "Billed once a year";
    }
    renderPlanNote();
    return true;
  })().catch((e) => { rcReady = null; console.warn(e); return false; });
  return rcReady;
}
function renderPlanNote() {
  const price = $(plan === "yearly" ? "priceYearly" : "priceWeekly").textContent.replace("/", " per ");
  $("pwNote").textContent = native
    ? `${price}. Renews automatically every ${plan === "yearly" ? "year" : "week"} until you cancel. Cancel anytime in your App Store or Google Play settings at least 24 hours before renewal. Payment is charged to your store account.`
    : "Glow Pro is available in the Glow app for iPhone and Android. The camera and on-device tools stay free here.";
}
function openPaywall() {
  if (account && account.plan === "pro") { openCredits(); return; }
  $("buyBtn").disabled = !native; $("buyBtn").textContent = buyLabel();
  $("adBtn").hidden = !(native && plugins.AdMob && account && account.plan !== "pro" && account.remaining < 2 && account.adsLeft > 0);
  renderPlanNote();
  setupPurchases();
  $("paywall").showModal();
}
$("plans").addEventListener("click", (e) => {
  const b = e.target.closest(".plan"); if (!b) return;
  plan = b.dataset.plan;
  document.querySelectorAll(".plan").forEach((p) => p.setAttribute("aria-checked", String(p === b)));
  $("buyBtn").textContent = buyLabel(); renderPlanNote();
});
$("plans").addEventListener("keydown", (e) => {
  if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) return;
  e.preventDefault(); const other = document.querySelector(`.plan:not([data-plan="${plan}"])`); other.click(); other.focus();
});
const buyLabel = () => (plan === "yearly" ? "Continue with yearly" : "Continue with weekly");
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
    say((await afterPurchase()) ? "Welcome to Glow Pro. Your 40 weekly AI credits are ready." : "Purchase complete. Pro will switch on within a minute.");
  } catch (err) {
    if (!(err && err.userCancelled)) say((err && err.message) || "Purchase didn't go through.", true);
  } finally { $("buyBtn").disabled = !native; $("buyBtn").textContent = buyLabel(); }
});
async function restore() {
  try {
    if (!(await setupPurchases())) throw new Error("Restore works in the Glow app for iPhone and Android.");
    await purchases().restorePurchases();
    say((await afterPurchase()) ? "Glow Pro restored." : "No active subscription found for this store account.");
    $("paywall").close(); $("settings").close();
  } catch (err) { say(err.message, true); }
}
$("restoreBtn").addEventListener("click", restore);
$("restoreBtn2").addEventListener("click", restore);

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
    if (ok) say("You earned 1 more AI credit.");
    else say("The ad didn't finish, so no edit was added.", true);
  } catch (err) { say(err.message, true); }
  finally { $("adBtn").disabled = false; }
});

// Android back button: close a sheet, leave the photo review or the editor, then exit.
if (native && plugins.App) plugins.App.addListener("backButton", () => {
  const open = document.querySelector("dialog[open]");
  if (open) open.close();
  else if (screen === "editorScreen") $("backBtn").click();
  else if (screen === "cameraScreen" && cam.shot) $("retakeBtn").click();
  else plugins.App.exitApp();
});
// Keyboard: Escape closes the tool panel; Ctrl/Cmd+Z undoes.
document.addEventListener("keydown", (e) => {
  if (screen !== "editorScreen" || document.querySelector("dialog[open]") || e.target.matches("input[type=search]")) return;
  if (e.key === "Escape" && sel) selectTool(null);
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && !cr) { e.preventDefault(); (e.shiftKey ? $("redoBtn") : $("undoBtn")).click(); }
});

// ---------- Start ----------
ensureSession().then(refreshAccount).catch((e) => say(e.message, true));
setupPurchases();
setupAds();
restoreDraft();
if (!store.get("glowOnboarded")) showOnboarding();
else { const pref = store.get("glowStart") || "last"; go(pref === "last" ? store.get("glowLastDest") || "camera" : pref); }
if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
