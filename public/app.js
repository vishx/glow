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
  // Glow's public address: encoded in the Share Glow QR card, and printed under "Glow" in the
  // badge on free saves unless badgeLine says otherwise. This is the project's production domain
  // on Vercel. Leave it "" and Share Glow is not offered.
  publicUrl: "https://glow-photo-enhancer.vercel.app",
  // The small second line of the badge on free saves, such as a real domain or "On the App Store".
  // "" uses publicUrl's address; "none" shows "Glow" alone.
  badgeLine: "",
  // Fill sends mode "fill" with a short prompt. Live since enhance v9 (2026-10-30, after migration 006).
  aiFill: true,
  // AI scene, HD cutout and Describe need the "bgscene", "bgcut" and "custom" modes on the
  // server (enhance v10, live 2026-10-30) and migration 008 (run 2026-10-30).
  aiV10: true,
  // Pricing v2 (migration 007): Fill and Expand cost 2 credits. Turn on only once 007 is applied,
  // so the cost shown always matches what the server charges. Applied on 2026-10-30.
  pricingV2: true,
  // One-time AI credit packs: consumable store products sold through RevenueCat (migration 012).
  // The server decides the credits from the product id; the prices here show until the store's
  // own localized prices load, and on the web.
  creditPacks: [
    { id: "glow_credits_10", credits: 10, price: "$1.99" },
    { id: "glow_credits_30", credits: 30, price: "$4.99", tag: "Popular" },
    { id: "glow_credits_80", credits: 80, price: "$11.99" },
  ],
};
const PUBLIC_HOST = CONFIG.publicUrl ? new URL(CONFIG.publicUrl).host : "";

// ---------- Tools ----------
// kind: "ai" runs on the AI server and uses credits; every other kind runs on the device and is free.
// cat is the original category, used by the All tab.
const TOOLS = [];
const tool = (id, label, title, kind, cat, extra = {}) => TOOLS.push({ id, label, title, kind, cat, ...extra });
tool("mylook", "My Look", "My Look", "look", "fix", { hint: "Gives this photo one of your camera looks." });
tool("pro", "Pro edit", "Pro edit", "ai", "fix", { hint: "A photographer-style edit: color, light, skin and background." });
tool("enhance", "Enhance", "Enhance", "ai", "fix", { hint: "Sharper faces and cleaner detail, the same as the Enhance tab. Also repairs old or blurry photos." });
tool("faces", "Repair", "Face repair", "ai", "fix", { hint: "Restores blurry or damaged faces." });
tool("retouch", "Retouch", "AI retouch", "ai", "fix", { hint: "Evens skin and tone while keeping texture." });
tool("smile", "Smile", "Add a smile", "ai", "fix", { hint: "Works best on a clear, front-facing photo." });
tool("relight", "Relight", "Relight", "ai", "fix", { hint: "Soft, flattering studio light." });
tool("golden", "Golden", "Golden hour", "ai", "fix", { hint: "Warm, low sunlight." });
tool("upscale", "Upscale", "Upscale 4×", "ai", "fix", { hint: "Makes the photo 4 times larger with sharper detail." });
tool("colorize", "Colorize", "Colorize", "ai", "fix", { hint: "Adds natural color to black-and-white photos." });
const FACE_TOOLS = [["fauto", "Auto", "Auto beauty"], ["fsmooth", "Smooth", "Smooth skin"], ["fblemish", "Blemish", "Blemishes"],
  ["fundereye", "Under-eye", "Under-eyes"], ["fteeth", "Teeth", "Whiten teeth"], ["feyes", "Eyes", "Brighten eyes"],
  ["fbigeyes", "Eye size", "Eye size", 1], ["fslim", "Face", "Face shape", 1], ["fnose", "Nose", "Nose shape", 1],
  ["ftone", "Even tone", "Even tone"], ["fskin", "Finish", "Skin finish"],
  ["fglam", "Looks", "Makeup looks"], ["flips", "Lips", "Lip color"], ["fblush", "Blush", "Blush"], ["flashes", "Lashes", "Lashes"],
  ["fliner", "Liner", "Eyeliner"], ["fshadow", "Shadow", "Eyeshadow"], ["fbrows", "Brows", "Brows"], ["feyecolor", "Eye color", "Eye color"],
  ["fcontour", "Contour", "Contour"], ["fhighlight", "Highlight", "Highlighter"], ["fbronzer", "Bronzer", "Bronzer"]];
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
[["bgblur", "Blur", "Portrait blur"], ["bgremove", "Cutout", "Cutout"], ["bgwhite", "White", "White background"],
  ["bgblush", "Blush", "Blush background"], ["bgsky", "Sky", "Sky background"]].forEach(([id, label, title]) => tool(id, label, title, "bg", "bg"));
// Glow Up: one checklist of fixes, run together. The free steps run on the phone; at most one
// AI step (Enhance, a new background, or her own words) runs first, then the free steps on top.
tool("glowup", "Glow Up", "Glow Up", "glowup", "fix", { hint: "Tick what you want. AI is optional." });
tool("custom", "Describe", "Describe an edit", "ai", "fix", { hint: "Say what to change. Her face is kept as hers." });
tool("bgcolor", "Color", "Color background", "bg", "bg", { hint: "A plain studio color behind her." });
tool("bgphoto", "Photo", "Your background", "bg", "bg", { hint: "Pick any photo as the background. She is matched to its light and color." });
// AI backgrounds: a scene painted around her (only the background is repainted; she stays her own
// pixels), and an HD cutout whose edges follow single hair strands.
tool("bgscene", "AI scene", "AI background", "ai", "bg", { hint: "Pick a scene or describe one. Only the background changes." });
tool("bgcut", "HD cutout", "HD cutout", "ai", "bg", { hint: "A precise cutout, down to the hair. Then pick any background for free." });
// Generative tools: Remove and Fill repaint only the area you mark; Expand adds new scene around
// the photo. Your own pixels outside the marked or new area are put back exactly afterwards.
tool("erase", "Remove", "Remove", "ai", "ai", { hint: "Paint over what to remove. Only the marked area changes.", mask: true });
tool("fill", "Fill", "Fill", "ai", "ai", { hint: "Paint the area to fill and, if you like, say what to put there.", mask: true });
tool("expand", "Expand", "Expand", "ai", "ai", { hint: "Choose a bigger shape and place the photo. Only the new area is generated." });
tool("crop", "Crop", "Crop and rotate", "crop", "edit");
tool("light", "Light", "Light", "adjust", "edit");
tool("color", "Color", "Color", "adjust", "edit");
tool("warmth", "Warmth", "Warmth", "adjust", "edit");
tool("detail", "Detail", "Detail", "adjust", "edit");
tool("contrast", "Contrast", "Contrast", "adjust", "edit");
tool("highlights", "Highlights", "Highlights", "adjust", "edit");
tool("shadows", "Shadows", "Shadows", "adjust", "edit");
tool("vibrance", "Vibrance", "Vibrance", "adjust", "edit");
tool("tint", "Tint", "Tint", "adjust", "edit");
tool("fade", "Fade", "Fade", "adjust", "edit");
tool("vignette", "Vignette", "Vignette", "adjust", "edit");
tool("grain", "Grain", "Grain", "adjust", "edit", { hint: "Left smooths noise, right adds film grain." });
FILTERS.filter((f) => f.id !== "none").forEach((f) => tool("filter:" + f.id, f.name, `${f.name} filter`, "filter", "filters", { filter: f }));
const TOOL = Object.fromEntries(TOOLS.map((t) => [t.id, t]));

// AI cost per tool. Must match ai_edit_cost() on the server, which is what actually charges.
const TWO_CREDITS = ["headshot", "anime", "watercolor", "fashion", "bgscene", "custom"];
// Free plan (pricing v2): these AI tools cost Glow under a cent and get 3 free credits a day; every
// other AI tool is premium, with 3 one-time trial credits. The server (migration 007) has the same list.
const CHEAP_AI = ["erase", "enhance", "upscale", "faces", "colorize", "retouch", "toon3d", "clay", "older", "younger", "bgcut"];
const aiOf = (t) => (t && t.id === "glowup" ? (glow.ai && !ed.demo ? TOOL[glow.ai] : null) : t);
const trialTool = (t) => (t = aiOf(t) || t, !!account) && account.plan !== "pro" && account.trialLeft !== undefined && t.kind === "ai" && !CHEAP_AI.includes(t.id);
// What this tool can draw on: the one-time trial for premium tools on the free plan (plus any
// bought or given credits), otherwise the usual balance.
const balanceFor = (t) => (trialTool(t) ? account.trialLeft + (account.bonus || 0) : account.remaining);
const costOf = (t) => (t.id === "glowup" ? (aiOf(t) ? costOf(aiOf(t)) : 0) : t.kind !== "ai" ? 0 : TWO_CREDITS.includes(t.id) || (CONFIG.pricingV2 && ["fill", "expand"].includes(t.id)) ? 2 : 1);
const credits = (n) => `${n} credit${n === 1 ? "" : "s"}`;

const ORIGINAL_CATS = [["fix", "Fix"], ["face", "Face"], ["hair", "Hair"], ["body", "Body"], ["styles", "Styles"], ["bg", "Backdrop"], ["edit", "Edit"], ["ai", "AI"], ["filters", "Filters"]];
const FILTER_IDS = TOOLS.filter((t) => t.kind === "filter").map((t) => t.id);
// Four tabs, each one row of tools in small labeled groups (no second row of subgroups).
// Body reshaping is kept out of the tabs: it is only in Search, under "Body (advanced)", and is
// never suggested or applied automatically. AI holds the tools that change what is in the photo;
// other paid tools sit with their task and carry the same credit badge.
const CATS = {
  // The first five are the default row (as in the approved design); the rest follow on scroll.
  retouch: [["glow", "Glow Up", ["glowup"]], ["skin", "Skin", ["fsmooth", "fblemish", "feyes", "fslim", "fnose"]],
    ["face", "Face", ["fundereye", "fauto", "ftone", "fskin", "fbigeyes", "fteeth", "retouch", "smile", "faces"]],
    ["makeup", "Makeup", ["fglam", "flips", "fblush", "flashes", "fliner", "fshadow", "fbrows", "feyecolor", "fcontour", "fhighlight", "fbronzer"]],
    ["hair", "Hair", ["hcolor"]]],
  looks: [["filters", "Filters", FILTER_IDS],
    ["styles", "Styles", ["headshot", "fashion"]],
    ["outfits", "Outfits", ["outfit", "suit", "sundress"]]],
  edit: [["adjust", "Adjust", ["crop", "light", "contrast", "highlights", "shadows", "color", "vibrance", "warmth", "tint", "detail", "fade", "vignette", "grain"]],
    ["enhance", "Enhance", ["pro", "enhance", "golden", "colorize"]],
    ["bg", "Background", ["bgscene", "bgphoto", "bgblur", "bgremove", "bgcolor"]]],
  ai: [["gen", "AI tools", ["erase", "fill", "custom"]]],
};
const ADVANCED = [["camlooks", "Camera looks", ["mylook"]]];
// Retired from the app (Oct 30 audit): they changed the face, returned the wrong framing, duplicated
// another tool, or (body reshaping) didn't fit Glow. Their code stays so saved drafts still replay.
const RETIRED = ["smile", "relight", "older", "younger", "expand", "upscale", "faces", "bgcut", "bgwhite", "bgblush", "bgsky",
  "anime", "watercolor", "toon3d", "clay", "gown", "street", "hair_waves", "hair_bob", "hair_pixie", "hair_bangs", "hair_curls",
  "hair_bun", "hair_braids", "hair_butterfly", "bwaist", "bhips", "barms", "bslimlegs", "blegs"];
const TAB_NAMES = { retouch: "Retouch", looks: "Looks", edit: "Edit", ai: "AI" };
// Where a tool lives: its tab, or null for tools reached through Search only.
function tabFor(id) {
  for (const [c, groups] of Object.entries(CATS)) for (const [, , ids] of groups) if (ids.includes(id)) return [c, null];
  return null;
}
const SUGGESTED = ["glowup", "pro", "fauto", "bgblur"];
// Remove, Fill and Expand: the marked or new area only, never auto-run, and Glow's server must
// have the mode. Fill needs the "fill" mode from supabase/functions/enhance (not yet live).
const MASK_TOOLS = ["erase", "fill"];
const aiLive = (id) => (id === "glowup" ? !glow.ai || aiLive(glow.ai) : (id !== "fill" || CONFIG.aiFill) && (!["bgscene", "bgcut", "custom"].includes(id) || CONFIG.aiV10));
const CROPS = [["Free", "free"], ["Original", 0], ["Square", 1], ["4:5", 4 / 5], ["3:4", 3 / 4], ["9:16", 9 / 16], ["16:9", 16 / 9]];

// ---------- Small UI helpers ----------
let toastTimer = 0;
// action: an optional { label, run } shown as a small button in the toast.
function say(text, isErr, action) {
  if (text && isErr) { try { track("error_shown", { msg: String(text).slice(0, 120), screen }); } catch {} }
  const t = $("toast");
  clearTimeout(toastTimer);
  if (!text) { t.classList.remove("on"); return; }
  t.textContent = text; t.classList.toggle("err", !!isErr); t.classList.add("on");
  if (action) {
    const b = document.createElement("button"); b.className = "toast-act"; b.textContent = action.label;
    b.addEventListener("click", () => { t.classList.remove("on"); action.run(); }); t.append(" ", b);
  }
  if (isErr) $("alertLive").textContent = text;
  toastTimer = setTimeout(() => t.classList.remove("on"), isErr ? 7000 : action ? 7000 : 3800);
}
// A small in-app dialog. Resolves with the chosen action's value, or null.
function ask({ title, text, actions, image, caption }) {
  return new Promise((done) => {
    const d = $("ask");
    $("askTitle").textContent = title; $("askText").textContent = text || ""; $("askText").hidden = !text;
    $("askFigure").hidden = !image; $("askImg").src = image || ""; $("askImg").alt = caption || ""; $("askCaption").textContent = caption || "";
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
[["camSettingsBtn", "settings"], ["homeSettingsBtn", "settings"], ["backBtn", "back"], ["favBtn", "star"],
  ["camGallery", "gallery"], ["camFlip", "flip"], ["flashBtn", "flashoff"], ["searchClose", "close"],
  ["zoomIn", "zoomin"], ["zoomOut", "zoomout"], ["zoomFit", "fit"], ["collapseBtn", "chevdown"], ["expandView", "expand"]].forEach(([id, n]) => setIcon($(id), n));
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
  ["onboarding", "enhanceHome", "enhanceResult", "enhanceBatch", "enhanceShare", "cameraScreen", "editorHome", "editorScreen"].forEach((s) => { $(s).hidden = s !== id; });
  const dest = id === "cameraScreen" ? "camera" : id === "editorHome" ? "editor" : id === "enhanceHome" ? "enhance" : "";
  $("nav").hidden = !dest || (id === "cameraScreen" && !!cam.shot);
  $("nav").classList.toggle("dark", id === "cameraScreen");
  document.querySelectorAll("#nav button").forEach((b) => { if (b.dataset.dest === dest) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current"); });
  if (dest) store.set("glowLastDest", dest);
  if (id === "cameraScreen") enterCamera();
  if (id === "editorHome") renderHome();
  if (id === "enhanceHome" && typeof renderEnhanceHome === "function") renderEnhanceHome();
}
function go(dest) { try { track("tab", { dest }); } catch {} showScreen(dest === "camera" ? "cameraScreen" : dest === "enhance" ? "enhanceHome" : "editorHome"); }
$("nav").addEventListener("click", (e) => { const b = e.target.closest("button[data-dest]"); if (b) { Platform.haptic(); go(b.dataset.dest); } });

// ---------- Onboarding ----------
// One welcome screen with the sample portrait: Choose a photo, Try the sample, or the camera.
// Nothing asks for a permission here; the camera asks when it opens. Shown once; Settings can
// show it again.
// Explicit choices here (and the sample or a picked photo) override the startup preference.
function finishOnboarding(dest) {
  store.set("glowOnboarded", "1");
  if (dest === "pick") { go("editor"); pickAndOpen(); }
  else if (dest === "sample") { go("editor"); openSample(); }
  else if (dest === "camera") go("camera");
  else go(store.get("glowLastDest") || "enhance");   // where you left off
}
$("obPick").addEventListener("click", () => finishOnboarding("pick"));
$("obSample").addEventListener("click", () => finishOnboarding("sample"));
$("obCamera").addEventListener("click", () => finishOnboarding("camera"));
function showOnboarding() { showScreen("onboarding"); }

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
let cat = store.get("glowCat") || "retouch";
if (!CATS[cat]) cat = "retouch";   // For You and All from earlier versions: now Search
let favs = [], recent = [];
try { favs = JSON.parse(store.get("glowFavs") || "[]"); recent = JSON.parse(store.get("glowRecent") || "[]"); } catch {}
let lastCommitTool = null;  // the AI tool behind the latest commit, to disclose a repeat charge
let outfitData = null, strokes = [], painting = false, busyNow = false, thumb = "";
// Remove / Fill: brush size (screen pixels), paint or erase marks, and Fill's optional prompt.
let brushSize = 28, brushMode = "paint", fillPrompt = "", customText = "";
// A finished Remove / Fill / Expand result waits, unapplied, until the person applies or discards
// it. It is kept with the job (in IndexedDB), so leaving the tool, the editor or the app never
// loses paid work; reopening the tool (or Review in the status bar) shows it again.
const resultReady = () => !!job && job.status === "done" && job.session === ed.session && hasPhoto();
const reviewing = () => resultReady() && sel === job.tool;
const maskOn = () => MASK_TOOLS.includes(sel) && !reviewing() && !ed.demo;

const hasPhoto = () => ed.hist.length > 0;
const committed = () => ed.hist[ed.idx].data;
const unsaved = () => hasPhoto() && ed.idx > 0 && ed.savedIdx !== ed.idx;
const newSession = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

// Tool settings. Reshaping tools start at 0, so nothing is reshaped unless the user asks.
const toolAmt = { light: 0, color: 0, warmth: 0, detail: 0, contrast: 0, highlights: 0, shadows: 0, vibrance: 0, tint: 0, fade: 0, vignette: 0, grain: 0 };
for (const t of TOOLS) if (t.reshape) faceSet.amt[t.id] = 0;
try {
  const s = JSON.parse(store.get("glowFace2") || "null") || { shade: (JSON.parse(store.get("glowFace") || "{}").shade) || {} };
  Object.assign(faceSet.amt, s.amt || {}); Object.assign(faceSet.shade, s.shade || {}); Object.assign(faceSet.style, s.style || {});
  Object.assign(faceSet.custom, s.custom || {}); if (Array.isArray(s.mine)) faceSet.mine = s.mine;
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
  try { track("photo_open", { from: opts.processed ? "enhance" : opts.shotStamp ? "camera" : "library" }); } catch {}
  tileFace.box = null; tileFace.dims = "";
  if (!opts.demo && demo) exitDemo();
  ed.demo = !!opts.demo;
  ed.hist = [{ data: work, op: null }]; ed.idx = 0; ed.floor = 0; ed.pending = null; ed.savedIdx = 0;
  ed.original = original; ed.originalSaved = !!opts.originalSaved; ed.session = newSession();
  ed.name = opts.name || "Photo"; ed.shotStamp = opts.shotStamp || 0; lastCommitTool = null; cutoutCache = {}; matteCache.clear(); strokes = [];
  if (opts.processed) { ed.hist.push({ data: opts.processed.data, full: opts.processed.full, op: { tool: "camlook", fixed: true, label: opts.processed.label } }); ed.idx = 1; }
  if (opts.savedAlready) ed.savedIdx = ed.idx;
  sel = null; ed.view = "edited"; ed.split = 50; toolsOpen = false;
  photoColorful = false; checkColorful(work);
  showScreen("editorScreen");
  renderEditor(); saveDraft();
}
// Colorize is only for black-and-white photos: a color photo has clearly colored pixels.
let photoColorful = false;
async function checkColorful(src) {
  try {
    const img = await loadImg(src), c = canvasFor(img, 64), x = c.getContext("2d");
    x.drawImage(img, 0, 0, c.width, c.height);
    const d = x.getImageData(0, 0, c.width, c.height).data; let colored = 0;
    for (let i = 0; i < d.length; i += 4) if (Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2]) > 24) colored++;
    if (ed.hist[0] && ed.hist[0].data === src) { photoColorful = colored > d.length / 4 * 0.08; if (sel) renderPanel(true); }
  } catch {}
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
// results prepared once with Glow's real pipeline (see samples/demo-v2/manifest.json), loaded as
// static files: no AI request, no credits, no sign-in, no paywall. This is only a display
// path; the server still enforces credits on every real AI request, whatever the app says.
const DEMO_DIR = "/samples/demo-v2/";   // versioned: a new sample gets a new folder, so no stale cache
const DEMO_FREE = ["fblemish", "fsmooth", "fauto", "light", "filter:glow", "bgblur"];
let demo = null; // { manifest, ready: [toolId], entry: {toolId: entry}, cache: {toolId: dataURL}, failed: {toolId: true}, saved }
const demoOffers = (id) => !ed.demo || TOOL[id].kind !== "ai" || (!!demo && demo.ready.includes(id));

async function openSample() {
  track("sample_open", { from: screen });
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
  const saved = demo ? demo.saved : { amt: { ...faceSet.amt }, shade: { ...faceSet.shade }, style: { ...faceSet.style }, toolAmt: { ...toolAmt } };
  const entries = (manifest && manifest.previews) || [];
  demo = { manifest, saved, entry: Object.fromEntries(entries.map((e) => [e.tool, e])), cache: {}, failed: {},
    // Only results that line up with the original (same size and framing) are offered.
    ready: entries.filter((e) => e.status === "ready" && e.result && e.aligned === true && e.tool !== "colorize" && TOOL[e.tool] && TOOL[e.tool].kind === "ai").map((e) => e.tool) };
  cat = "retouch";
  try { await openFile(new File([blob], "glow-ai-sample.png", { type: blob.type || "image/png" }), "AI-generated sample", { demo: true }); }
  catch (err) { exitDemo(); say(err.message, true); return; }
  $("alertLive").textContent = "AI-generated sample opened. Demo, no credits used.";
  // The "AI sample" badge on the photo is the disclosure; tapping it explains the demo.
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
  if (!demo || !demo.ready.includes(t.id)) {
    // Remove, Fill and Expand have no prepared result: nothing is generated on the sample.
    chip.textContent = "Own photo"; chip.className = "chip";
    apply.textContent = "Use your photo"; apply.disabled = false;
    $("panelNote").textContent = `${t.title} works on your own photo. The sample has no prepared ${t.title} result, so nothing is generated here.`;
    fitDock(); return;
  }
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
    $("panelNote").textContent = `A prepared ${t.title} result. No credits used.${shifted}`;
  }
  fitDock();
}
// "prepared-preview-relight-" when the shown result is a prepared preview, so the file says what it is.
function demoSaveTag() { const op = ed.hist[ed.idx].op; return op && op.demo ? `prepared-preview-${op.tool}-` : ""; }
function exitDemo() {
  if (!demo) return;
  Object.assign(faceSet.amt, demo.saved.amt); Object.assign(faceSet.shade, demo.saved.shade); Object.assign(faceSet.style, demo.saved.style || {}); saveFace();
  Object.assign(toolAmt, demo.saved.toolAmt);
  demo = null; ed.demo = false; sel = null; lastCommitTool = null;
}
$("demoOwnBtn").addEventListener("click", pickAndOpen);
$("demoNote").addEventListener("click", () => say("AI sample: this portrait is AI-generated, not a real person. AI tools show prepared previews, and no credits are used."));
// More (⋯): Revert and Edit another photo, in a small menu above the button.
function setMore(open) {
  $("moreMenu").hidden = !open; $("moreBtn").setAttribute("aria-expanded", String(open));
  if (open) { $("otherPhotoBtn").hidden = !!ed.demo; const f = [...$("moreMenu").querySelectorAll("button")].find((b) => !b.disabled && !b.hidden); if (f) f.focus(); }
}
$("moreBtn").addEventListener("click", (e) => { e.stopPropagation(); setMore($("moreMenu").hidden); });
$("moreMenu").addEventListener("click", () => setMore(false));
$("moreMenu").addEventListener("keydown", (e) => { if (e.key === "Escape") { e.stopPropagation(); setMore(false); $("moreBtn").focus(); } });
document.addEventListener("click", (e) => { if (!$("moreMenu").hidden && !e.target.closest(".more")) setMore(false); });
$("otherPhotoBtn").addEventListener("click", () => $("backBtn").click());

// ---------- Draft: keeps the session (and any AI job) through a refresh or the app closing ----------
let draftWarn = false;
async function saveDraft() {
  if (ed.demo) return;                 // the sample is never kept as a project, and opening it keeps your draft
  if (!hasPhoto()) return Drafts.clear();
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
  const st = $("stage"), brushing = maskOn();
  const after = reviewing() ? job.result.data : ed.pending ? ed.pending.data : ed.idx > 0 ? committed() : null;
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
  const noCompare = !hasAfter || !!cr;
  $("compareBtn").disabled = noCompare;
  $("compareLbl").textContent = noCompare || holding ? "Compare" : ed.view === "split" ? "Split" : ed.view === "original" ? "Original" : "Compare";
  $("compareBtn").setAttribute("aria-label", `Compare, ${noCompare ? "nothing to compare yet" : ed.view === "split" ? "showing split" : ed.view === "original" ? "showing original" : "showing your edit"}`);
  $("compareBtn").classList.toggle("on", !noCompare && ed.view !== "edited");
  $("revertBtn").disabled = !!busyNow || ed.demo || !!cr || (ed.idx === 0 && !ed.pending) || !!(ed.hist[ed.idx].op && ed.hist[ed.idx].op.revert && !ed.pending);
  $("shareBtn").disabled = !!busyNow || savingEdit || (ed.idx === 0 && !ed.pending);
  const prepared = !ed.pending && ed.idx > 0 && ed.hist[ed.idx].op && ed.hist[ed.idx].op.demo;
  const editedName = ed.pending ? "Preview" : prepared ? "Prepared preview" : "Edited";
  const view = st.dataset.view;
  $("tagLeft").textContent = hasAfter && (view === "split" || view === "original") ? "Original" : "";
  $("tagRight").textContent = hasAfter && view === "split" ? editedName : hasAfter && view === "edited" && editedName !== "Edited" ? editedName : "";
  $("demoBar").hidden = !ed.demo; $("demoNote").hidden = !ed.demo; $("shareBtn").hidden = !!ed.demo;
  setSplit(ed.split);
  if ($("frame").classList.contains("narrow") && view === "split") $("tagRight").textContent = editedName.replace(" preview", "");
  $("brush").hidden = !brushing;
  if (brushing) requestAnimationFrame(drawStrokes);
  $("undoBtn").disabled = !!busyNow || (ed.idx <= ed.floor && !ed.pending);
  $("redoBtn").disabled = !!busyNow || ed.idx >= ed.hist.length - 1;
  // Saving the same version twice would only make a duplicate copy.
  const savedNow = ed.idx > 0 && ed.savedIdx === ed.idx && !ed.pending;
  $("saveBtn").disabled = !!busyNow || savingEdit || (ed.idx === 0 && !ed.pending) || savedNow;
  $("saveBtn").textContent = savedNow ? "Saved" : "Save";
  // A small sparkle the moment a save lands (once per save, not when reopening a saved photo).
  const sb = $("saveBtn"), wasSaved = sb.classList.contains("saved");
  sb.classList.toggle("saved", savedNow);
  if (savedNow && !wasSaved && savingEdit === false && sb.dataset.armed) { sb.classList.add("just-saved"); setTimeout(() => sb.classList.remove("just-saved"), 900); }
  sb.dataset.armed = savedNow ? "" : "1";
  $("editorScreen").classList.toggle("editing-tool", !!sel);
  $("editorScreen").classList.toggle("tools-open", searching && !sel);
  if (thumbFor !== committed()) { thumbFor = committed(); refreshThumb(); }
  renderTabs(); renderTools(); renderPanel(); renderCredits(); renderJob();
  $("editorScreen").classList.toggle("panel-collapsed", !!sel && panelCollapsed);
  $("panel").classList.toggle("collapsed", panelCollapsed);
  if (screen === "editorScreen") maybeZoomHint();
  if (sel) { const tb = $("tools").querySelector(`.tool[data-tool="${CSS.escape(sel)}"]`); if (tb) tb.scrollIntoView({ block: "nearest", inline: "nearest" }); }
}
let thumbFor = null, toolsOpen = false, panelCollapsed = false;
// Collapsing the panel leaves its title and Cancel / Apply, and gives the rest to the photo.
$("collapseBtn").addEventListener("click", () => {
  panelCollapsed = !panelCollapsed;
  $("collapseBtn").setAttribute("aria-expanded", String(!panelCollapsed));
  $("collapseBtn").setAttribute("aria-label", panelCollapsed ? "Show tool controls" : "Hide tool controls");
  renderEditor();
});
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
// ---------- Inspection zoom ----------
// Inspection zoom only changes how the photo is VIEWED: #view (both pictures) is moved and
// scaled with a CSS transform. It never touches the history, ops, crop, edit settings or the
// saved pixels, and never adds an undo step. Crop mode is different: its own gestures on
// #cropView change the crop itself, so inspection zoom is switched off while cropping.
// With the magic-erase brush, one finger draws and two fingers move the view.
const insp = { z: 1, cx: 0.5, cy: 0.5, key: "" };   // zoom (1 = fit) and the picture point at the viewer's centre
let vis = { x: 0, y: 0, w: 0, h: 0 }, zoomAnim = 0;
const mainImg = () => { const a = $("after"); return !a.hidden && a.naturalWidth ? a : $("before"); };
function fitRect() {
  const st = $("stage"), m = mainImg(), W = st.clientWidth, H = st.clientHeight;
  if (!m.naturalWidth || !W || !H) return { x: 0, y: 0, w: W, h: H, W, H, nw: 0, nh: 0 };
  const s = Math.min(W / m.naturalWidth, H / m.naturalHeight), w = m.naturalWidth * s, h = m.naturalHeight * s;
  return { x: (W - w) / 2, y: (H - h) / 2, w, h, W, H, nw: m.naturalWidth, nh: m.naturalHeight };
}
// Up to about 2 screen pixels per photo pixel, at least 3x, at most 10x.
const zoomMax = (F) => F.nw ? Math.max(3, Math.min(10, (F.nw / F.w) * 2)) : 1;
// Once the photo is larger than the viewer it always covers it; smaller, it stays centred.
function viewRect(F = fitRect()) {
  insp.z = Math.max(1, Math.min(zoomMax(F), insp.z));
  const w = F.w * insp.z, h = F.h * insp.z;
  insp.cx = w <= F.W ? 0.5 : Math.max(F.W / 2 / w, Math.min(1 - F.W / 2 / w, insp.cx));
  insp.cy = h <= F.H ? 0.5 : Math.max(F.H / 2 / h, Math.min(1 - F.H / 2 / h, insp.cy));
  return { x: F.W / 2 - insp.cx * w, y: F.H / 2 - insp.cy * h, w, h };
}
function applyView() {
  const F = fitRect(), f = $("frame"), st = $("stage");
  const key = F.nw ? `${ed.session}|${F.nw}x${F.nh}` : insp.key;
  if (key !== insp.key) { insp.key = key; insp.z = 1; insp.cx = insp.cy = 0.5; }   // a new photo, or a new picture size (crop), starts at fit
  const v = viewRect(F);
  Object.assign($("view").style, { width: F.w + "px", height: F.h + "px", transform: `translate(${v.x}px, ${v.y}px) scale(${insp.z})` });
  const x0 = Math.max(0, v.x), y0 = Math.max(0, v.y);
  vis = { x: x0, y: y0, w: Math.min(F.W, v.x + v.w) - x0, h: Math.min(F.H, v.y + v.h) - y0 };
  [["--vx", vis.x], ["--vy", vis.y], ["--vw", vis.w], ["--vh", vis.h]].forEach(([k, n]) => f.style.setProperty(k, n + "px"));
  f.classList.toggle("narrow", vis.w < 220);
  f.classList.toggle("pannable", insp.z > 1.001);
  st.classList.toggle("has-photo", !!F.nw);
  // The divider is a position on the visible photo; the edited picture is clipped at the same
  // screen x, in the picture's own coordinates, so both halves meet exactly at the line.
  const dx = vis.x + (vis.w * ed.split) / 100;
  $("divider").style.left = dx + "px";
  $("after").style.clipPath = st.dataset.view === "split" && v.w ? `inset(0 0 0 ${((dx - v.x) / v.w) * 100}%)` : "";
  $("zoomIn").disabled = insp.z >= zoomMax(F) - 0.001; $("zoomOut").disabled = $("zoomFit").disabled = insp.z <= 1.001;
  $("zoomCtl").classList.toggle("show", insp.z > 1.001 || Date.now() < zoomCtlUntil);
  if (maskOn() && !$("brush").hidden) drawStrokes();
  placeFaceRings(v);
}
const layoutFrame = applyView;

// ---------- Choosing a face in group photos ----------
// Face tools edit one face at a time. With more than one face, the photo shows a ring on each:
// the selected one (the largest at first) is solid and labeled, the others are dashed and can
// be tapped (or reached with Tab) to switch. Nothing is ever applied to every face at once.
const faceSel = { src: "", boxes: [], i: 0, loading: null };
function ensureFaces() {
  const src = committed();
  if (faceSel.src === src) return faceSel.loading || Promise.resolve();
  const prev = faceSel.boxes[faceSel.i];
  faceSel.src = src;
  faceSel.loading = faceBoxes(src).then((boxes) => {
    if (faceSel.src !== src) return;
    faceSel.boxes = boxes; faceSel.i = 0;
    // Keep the same person selected after an edit changes the picture.
    if (prev && boxes.length > 1) {
      let bd = Infinity;
      boxes.forEach((b, i) => { const d = (b.cx - prev.cx) ** 2 + (b.cy - prev.cy) ** 2; if (d < bd) { bd = d; faceSel.i = i; } });
    }
  }).catch(() => { if (faceSel.src === src) faceSel.boxes = []; })
    .finally(() => { if (faceSel.src === src) faceSel.loading = null; renderFaceRings(); });
  return faceSel.loading;
}
const pickingFace = () => !!sel && TOOL[sel].kind === "face" && faceSel.src === committed() && faceSel.boxes.length > 1 && !ed.demo;
function renderFaceRings() {
  const box = $("facePick"), on = pickingFace();
  box.hidden = !on;
  if (!on) { box.replaceChildren(); box.dataset.key = ""; return; }
  const n = faceSel.boxes.length, key = `${faceSel.src.length}|${faceSel.src.slice(-32)}|${faceSel.i}|${n}`;
  if (box.dataset.key === key) { placeFaceRings(); return; }
  box.dataset.key = key;
  box.replaceChildren(...faceSel.boxes.map((b, i) => {
    const r = document.createElement("button");
    r.className = "face-ring" + (i === faceSel.i ? " on" : ""); r.dataset.i = i;
    r.setAttribute("aria-pressed", String(i === faceSel.i));
    r.setAttribute("aria-label", `Face ${i + 1} of ${n}${i === 0 ? ", largest" : ""}${i === faceSel.i ? ", selected" : ""}`);
    if (i === faceSel.i) r.innerHTML = `<span class="face-tag">Editing</span>`;
    return r;
  }));
  placeFaceRings();
}
function placeFaceRings(v) {
  const box = $("facePick"); if (box.hidden || !box.children.length) return;
  v = v || viewRect();
  [...box.children].forEach((r) => {
    const b = faceSel.boxes[r.dataset.i], pad = 0.18;
    const w = b.w * v.w * (1 + pad * 2), h = b.h * v.h * (1 + pad * 2);
    Object.assign(r.style, { left: v.x + (b.cx * v.w) - w / 2 + "px", top: v.y + (b.cy * v.h) - h / 2 + "px", width: w + "px", height: h + "px" });
  });
}
// A ring is a button: pressing it never starts a pan, pinch or double-tap zoom on the photo.
["pointerdown", "dblclick", "touchstart"].forEach((ev) => $("facePick").addEventListener(ev, (e) => { if (e.target.closest(".face-ring")) e.stopPropagation(); }, { passive: true }));
$("facePick").addEventListener("click", (e) => {
  const r = e.target.closest(".face-ring"); if (!r) return;
  e.stopPropagation();
  const i = +r.dataset.i; if (i === faceSel.i) return;
  faceSel.i = i; renderFaceRings();
  $("facePick").querySelector(".face-ring.on").focus();
  $("alertLive").textContent = `Face ${i + 1} selected. Changes apply to this face only.`;
  if (sel && (faceSet.amt[sel] ?? 50) > 0) preview();   // the preview moves to the chosen face
});
let zoomCtlUntil = 0, zoomCtlTimer = 0;
function pokeZoomCtl() {
  zoomCtlUntil = Date.now() + 2500; $("zoomCtl").classList.add("show");
  clearTimeout(zoomCtlTimer); zoomCtlTimer = setTimeout(applyView, 2600);
}
const stagePt = (e) => { const r = $("stage").getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
// Zooms to z keeping the picture point under (x, y) where it is; `centre` brings it to the middle.
function zoomTo(z, x, y, { centre = false, animate = false } = {}) {
  const F = fitRect(); if (!F.nw) return;
  const v = viewRect(F), px = (x - v.x) / v.w, py = (y - v.y) / v.h;
  const z1 = Math.max(1, Math.min(zoomMax(F), z)), w = F.w * z1, h = F.h * z1;
  const to = centre ? { z: z1, cx: px, cy: py } : { z: z1, cx: (F.W / 2 - (x - px * w)) / w, cy: (F.H / 2 - (y - py * h)) / h };
  cancelAnimationFrame(zoomAnim);
  if (!animate || reduceMotion()) { Object.assign(insp, to); applyView(); return; }
  const from = { z: insp.z, cx: insp.cx, cy: insp.cy }, t0 = performance.now();
  const step = (t) => {
    const k = Math.min(1, (t - t0) / 200), e = 1 - (1 - k) ** 3;
    insp.z = from.z + (to.z - from.z) * e; insp.cx = from.cx + (to.cx - from.cx) * e; insp.cy = from.cy + (to.cy - from.cy) * e;
    applyView(); if (k < 1) zoomAnim = requestAnimationFrame(step);
  };
  zoomAnim = requestAnimationFrame(step);
}
const reduceMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const zoomBy = (k) => { const F = fitRect(); pokeZoomCtl(); zoomTo(insp.z * k, F.W / 2, F.H / 2, { animate: true }); sayZoom(); };
// Screen readers hear the zoom level after the buttons or keys change it.
const sayZoom = () => setTimeout(() => { $("alertLive").textContent = insp.z <= 1.001 ? "Photo fits the screen" : `Zoom ${Math.round(insp.z * 100)}%`; }, 260);
$("zoomIn").addEventListener("click", () => zoomBy(1.6));
$("zoomOut").addEventListener("click", () => zoomBy(1 / 1.6));
$("zoomFit").addEventListener("click", () => { pokeZoomCtl(); const F = fitRect(); zoomTo(1, F.W / 2, F.H / 2, { animate: true }); sayZoom(); });
function setSplit(pct) {
  ed.split = Math.max(0, Math.min(100, pct));
  applyView();
  $("handle").setAttribute("aria-valuenow", String(Math.round(ed.split)));
  $("handle").setAttribute("aria-valuetext", `${Math.round(ed.split)}% original`);
  renderFaceRings();
}
// Compare is one button outside the photo, so it never competes with pinching or brushing.
// A tap (or Enter / Space) steps through split, original and back to the edit; pressing and
// holding shows the original only while held. Zoom and position are kept across views.
let holding = null;
function setView(v) {
  if (v === "split" && ed.view !== "split") centerDividerOnFace();
  ed.view = v; renderEditor();
  if (v === "split") $("alertLive").textContent = "Compare: drag the divider, or use the arrow keys on it.";
  else $("alertLive").textContent = v === "original" ? "Showing the original." : "Showing your edit.";
}
$("compareBtn").addEventListener("pointerdown", (e) => {
  if ($("compareBtn").disabled || (e.pointerType === "mouse" && e.button !== 0)) return;
  holding = { prev: ed.view, held: false };
  holding.timer = setTimeout(() => { if (holding) { holding.held = true; ed.view = "original"; renderEditor(); } }, 300);
});
const holdEnd = () => {
  if (!holding) return;
  clearTimeout(holding.timer);
  if (holding.held) { ed.view = holding.prev; holding.skipClick = true; renderEditor(); }
  const h = holding; setTimeout(() => { if (holding === h) holding = null; }, 0);
};
["pointerup", "pointercancel", "pointerleave"].forEach((ev) => $("compareBtn").addEventListener(ev, holdEnd));
$("compareBtn").addEventListener("contextmenu", (e) => e.preventDefault());
$("compareBtn").addEventListener("click", () => {
  const h = holding; holding = null;
  if (h && h.skipClick) return;
  setView({ edited: "split", split: "original", original: "edited" }[ed.view] || "edited");
});
// Revert adds a step that returns to the original photo. It is an ordinary step, so Undo
// brings the edits back, and the original itself is never changed.
$("revertBtn").addEventListener("click", async () => {
  if ($("revertBtn").disabled) return;
  const c = await ask({ title: "Revert to the original?", text: "All edits are removed from the photo. Undo brings them back.", actions: [
    { label: "Revert", value: "yes" }, { label: "Cancel", value: "", kind: "ghost" }] });
  if (c !== "yes") return;
  if (sel) selectTool(null, { discard: true });
  previewToken++;
  commit(ed.hist[0].data, null, { tool: "revert", fixed: true, revert: true }, ed.hist[0].full);
  renderEditor(); say("Reverted to the original. Undo brings your edits back.");
});
$("shareBtn").addEventListener("click", () => saveEdit({ share: true }));
// Compare starts with the divider down the middle of the face when one is known (the
// landmarks found by a face tool) and in view, otherwise down the middle of the visible photo.
function centerDividerOnFace() {
  const faces = faceCache.get(committed()) || faceCache.get(ed.pending ? ed.pending.data : "") || [];
  ed.split = 50;
  if (!faces.length) return;
  const v = viewRect(), x = v.x + faces[0][1][0] * v.w;
  if (x > vis.x && x < vis.x + vis.w && vis.w) ed.split = Math.max(5, Math.min(95, ((x - vis.x) / vis.w) * 100));
}
// Gestures on the photo. Pointers are re-based whenever one is added or lifted, so a pinch
// that becomes a one-finger pan (or the reverse) never jumps. In Compare, dragging on the
// divider line moves it; anywhere else one finger pans (once zoomed) and two fingers pinch.
const navPtrs = new Map();
let ng = null, divDrag = null, divPt = null, lastTap = null;
function navBase() {
  const pts = [...navPtrs.values()].slice(0, 2);
  if (!pts.length) { ng = null; return; }
  const F = fitRect(), v = viewRect(F), m = pts.length > 1 ? { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 } : pts[0];
  ng = { ...(ng || { t: performance.now(), x0: m.x, y0: m.y, moved: 0, n: 0 }), F, z: insp.z, m, px: (m.x - v.x) / v.w, py: (m.y - v.y) / v.h,
    d: pts.length > 1 ? Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) : 0 };
  ng.n = Math.max(ng.n, pts.length);
}
function navMove() {
  const pts = [...navPtrs.values()].slice(0, 2); if (!ng || !pts.length || !ng.F.nw) return;
  const m = pts.length > 1 ? { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 } : pts[0];
  const d = pts.length > 1 ? Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) : 0, F = ng.F;
  ng.moved = Math.max(ng.moved, Math.hypot(m.x - ng.x0, m.y - ng.y0));
  insp.z = Math.max(1, Math.min(zoomMax(F), ng.d && d ? (ng.z * d) / ng.d : ng.z));
  const w = F.w * insp.z, h = F.h * insp.z;
  insp.cx = (F.W / 2 - (m.x - ng.px * w)) / w; insp.cy = (F.H / 2 - (m.y - ng.py * h)) / h;
  applyView();
}
function navDown(e) {
  cancelAnimationFrame(zoomAnim); hideZoomHint();
  navPtrs.set(e.pointerId, stagePt(e)); navBase();
}
function navUp(e) {
  if (!navPtrs.delete(e.pointerId)) return;
  if (navPtrs.size) { navBase(); return; }
  const g = ng; ng = null;
  if (!g || e.type === "pointercancel" || g.n > 1 || g.moved > 10 || performance.now() - g.t > 300) { lastTap = null; return; }
  const now = performance.now(), p = { x: g.x0, y: g.y0 };
  if (lastTap && now - lastTap.t < 320 && Math.hypot(p.x - lastTap.x, p.y - lastTap.y) < 30) {
    lastTap = null;   // double-tap: close-up centred on the tap, or back to fit
    if (insp.z > 1.05) zoomTo(1, p.x, p.y, { animate: true }); else zoomTo(Math.min(3, zoomMax(fitRect())), p.x, p.y, { centre: true, animate: true });
  } else lastTap = { ...p, t: now };
}
const onDivider = (e) => $("stage").dataset.view === "split" && $("stage").classList.contains("has-after") &&
  (e.target.closest("#handle") || Math.abs(stagePt(e).x - parseFloat($("divider").style.left || 0)) <= 22);
$("frame").addEventListener("pointerdown", (e) => {
  if (cr || (e.pointerType === "mouse" && e.button !== 0)) return;
  if (dropper) { e.preventDefault(); dropColor(e); return; }
  $("frame").setPointerCapture(e.pointerId);
  if (!navPtrs.size && divDrag == null && onDivider(e)) { divDrag = e.pointerId; divPt = stagePt(e); hideZoomHint(); return; }
  if (divDrag != null) { navPtrs.set(divDrag, divPt); divDrag = null; }   // a second finger turns a divider drag into a pinch
  navDown(e);
});
$("frame").addEventListener("pointermove", (e) => {
  if (divDrag === e.pointerId) { divPt = stagePt(e); setSplit(((divPt.x - vis.x) / vis.w) * 100); return; }
  if (!navPtrs.has(e.pointerId)) return;
  navPtrs.set(e.pointerId, stagePt(e)); navMove();
});
["pointerup", "pointercancel"].forEach((ev) => $("frame").addEventListener(ev, (e) => {
  if (divDrag === e.pointerId) { divDrag = null; return; }
  navUp(e);
}));
// Desktop: the wheel (or a trackpad pinch) zooms around the cursor, only over the photo.
$("frame").addEventListener("wheel", (e) => {
  if (cr || !fitRect().nw) return;
  e.preventDefault(); pokeZoomCtl(); hideZoomHint();
  const d = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY, p = stagePt(e);
  zoomTo(insp.z * Math.exp(-d * (e.ctrlKey ? 0.01 : 0.0025)), p.x, p.y);
}, { passive: false });
$("frame").addEventListener("dblclick", (e) => e.preventDefault());
// A one-time hint the first time a photo opens in the editor.
let hintTimer = 0;
function maybeZoomHint() {
  if (localStorage.getItem("glow.zoomHint") || !$("zoomHint").hidden || $("toast").classList.contains("on") || !fitRect().nw) return;
  try { localStorage.setItem("glow.zoomHint", "1"); } catch {}
  $("zoomHint").textContent = matchMedia("(pointer: coarse)").matches ? "Pinch or double-tap to zoom" : "Scroll or double-click to zoom";
  $("zoomHint").hidden = false; $("zoomHint").classList.remove("gone"); $("frame").classList.add("hinting");
  hintTimer = setTimeout(hideZoomHint, 3500);
}
function hideZoomHint() {
  if ($("zoomHint").hidden) return;
  clearTimeout(hintTimer); $("zoomHint").classList.add("gone");
  setTimeout(() => { $("zoomHint").hidden = true; $("frame").classList.remove("hinting"); }, 400);
}
new ResizeObserver(() => { applyView(); if (maskOn()) drawStrokes(); if (cr) renderCrop(); }).observe($("stage"));
// ---------- Expanded view ----------
// A near full-screen look at the photo: the header and the tool panels step aside and nothing
// else changes (the preview, zoom, position, comparison and unapplied settings all stay).
// Close, Escape or the browser/phone Back button bring the editing layout back.
let expanded = false;
function setExpanded(on, fromHistory) {
  if (on === expanded) return;
  expanded = on;
  $("editorScreen").classList.toggle("viewer-expanded", on);
  const b = $("expandView");
  b.setAttribute("aria-pressed", String(on)); b.setAttribute("aria-label", on ? "Close full view" : "Expand photo"); setIcon(b, on ? "shrink" : "expand");
  if (on) { try { history.pushState({ glowView: 1 }, ""); } catch {} }
  else if (!fromHistory && history.state && history.state.glowView) history.back();
  $("alertLive").textContent = on ? "Full view. Close, Escape or Back returns to editing." : "Editing controls are back.";
}
$("expandView").addEventListener("click", () => setExpanded(!expanded));
addEventListener("popstate", () => { if (expanded) setExpanded(false, true); });
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && expanded && !document.querySelector("dialog[open]")) { e.preventDefault(); setExpanded(false); }
});
// Keyboard: + and - zoom, 0 fits, and the arrow keys pan once zoomed (not while typing,
// not on the Compare handle or a slider, and not in crop, which has its own keys).
document.addEventListener("keydown", (e) => {
  if (screen !== "editorScreen" || cr || e.ctrlKey || e.metaKey || e.altKey || !fitRect().nw || document.querySelector("dialog[open]")) return;
  const t = e.target; if (t.closest && t.closest("input, textarea, select, [role=slider], .tools, .tabs, .chips")) return;
  const F = fitRect(), k = e.key, pan = 48 / (F.w * insp.z);
  if (k === "+" || k === "=") zoomBy(1.6);
  else if (k === "-" || k === "_") zoomBy(1 / 1.6);
  else if (k === "0") { pokeZoomCtl(); zoomTo(1, F.W / 2, F.H / 2, { animate: true }); sayZoom(); }
  else if (insp.z > 1.001 && k.startsWith("Arrow") && t === document.body) {
    insp.cx += k === "ArrowLeft" ? -pan : k === "ArrowRight" ? pan : 0; insp.cy += k === "ArrowUp" ? -pan : k === "ArrowDown" ? pan : 0; applyView();
  } else return;
  e.preventDefault();
});
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
  if (t) track("edit", { tool: t.id, kind: t.kind || "", demo: !!ed.demo });
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
// Four tabs at the bottom: Retouch, Looks, Edit, AI. Each shows one row of tools in small
// labeled groups. Search (the last tile) covers every tool, with favorites and recent tools first,
// and is the way to the advanced body tools.
let searching = false;
function groupsFor(c) {
  const all = [...Object.values(CATS).flat(), ...ADVANCED];
  if (searching) {
    const q = $("searchInput").value.trim().toLowerCase();
    if (!q) {
      const g = [];
      if (favs.length) g.push(["fav", "Favorites", favs]);
      if (recent.length) g.push(["recent", "Recent", recent.filter((id) => !favs.includes(id)).slice(0, 6)]);
      return [...g, ...all.map(([k, name, ids]) => [k, `${TAB_NAMES[(tabFor(ids[0]) || [])[0]] ? TAB_NAMES[tabFor(ids[0])[0]] + " · " : ""}${name}`, ids])];
    }
    return all.map(([k, name, ids]) => [k, name, ids.filter((id) => TOOL[id] && `${TOOL[id].label} ${TOOL[id].title} ${name}`.toLowerCase().includes(q))]).filter((x) => x[2].length);
  }
  return CATS[c];
}
function renderTabs() {
  document.querySelectorAll("#tabs .tab").forEach((t) => {
    const on = t.dataset.cat === cat;
    t.setAttribute("aria-selected", String(on)); t.tabIndex = on ? 0 : -1;
  });
  $("searchBox").hidden = !searching;
}
// Remove, Fill and Expand are always listed under AI, even where they can't run (the sample, or
// Fill before the server has it), with a badge saying why, instead of silently disappearing.
const toolShown = (id) => !RETIRED.includes(id) && (demoOffers(id) || (ed.demo && CATS.ai[0][2].includes(id)));
function toolBadge(t) {
  if (ed.demo && t.kind === "ai") return demo && demo.ready.includes(t.id) ? ["Preview", ", prepared preview, no credits"] : [null, ", needs your own photo"];   // the panel explains; a badge on every tile was noise
  if (!aiLive(t.id)) return ["Soon", ", not available yet"];
  const cost = costOf(t);
  return cost ? [`AI · ${cost}`, `, uses ${credits(cost)}`] : [null, ", free"];
}
function toolButton(t) {
  const b = document.createElement("button");
  b.className = "tool" + (t.kind === "filter" ? " thumb" : ""); b.dataset.tool = t.id;
  b.setAttribute("aria-pressed", String(sel === t.id));
  const [badge, spoken] = toolBadge(t);
  b.setAttribute("aria-label", t.label + spoken);
  const well = document.createElement("i"); well.className = "well";
  if (t.kind === "filter") {
    if (thumb) { well.style.backgroundImage = `url(${faceThumb || thumb})`; well.style.filter = t.filter.f; }
  } else if (["adjust", "crop", "bg"].includes(t.kind)) {
    well.innerHTML = icon(t.id);   // photo controls read better as icons than as faces
  } else {
    // Every other tool shows the face it will change, with the tool's icon on a small badge;
    // the sample's AI tools show their prepared result.
    const pic = ed.demo && demo && demo.ready.includes(t.id) ? `${DEMO_DIR}thumbs/${t.id}.jpg` : faceThumb;
    if (pic) {
      b.classList.add("photo"); well.style.backgroundImage = `url(${pic})`;
      const g = document.createElement("span"); g.className = "glyph"; g.setAttribute("aria-hidden", "true"); g.innerHTML = icon(t.id); well.append(g);
    } else well.innerHTML = icon(t.id);
  }
  if (badge) { const c = document.createElement("span"); c.className = "cost"; c.textContent = badge; c.setAttribute("aria-hidden", "true"); well.append(c); }
  const name = document.createElement("span"); name.className = "name"; name.textContent = t.label;
  b.append(well, name);
  return b;
}
function renderTools() {
  const groups = groupsFor(cat).map((g) => [g[0], g[1], g[2].filter((id) => TOOL[id] && toolShown(id))]).filter((g) => g[2].length), box = $("tools");
  if (!groups.length && searching) { box.innerHTML = `<p class="empty-note">No tools match that search.</p>`; return; }
  renderToolGroups(box, groups, true);   // group names show in Search and on wide screens; a phone tab is one plain row
  if (!searching) {
    // Search sits at the end of every row.
    const b = document.createElement("button"); b.className = "tool search-tile"; b.id = "searchBtn";
    b.setAttribute("aria-label", "Search all tools"); b.setAttribute("aria-expanded", "false");
    b.innerHTML = `<i class="well">${icon("search")}</i><span class="name">Search</span>`;
    const g = document.createElement("div"); g.className = "group";
    const items = document.createElement("div"); items.className = "group-items"; items.append(b); g.append(items); box.append(g);
  }
}
function renderToolGroups(box, groups, showLabels) {
  box.replaceChildren(...groups.map(([, name, ids]) => {
    const g = document.createElement("div"); g.className = "group"; g.setAttribute("role", "group"); g.setAttribute("aria-label", name);
    if (showLabels) { const l = document.createElement("span"); l.className = "group-label"; l.textContent = name; l.setAttribute("aria-hidden", "true"); g.append(l); }
    const items = document.createElement("div"); items.className = "group-items";
    items.append(...ids.filter((id) => TOOL[id] && toolShown(id)).map((id) => toolButton(TOOL[id])));
    g.append(items); return g;
  }));
}
async function refreshThumb() {
  const src = committed();
  try {
    const img = await loadImg(src), c = canvasFor(img, 120);
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height); thumb = c.toDataURL("image/jpeg", 0.8);
    faceThumb = faceSquare(img, tileFace.dims === `${img.width}x${img.height}` ? tileFace.box : null);
  } catch { thumb = ""; faceThumb = ""; }
  if (screen === "editorScreen") renderTools();
  // Find the face once per picture size (edits rarely move it); later edits reuse the box.
  if (thumb && !tileFace.box) {
    try {
      const img = await loadImg(src), boxes = await faceBoxes(src);
      if (boxes[0] && src === committed()) {
        tileFace.dims = `${img.width}x${img.height}`; tileFace.box = boxes[0];
        faceThumb = faceSquare(img, boxes[0]);
        if (screen === "editorScreen") renderTools();
      }
    } catch {}
  }
}
// A small square around the largest face (or the upper middle when none is known yet).
let faceThumb = "";
const tileFace = { dims: "", box: null };
function faceSquare(img, box) {
  const W = img.width, H = img.height;
  const side = box ? Math.min(W, H, Math.max(box.w * W, box.h * H) * 1.9) : Math.min(W, H) * 0.62;
  const cx = box ? box.cx * W : W / 2, cy = box ? box.cy * H : Math.min(H * 0.34, H - side / 2);
  const x = Math.max(0, Math.min(W - side, cx - side / 2)), y = Math.max(0, Math.min(H - side, cy - side / 2));
  const c = document.createElement("canvas"); c.width = c.height = 120;
  c.getContext("2d").drawImage(img, x, y, side, side, 0, 0, 120, 120);
  return c.toDataURL("image/jpeg", 0.8);
}
function setSearching(on) {
  if (on && sel) selectTool(null);
  searching = on; toolsOpen = on;
  if (!on) $("searchInput").value = "";
  $("editorScreen").classList.toggle("tools-open", on && !sel); renderTabs(); renderTools(); fitDock();
  if (on) $("searchInput").focus(); else if ($("searchBtn")) $("searchBtn").focus();
}
$("tabs").addEventListener("click", (e) => {
  const t = e.target.closest(".tab"); if (!t) return;
  if (sel) selectTool(null);
  if (searching) { searching = false; toolsOpen = false; $("searchInput").value = ""; }
  cat = t.dataset.cat; store.set("glowCat", cat); $("tools").scrollTo(0, 0);
  $("editorScreen").classList.remove("tools-open"); renderTabs(); renderTools();
});
$("tabs").addEventListener("keydown", (e) => {
  if (!["ArrowLeft", "ArrowRight"].includes(e.key)) return;
  const tabs = [...document.querySelectorAll("#tabs .tab")], i = tabs.findIndex((t) => t.dataset.cat === cat);
  const n = tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length]; n.click(); n.focus();
});
$("searchInput").addEventListener("input", renderTools);
$("searchClose").addEventListener("click", () => setSearching(false));
$("searchInput").addEventListener("keydown", (e) => { if (e.key === "Escape") { e.preventDefault(); setSearching(false); } });
$("tools").addEventListener("click", (e) => {
  const b = e.target.closest(".tool"); if (!b || busyNow) return;
  if (b.id === "searchBtn") { setSearching(true); return; }
  Platform.haptic();
  selectTool(sel === b.dataset.tool ? null : b.dataset.tool);
});

// ---------- Selected tool panel ----------
function discardPending() { if (ed.pending) { ed.pending = null; previewToken++; } }
// Leaving a free tool keeps its change: switching tools or tabs commits the preview as one
// Undo step (one per tool visit, never one per slider move). Cancel and Escape discard it.
function selectTool(id, opts = {}) {
  if (cr && !opts.discard && cropChanged() && !busyNow) { applyCrop().then(() => { if (id) selectTool(id); }); return; }
  // Trying one filter (or background) after another swaps it: they never pile up on each other.
  const swap = (k) => k === "filter" || k === "look" ? "filter" : k === "bg" ? "bg" : null;
  if (ed.pending && id && TOOL[id] && ed.pending.tool !== id && !opts.discard && swap(TOOL[ed.pending.tool].kind) && swap(TOOL[ed.pending.tool].kind) === swap(TOOL[id].kind)) discardPending();
  else if (ed.pending && ed.pending.tool !== id && !opts.discard) {
    const p = ed.pending, t = TOOL[p.tool];
    commit(p.data, t, p.op); previewToken++;
    say(`${t.title} kept. Undo removes it.`);
  } else if (ed.pending && opts.discard) { say(`${TOOL[ed.pending.tool].title} discarded.`); discardPending(); }
  else discardPending();
  if (cr) closeCrop();
  if (id !== sel) { panelCollapsed = false; filterAmt = 100; }   // a newly opened tool always shows its controls
  if (searching && id) { searching = false; $("searchInput").value = ""; $("editorScreen").classList.remove("tools-open"); const home = tabFor(id); if (home) cat = home[0]; }
  sel = id; strokes = []; outfitData = null; toolsOpen = false; panelBuilt = null; reshapeNote = null; picking = null;
  dropper = false; $("stage").classList.remove("dropping");
  lookPick = editorLooks().some((l) => l.id === lookId) ? lookId : "natural";
  if (id in toolAmt) toolAmt[id] = 0; // adjustments start from the committed photo
  if (ed.demo && id) {
    const t = TOOL[id];
    // One effect at a time: a prepared preview always starts from the original, and so does
    // an on-device tool picked while a prepared preview is showing.
    if (t.kind === "ai" && demo && demo.ready.includes(id)) { showDemoPreview(id); return; }
    if (ed.idx > 0 && ed.hist.some((h) => h.op && h.op.demo)) demoReset("Back to the original. Sample previews show one effect at a time.");
  }
  renderEditor();
  if (id) {
    const t = TOOL[id];
    if (t.kind === "adjust") return; // previews once changed
    if (t.kind === "crop") { openCrop().catch((err) => { say(err.message, true); selectTool(null); }); return; }
    if (t.kind === "face") ensureFaces();
    if (t.kind === "face" && t.reshape) checkReshape(id);
    if (t.kind === "face" || t.kind === "body" || t.kind === "hair") { if ((faceSet.amt[id] ?? 50) > 0) preview(); return; }
    if (t.kind === "look") { preview(); return; }
    if (t.kind === "glowup") { ensureFaces(); preview(); return; }
    if (t.kind === "filter" || t.kind === "bg") preview();
  }
}
$("cancelBtn").addEventListener("click", () => (reviewing() ? discardResult() : selectTool(null, { discard: true })));
// Discarding a finished AI result: the credit was spent when it was made and isn't returned,
// so this asks first. Remove / Fill marks stay, ready for another try.
async function discardResult() {
  if (!job || job.status !== "done") return;
  const t = TOOL[job.tool];
  const c = await ask({ title: `Discard this ${t.title} result?`, text: "The AI credit it used isn't returned. Your marks stay, so you can adjust them and try again.",
    actions: [{ label: "Discard", value: "yes" }, { label: "Keep reviewing", value: "", kind: "ghost" }] });
  if (!c || !job || job.status !== "done") return;
  job = null; saveJob(); renderEditor(); say(`${t.title} result discarded.`);
}
// Applying it adds one Undo step. A result made from an earlier version of the photo replaces
// the current version, so that case asks first.
async function applyResult() {
  if (!resultReady()) return;
  const r = job.result, t = TOOL[job.tool];
  if (ed.idx !== job.baseIdx) {
    const c = await ask({ title: `Use the ${t.title} result?`, text: "It was made from an earlier version of this photo, so edits made since then won't be in it. Undo brings them back.",
      actions: [{ label: "Use it", value: "yes" }, { label: "Not now", value: "", kind: "ghost" }] });
    if (!c || !resultReady()) return;
  }
  const then = job.glow;
  job = null; saveJob();
  commit(r.data, t, { tool: t.id, fixed: true }, r.full); strokes = []; if (sel === t.id) sel = null;
  renderEditor(); say(`${t.title} applied. Undo removes it.`); Platform.haptic();
  if (then) {
    // Glow Up: now the free steps, on top of the AI result, as their own Undo step.
    setBusy(true, "Glow Up…");
    try { const data = await computeOp(then, committed()); if (data && data !== committed()) commit(data, t, then); say("Glow Up applied: the AI step and your free steps are separate Undo steps."); }
    catch (err) { say(err.message, true); } finally { setBusy(false); renderEditor(); }
  }
}
$("favBtn").addEventListener("click", () => {
  if (!sel) return;
  favs = favs.includes(sel) ? favs.filter((x) => x !== sel) : [sel, ...favs].slice(0, 8);
  store.set("glowFavs", JSON.stringify(favs)); renderPanel(); if (searching) renderTools();
  say(favs.includes(sel) ? "Added to favorites. Find them in Search." : "Removed from favorites.");
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
// Glow Up: what she ticked. Saved as "My routine" when she asks, and used as the starting point.
const GLOW_ITEMS = [
  ["Skin", [["fsmooth", "Smooth skin", 0.5, true], ["fblemish", "Blemishes", 0.7, true], ["ftone", "Even tone", 0.45, true], ["fundereye", "Under-eyes", 0.6, true]]],
  ["Eyes and smile", [["feyes", "Brighter eyes", 0.5, true], ["fteeth", "Whiter teeth", 0.5, true], ["flashes", "Lashes", 0.45, false], ["fliner", "Liner", 0.45, false], ["feyecolor", "Eye color", 0.55, false]]],
  ["Makeup", [["flips", "Lips", 0.5, false], ["fblush", "Blush", 0.45, false], ["fbrows", "Brows", 0.4, false], ["fcontour", "Contour", 0.4, false], ["fhighlight", "Highlighter", 0.4, false]]],
];
const GLOW_AI = [["No AI", null], ["Pro edit", "pro"], ["New background", "bgscene"], ["Your words", "custom"]];
const glowDefaults = () => ({ on: Object.fromEntries(GLOW_ITEMS.flatMap(([, items]) => items.map(([id, , , on]) => [id, on]))), look: null, slim: false, light: true, ai: null, words: "", strength: 60 });
let glow = glowDefaults();
try { const g = JSON.parse(store.get("glowRoutine") || "null"); if (g && g.on) glow = { ...glowDefaults(), ...g, on: { ...glowDefaults().on, ...g.on }, words: "" }; } catch {}
// The free part as a recipe: [tool, strength, shade, style] per ticked step, plus face shape and light.
function glowRecipe() {
  const k = glow.strength / 60, face = [];
  for (const [, items] of GLOW_ITEMS) for (const [id, , amt] of items) if (glow.on[id]) face.push([id, Math.min(1, amt * k), null, null]);
  if (glow.look) face.push(["fglam", Math.min(1, 0.45 * k), null, glow.look]);
  return { face, slim: glow.slim ? Math.min(1, 0.4 * k) : 0, light: glow.light };
}
// Backgrounds: the photo she picked, and the AI scene (a preset or her own words).
let bgPhoto = null, bgBlur = false, scenePick = "studio", sceneText = "";
// Color background: four studio colors, each with a soft light falloff like a paper backdrop.
const BG_COLORS = [["Ivory", "ivory", "#f7f1ea"], ["White", "white", "#ffffff"], ["Blush", "blush", "#f3dde2"], ["Black", "black", "#1a1518"]];
let bgColorPick = "ivory";
const colorFill = (id) => (ctx, w, h) => {
  const hex = (BG_COLORS.find((c) => c[1] === id) || BG_COLORS[0])[2];
  ctx.fillStyle = hex; ctx.fillRect(0, 0, w, h);
  const g = ctx.createRadialGradient(w / 2, h * 0.35, 0, w / 2, h * 0.35, Math.max(w, h) * 0.8);
  g.addColorStop(0, id === "black" ? "rgb(255 255 255 / 0.07)" : "rgb(255 255 255 / 0.35)"); g.addColorStop(1, "rgb(0 0 0 / 0.06)");
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
};
const SCENES = [["Studio", "studio", "a clean professional photo studio backdrop in soft warm beige with a gentle light gradient"],
  ["Beach", "beach", "a sunny tropical beach with a soft turquoise sea and sky, shallow depth of field"],
  ["City lights", "city", "a city street at night with warm bokeh lights, shallow depth of field"],
  ["Café", "cafe", "a cozy, stylish café interior with warm light, softly out of focus"],
  ["Garden", "garden", "a lush flower garden in soft daylight, softly out of focus"],
  ["Sunset", "sunset", "a golden sunset sky over the sea with a warm glow"],
  ["Paris", "paris", "a Paris street with the Eiffel Tower in the distance, softly out of focus"],
  ["Luxury", "luxury", "an elegant luxury hotel lobby with marble and warm lights, softly out of focus"]];
const scenePrompt = () => sceneText.trim().slice(0, 200) || SCENES.find((x) => x[1] === scenePick)[2];
// Colors: the curated shades, then the ones she made herself, then "+" for any other color and
// a dropper to take a color from the photo.
let picking = null;    // the open color picker: { tool, h, s, l, was }
let dropper = false;   // the next tap on the photo picks a color from it
function colorRow(t) {
  const row = swatches([...SHADES[t.id], ...(faceSet.custom[t.id] || [])], faceSet.shade[t.id], (c) => { faceSet.shade[t.id] = c; saveFace(); renderPanel(true); preview(); });
  row.classList.add("color-row");
  const add = document.createElement("button"); add.className = "swatch more"; add.setAttribute("aria-label", "Any color"); add.innerHTML = `<i>${icon("plus")}</i>`;
  add.addEventListener("click", () => { const [h, s2, l] = hexToHsl(faceSet.shade[t.id]); picking = { tool: t.id, h, s: s2, l, was: faceSet.shade[t.id] }; dropper = false; renderPanel(true); });
  const drop = document.createElement("button"); drop.className = "swatch more"; drop.id = "dropperBtn"; drop.setAttribute("aria-label", "Pick a color from the photo");
  drop.setAttribute("aria-pressed", String(dropper)); drop.innerHTML = `<i>${icon("dropper")}</i>`;
  drop.addEventListener("click", () => { dropper = !dropper; $("stage").classList.toggle("dropping", dropper); drop.setAttribute("aria-pressed", String(dropper)); if (dropper) say("Tap the photo to pick its color."); });
  row.prepend(add, drop);
  return row;
}
const hexOf = (r, g, b) => "#" + [r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("");
function hexToHsl(hex) {
  const [r, g, b] = [1, 3, 5].map((k) => parseInt(hex.slice(k, k + 2), 16) / 255), mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
  if (!d) return [0, 0, Math.round(l * 100)];
  const s = d / (1 - Math.abs(2 * l - 1)), h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [Math.round(((h * 60) + 360) % 360), Math.round(s * 100), Math.round(l * 100)];
}
function hslToHex(h, s, l) {
  s /= 100; l /= 100;
  const k = (n) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l), f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return hexOf(f(0) * 255, f(8) * 255, f(4) * 255);
}
// Keeps a color she chose for this tool (newest first, up to 8).
function keepColor(id, c) {
  if (SHADES[id].includes(c)) return;
  faceSet.custom[id] = [c, ...(faceSet.custom[id] || []).filter((x) => x !== c)].slice(0, 8);
}
// The picker: hue, richness and shade, each a slider whose track shows the colors it gives.
function colorPicker(t, body) {
  const p = picking, tracks = () => {
    body.querySelector(".cs-h").style.setProperty("--track", "linear-gradient(90deg, " + [0, 60, 120, 180, 240, 300, 360].map((h) => hslToHex(h, Math.max(40, p.s), Math.min(60, Math.max(40, p.l)))).join(", ") + ")");
    body.querySelector(".cs-s").style.setProperty("--track", `linear-gradient(90deg, ${hslToHex(p.h, 0, p.l)}, ${hslToHex(p.h, 100, p.l)})`);
    body.querySelector(".cs-l").style.setProperty("--track", `linear-gradient(90deg, ${hslToHex(p.h, p.s, 8)}, ${hslToHex(p.h, p.s, 50)}, ${hslToHex(p.h, p.s, 92)})`);
    const sw = $("pickSwatch"); if (sw) sw.style.background = hslToHex(p.h, p.s, p.l);
  };
  const live = () => { tracks(); faceSet.shade[t.id] = hslToHex(p.h, p.s, p.l); clearTimeout(adjustTimer); adjustTimer = setTimeout(preview, 150); };
  for (const [label, key, min, max, cls] of [["Color", "h", 0, 359, "cs-h"], ["Richness", "s", 0, 100, "cs-s"], ["Shade", "l", 8, 92, "cs-l"]]) {
    const sl = slider(label, min, max, p[key], (v) => { p[key] = v; live(); }, (v) => { p[key] = v; live(); }, () => "");
    sl.classList.add("color-slider", cls); body.append(sl);
  }
  const sw = document.createElement("i"); sw.id = "pickSwatch"; sw.className = "pick-swatch head-extra"; sw.setAttribute("aria-hidden", "true");
  const done = document.createElement("button"); done.className = "link-btn head-extra"; done.id = "pickDone"; done.textContent = "Done";
  done.addEventListener("click", () => { const c = hslToHex(p.h, p.s, p.l); faceSet.shade[t.id] = c; keepColor(t.id, c); saveFace(); picking = null; renderPanel(true); preview(); });
  $("collapseBtn").before(sw, done);
  tracks();
}
// The Glow Up checklist: tick boxes in groups, a look, face shape, light, one optional AI step.
function glowPanel(body) {
  const again = () => { renderPanel(true); clearTimeout(adjustTimer); adjustTimer = setTimeout(preview, 150); };
  body.append(slider("Strength", 10, 100, glow.strength, (v) => { glow.strength = v; clearTimeout(adjustTimer); adjustTimer = setTimeout(preview, 200); }, (v) => { glow.strength = v; preview(); }));
  const group = (name, items) => {
    const g = document.createElement("div"); g.className = "glow-group"; g.setAttribute("role", "group"); g.setAttribute("aria-label", name);
    const h = document.createElement("span"); h.className = "glow-label"; h.textContent = name;
    const row = document.createElement("div"); row.className = "opts glow-opts";
    row.append(...items.map(([label, on, flip]) => {
      const b = document.createElement("button"); b.className = "opt check"; b.textContent = label; b.setAttribute("aria-pressed", String(!!on));
      b.addEventListener("click", () => { flip(); again(); }); return b;
    }));
    g.append(h, row); body.append(g);
  };
  for (const [name, items] of GLOW_ITEMS) group(name, items.map(([id, label]) => [label, glow.on[id], () => { glow.on[id] = !glow.on[id]; }]));
  group("Face and light", [["Slimmer face", glow.slim, () => { glow.slim = !glow.slim; }], ["Light and color", glow.light, () => { glow.light = !glow.light; }]]);
  const looks = STYLES.fglam.filter(([, v]) => v !== "mine");
  const lg = document.createElement("div"); lg.className = "glow-group";
  const ll = document.createElement("span"); ll.className = "glow-label"; ll.textContent = "Makeup look";
  const lrow = options([["None", null], ...looks], (v) => v === glow.look, (v) => { glow.look = v; again(); });
  lrow.setAttribute("role", "group"); lrow.setAttribute("aria-label", "Makeup look"); lg.append(ll, lrow); body.append(lg);
  if (!ed.demo) {
    const ag = document.createElement("div"); ag.className = "glow-group";
    const al = document.createElement("span"); al.className = "glow-label"; al.textContent = "AI step (optional, runs first)";
    const arow = options(GLOW_AI.map(([label, id]) => [id ? `${label} · ${costOf(TOOL[id])}` : label, id]), (v) => v === glow.ai, (v) => { glow.ai = v; renderPanel(true); });
    arow.setAttribute("role", "group"); arow.setAttribute("aria-label", "AI step"); ag.append(al, arow); body.append(ag);
    if (glow.ai === "bgscene") {
      const row = options(SCENES.map(([label, id]) => [label, id]), (v) => v === scenePick, (v) => { scenePick = v; sceneText = ""; renderPanel(true); });
      row.setAttribute("aria-label", "Scene"); body.append(row);
    }
    if (glow.ai === "custom") {
      const l = document.createElement("label"); l.className = "prompt";
      const inp = document.createElement("input"); inp.type = "text"; inp.id = "glowWords"; inp.maxLength = 200; inp.autocomplete = "off";
      inp.placeholder = "e.g. warmer, less tired, softer light"; inp.value = glow.words;
      inp.addEventListener("input", () => { glow.words = inp.value; panelState(TOOL.glowup); });
      l.append(Object.assign(document.createElement("span"), { className: "sr-only", textContent: "What else to change" }), inp); body.append(l);
    }
  }
  const save = document.createElement("button"); save.className = "btn quiet small"; save.id = "saveRoutine"; save.textContent = "Save as my routine";
  save.addEventListener("click", () => { store.set("glowRoutine", JSON.stringify({ ...glow, words: "" })); say("Saved. Glow Up starts with your routine next time."); });
  body.append(save);
}
// Takes the color under a tap on the photo (a small average, so one stray pixel doesn't count).
async function dropColor(e) {
  dropper = false; $("stage").classList.remove("dropping");
  const t = sel && TOOL[sel]; if (!t || !SHADES[t.id]) return;
  const v = viewRect(), pt = stagePt(e), fx = (pt.x - v.x) / v.w, fy = (pt.y - v.y) / v.h;
  if (!(fx >= 0 && fx <= 1 && fy >= 0 && fy <= 1)) { renderPanel(true); return; }
  const img = await loadImg(committed()), c = document.createElement("canvas"); c.width = c.height = 5;
  const x = c.getContext("2d", { willReadFrequently: true });
  x.drawImage(img, fx * img.naturalWidth - 2, fy * img.naturalHeight - 2, 5, 5, 0, 0, 5, 5);
  const d = x.getImageData(0, 0, 5, 5).data; let r = 0, g = 0, b = 0;
  for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; }
  const col = hexOf(r / 25, g / 25, b / 25);
  faceSet.shade[t.id] = col; keepColor(t.id, col); saveFace(); renderPanel(true); preview();
  say("Color picked from the photo.");
}
// Save my look: the makeup steps on this photo become "My look" in Looks, for any photo.
function saveMyLook() {
  const steps = [];
  for (const h of ed.hist.slice(1, ed.idx + 1)) {
    const op = h.op; if (!op || op.revert) { if (op && op.revert) steps.length = 0; continue; }
    if (MAKEUP_TOOLS.includes(op.tool)) steps.push([op.tool, op.amt, (op.shades || {})[op.tool] || null, (op.styles || {})[op.tool] || null]);
    else if (op.tool === "fglam") {
      const name = (op.styles || {}).fglam;
      if (name === "mine") steps.push(...(op.mine || []).map(([id, k, sh, st]) => [id, clamp(k * op.amt / 0.6), sh, st]));
      else steps.push(...(LOOKS[name] || []).map(([id, k, sh, st]) => [id, clamp(k * op.amt * 1.6), sh, st]));
    }
  }
  if (!steps.length) { say("Apply some makeup to this photo first (Lips, Lashes, Blush…), then save it as your look.", true); return; }
  faceSet.mine = steps; faceSet.style.fglam = "mine"; saveFace(); renderPanel(true); preview();
  say("Saved as My look. Open Looks on any photo and choose My look.");
}
const clamp = (v) => Math.max(0, Math.min(1, v));
function options(list, isOn, onPick) {
  const box = document.createElement("div"); box.className = "opts";
  box.append(...list.map(([label, v]) => {
    const b = document.createElement("button"); b.className = "opt"; b.textContent = label; b.setAttribute("aria-pressed", String(isOn(v)));
    b.addEventListener("click", () => onPick(v)); return b;
  }));
  return box;
}
const signed = (v) => (v > 0 ? "+" + v : String(v));
let adjustTimer = 0, filterAmt = 100;

// The panel's controls are built once per tool (so a slider isn't replaced mid-drag);
// its cost, note and Apply button are refreshed on every render.
let panelBuilt = null;
function renderPanel(rebuild) {
  const t = sel && TOOL[sel];
  $("panel").hidden = !t;
  if (!t) { panelBuilt = null; fitDock(); return; }
  if (rebuild || panelBuilt !== t.id) { buildPanel(t); panelBuilt = t.id; }
  panelState(t); fitDock();
}
// On phones the controls under the photo keep one fixed height (the dock), so the photo never
// changes size as tools open, close or change. A tool whose controls need the whole dock
// hides the row of neighbouring tools instead of pushing the photo up.
const dockFixed = () => matchMedia("(max-width: 959px)").matches && !matchMedia("(min-width: 560px) and (max-height: 560px) and (orientation: landscape)").matches;
function fitDock() {
  const es = $("editorScreen"), p = $("panel");
  es.classList.remove("no-tools");
  if (!sel || panelCollapsed || p.hidden || !dockFixed()) return;
  if (p.scrollHeight > p.clientHeight + 1) es.classList.add("no-tools");
}
function buildPanel(t) {
  $("toolName").textContent = t.title; $("toolName").tabIndex = -1;
  $("favBtn").setAttribute("aria-pressed", String(favs.includes(t.id)));
  $("favBtn").setAttribute("aria-label", favs.includes(t.id) ? "Remove from favorites" : "Add to favorites");
  const body = $("panelBody");
  body.replaceChildren(); document.querySelectorAll(".panel-head .head-extra").forEach((b) => b.remove());
  $("favBtn").hidden = t.kind === "crop";

  if ((t.kind === "face" || t.kind === "hair") && picking && picking.tool === t.id) colorPicker(t, body);
  else if (t.kind === "face" || t.kind === "body" || t.kind === "hair") {
    body.append(slider("Strength", 0, 100, faceSet.amt[t.id] ?? 50, null, (v) => { faceSet.amt[t.id] = v; saveFace(); preview(); }));
    if (STYLES[t.id]) {
      const row = options(STYLES[t.id], (v) => v === faceSet.style[t.id], (v) => { faceSet.style[t.id] = v; saveFace(); renderPanel(true); preview(); });
      row.setAttribute("role", "group"); row.setAttribute("aria-label", "Style");
      if (t.id === "fglam") {
        const save = document.createElement("button"); save.className = "opt save-look"; save.textContent = "+ Save my look";
        save.addEventListener("click", saveMyLook); row.append(save);
      }
      body.append(row);
    }
    if (SHADES[t.id]) body.append(colorRow(t));
  } else if (t.kind === "filter") {
    // How much of the filter to use; 100 is the full filter (what earlier versions applied).
    body.append(slider("Strength", 0, 100, filterAmt, (v) => {
      filterAmt = v; clearTimeout(adjustTimer); adjustTimer = setTimeout(preview, 120);
    }, (v) => { filterAmt = v; clearTimeout(adjustTimer); preview(); }));
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
    // Rotate and Reset sit in the panel's title row, so the crop controls stay short.
    const rot = document.createElement("button"); rot.className = "icon-btn head-extra"; rot.innerHTML = icon("rotate"); rot.setAttribute("aria-label", "Rotate 90°");
    rot.addEventListener("click", rotateCrop);
    const rs = document.createElement("button"); rs.className = "link-btn head-extra"; rs.id = "cropReset"; rs.textContent = "Reset";
    rs.addEventListener("click", resetCrop);
    $("collapseBtn").before(rot, rs);
  } else if (t.kind === "look") {
    body.append(options(editorLooks().map((l) => [l.name, l.id]), (v) => v === lookPick, (v) => { lookPick = v; renderPanel(true); preview(); }));
  } else if (t.kind === "glowup") {
    glowPanel(body);
  } else if (t.id === "custom" && !ed.demo) {
    const l = document.createElement("label"); l.className = "prompt";
    const inp = document.createElement("input"); inp.type = "text"; inp.id = "customPrompt"; inp.maxLength = 200; inp.autocomplete = "off";
    inp.placeholder = "e.g. golden hour light, a red dress, less tired eyes"; inp.value = customText;
    inp.addEventListener("input", () => { customText = inp.value; panelState(t); });
    l.append(Object.assign(document.createElement("span"), { className: "sr-only", textContent: "Describe the edit" }), inp); body.append(l);
  } else if (t.id === "bgphoto") {
    const row = document.createElement("div"); row.className = "outfit-pick";
    if (bgPhoto) { const im = document.createElement("img"); im.src = bgPhoto; im.alt = "Background you picked"; row.append(im); }
    const b = document.createElement("button"); b.className = "btn quiet small"; b.textContent = bgPhoto ? "Change photo" : "Choose a background photo";
    b.addEventListener("click", async () => {
      const f = await Platform.pickPhoto("outfitFile");
      if (f) { try { bgPhoto = await loadAndShrink(f); } catch (err) { say(err.message, true); } renderPanel(true); preview(); }
    });
    row.append(b); body.append(row);
    body.append(options([["Sharp", false], ["Soft blur", true]], (v) => v === bgBlur, (v) => { bgBlur = v; renderPanel(true); preview(); }));
  } else if (t.id === "bgcolor") {
    const row = options(BG_COLORS.map(([label, id]) => [label, id]), (v) => v === bgColorPick, (v) => { bgColorPick = v; renderPanel(true); preview(); });
    row.setAttribute("role", "group"); row.setAttribute("aria-label", "Background color"); body.append(row);
  } else if (t.id === "bgscene" && !ed.demo) {
    const row = options(SCENES.map(([label, id]) => [label, id]), (v) => v === scenePick, (v) => { scenePick = v; renderPanel(true); });
    row.setAttribute("role", "group"); row.setAttribute("aria-label", "Scene"); body.append(row);
    const l = document.createElement("label"); l.className = "prompt";
    const inp = document.createElement("input"); inp.type = "text"; inp.id = "scenePrompt"; inp.maxLength = 200; inp.autocomplete = "off";
    inp.placeholder = "Or describe your own, e.g. a rooftop in Paris at sunset"; inp.value = sceneText;
    inp.addEventListener("input", () => { sceneText = inp.value; });
    l.append(Object.assign(document.createElement("span"), { className: "sr-only", textContent: "Describe a background (optional)" }), inp); body.append(l);
  } else if (t.id === "outfit") {
    const row = document.createElement("div"); row.className = "outfit-pick";
    if (outfitData) { const im = document.createElement("img"); im.src = outfitData; im.alt = "Outfit you picked"; row.append(im); }
    const b = document.createElement("button"); b.className = "btn quiet small"; b.textContent = outfitData ? "Change outfit photo" : "Choose outfit photo";
    b.addEventListener("click", async () => {
      const f = await Platform.pickPhoto("outfitFile");
      if (f) { try { outfitData = await loadAndShrink(f); } catch (err) { say(err.message, true); } renderPanel(true); }
    });
    row.append(b); body.append(row);
  } else if (MASK_TOOLS.includes(t.id) && !ed.demo) {
    // Paint marks the area; Erase takes marks away. Reset (in the title row) clears them all.
    const modes = options([["Paint", "paint"], ["Erase marks", "erase"]], (v) => v === brushMode, (v) => { brushMode = v; renderPanel(true); });
    modes.setAttribute("role", "group"); modes.setAttribute("aria-label", "Brush"); modes.classList.add("brush-modes");
    [...modes.children].forEach((b, i) => { b.setAttribute("aria-label", b.textContent); b.title = b.textContent; b.innerHTML = icon(i ? "eraser" : "brush"); });
    const sz = slider("Size", 8, 80, brushSize, (v) => { brushSize = v; }, (v) => { brushSize = v; }, (v) => v);
    sz.querySelector("input").setAttribute("aria-valuetext", `${brushSize} pixels`);
    sz.querySelector("input").addEventListener("input", (e) => e.target.setAttribute("aria-valuetext", `${e.target.value} pixels`));
    const row = document.createElement("div"); row.className = "brush-row"; row.append(modes, sz); body.append(row);
    if (t.id === "fill") {
      const l = document.createElement("label"); l.className = "prompt";
      const inp = document.createElement("input"); inp.type = "text"; inp.id = "fillPrompt"; inp.maxLength = 200; inp.autocomplete = "off";
      inp.placeholder = "What to add (optional), e.g. a vase of flowers"; inp.value = fillPrompt;
      inp.addEventListener("input", () => { fillPrompt = inp.value; });
      l.append(Object.assign(document.createElement("span"), { className: "sr-only", textContent: "What to add (optional)" }), inp); body.append(l);
    }
    const rs = document.createElement("button"); rs.className = "link-btn head-extra"; rs.id = "clearMarks"; rs.textContent = "Reset";
    rs.setAttribute("aria-label", "Clear all marks");
    rs.addEventListener("click", () => { strokes = []; drawStrokes(); renderPanel(); });
    $("collapseBtn").before(rs);
  }
}
function panelState(t) {
  $("cancelBtn").textContent = reviewing() ? "Discard" : "Cancel";
  if (ed.demo && t.kind === "ai") return demoPanelState(t);
  const cost = costOf(t), chip = $("cost"), apply = $("applyBtn");
  const gen = MASK_TOOLS.includes(t.id) || t.id === "expand" || t.id === "bgscene";
  let note = t.hint || "";
  if (!cost) { chip.textContent = "Free"; chip.className = "chip free"; chip.title = "Free · runs on your device"; }
  else { chip.textContent = `AI · ${credits(cost)}`; chip.className = "chip"; }
  const blocked = t.kind === "face" && reshapeNote && reshapeNote.tool === t.id ? reshapeNote : null;
  if (blocked) note = blocked.msg === null ? "Finding the face…" : blocked.msg || note;
  if (t.kind === "crop") note = "";
  if ($("clearMarks")) $("clearMarks").disabled = !strokes.length;

  // Apply: on-device tools commit the preview; AI tools charge here, once.
  apply.disabled = busyNow;
  if (!cost) {
    apply.textContent = "Apply";
    if (t.kind === "adjust") apply.disabled ||= !ed.pending;
    if (t.id === "bgphoto" && !bgPhoto) apply.disabled = true;
    if (t.reshape) apply.disabled ||= !(faceSet.amt[t.id] > 0) || !!(blocked && blocked.msg !== "");
    else if (blocked && blocked.msg) apply.disabled = true;
    if (picking) apply.disabled = true;   // Done (in the title row) closes the picker first
    if (t.kind === "crop") apply.disabled ||= !cropChanged();
    const sl = $("panelBody").querySelector(".slider input");
    if (sl && t.reshape && t.kind === "face") sl.disabled = !!(blocked && blocked.msg);
  } else if (reviewing()) {
    // A result is waiting: the credit was spent making it. Apply keeps it as one Undo step;
    // Discard drops it (the credit isn't returned). Nothing is charged by either.
    chip.textContent = `AI · ${credits(cost)} used`; chip.className = "chip";
    apply.textContent = "Apply"; apply.disabled = false;
    note = job.unblended ? "This device couldn't blend the result into your full-size photo, so the whole picture is at the size the AI returned. Discard to keep your photo as it was."
      : MASK_TOOLS.includes(t.id) ? "Only the marked area changed. It is blended into your full-size photo; the marked area itself is at the AI's size and may look softer up close."
      : "Tap Compare to see the original. Apply keeps it; Discard drops it, and the credit isn't returned.";
  } else if (!aiLive(t.id)) {
    chip.textContent = "Not available yet"; chip.className = "chip";
    apply.textContent = "Not available yet"; apply.disabled = true;
    note = `${t.label} needs an update to Glow's AI server that isn't live yet. Nothing is sent or charged.`;
  } else {
    const again = lastCommitTool === t.id;
    const a = account, trial = trialTool(t), have = a ? balanceFor(t) : 0, short = a && have < cost;
    if (short) {
      apply.textContent = trial ? "Go Pro or buy credits" : "Get more AI credits";
      note = trial
        ? (have ? `This uses ${credits(cost)} and you have ${have} premium ${have === 1 ? "credit" : "credits"} left.` : "You've used your 3 free premium credits. Your daily AI credits still work on the everyday AI tools.")
        : have
        ? `This uses ${credits(cost)} and you have ${have} left.`
        : `You're out of AI credits ${a.plan === "pro" ? "for now" : "for today"}. On-device tools are still free.`;
    } else {
      apply.textContent = `${again ? "Run again" : gen ? "Generate" : "Apply"} · ${credits(cost)}`;
      const bal = !a ? "" : trial ? (a.bonus ? ` Premium tool: ${a.trialLeft} free and ${a.bonus} extra credits left.` : ` Premium tool: ${have} of 3 free premium credits left.`) : ` You have ${have} left ${a.plan === "pro" ? "this week" : "today"}.`;
      note = again ? `Running it again makes a new version and uses another ${credits(cost).replace(/^1 /, "")}.${bal}` : `${note}${bal}`.trim();
    }
    if (jobActive()) { apply.disabled = true; note = `Wait for ${job.title} to finish, or check its status above. Glow runs one AI edit at a time so nothing is charged twice.`; }
    else if (resultReady()) { apply.disabled = true; note = `Apply or discard the ${job.title} result first (in the bar above).`; }
    if (t.id === "outfit" && !outfitData && !short) apply.disabled = true;
    if (t.id === "custom" && !customText.trim()) apply.disabled = true;
    if (t.id === "glowup" && !short) { apply.textContent = apply.textContent.replace(/^(Apply|Run again)/, "Glow Up"); if (glow.ai === "custom" && !glow.words.trim()) apply.disabled = true; }
    if (t.id === "colorize" && photoColorful) { apply.disabled = true; note = "Colorize is for black-and-white photos. This photo already has color."; }
    if (MASK_TOOLS.includes(t.id) && !strokes.some((x) => !x.erase) && !short) apply.disabled = true;
  }
  $("panelNote").textContent = note; fitDock();
}

// On-device steps are recorded as recipes (tool + settings), so the same step can be
// previewed at working size and redone at full size when the photo is saved.
let previewToken = 0;
function opFor(t) {
  const op = { tool: t.id };
  if (t.kind === "face" || t.kind === "body" || t.kind === "hair") { op.amt = (faceSet.amt[t.id] ?? 50) / 100; op.shades = { ...faceSet.shade }; op.styles = { ...faceSet.style }; }
  if (t.id === "fglam" && faceSet.style.fglam === "mine") op.mine = (faceSet.mine || []).map((x) => [...x]);
  if (t.kind === "face" && faceSel.boxes.length > 1) { const b = faceSel.boxes[faceSel.i]; op.face = [b.cx, b.cy]; }
  if (t.kind === "adjust") op.value = toolAmt[t.id];
  if (t.kind === "filter" && filterAmt < 100) op.amt = filterAmt / 100;
  if (t.kind === "look") op.look = { ...(editorLooks().find((l) => l.id === lookPick) || PRESET_LOOKS[1]) };
  if (t.id === "bgphoto") { op.bg = bgPhoto; op.bgBlur = bgBlur; }
  if (t.id === "bgcolor") op.bgColor = bgColorPick;
  if (t.id === "glowup") {
    op.glow = glowRecipe(); op.shades = { ...faceSet.shade }; op.styles = { ...faceSet.style };
    if (faceSel.boxes.length > 1) { const b = faceSel.boxes[faceSel.i]; op.face = [b.cx, b.cy]; }
  }
  return op;
}
async function computeOp(op, base) {
  const t = TOOL[op.tool];
  if (t.kind === "face" || t.kind === "body" || t.kind === "hair") {
    const keep = { ...faceSet.shade }, keepStyle = { ...faceSet.style }, keepMine = faceSet.mine;
    Object.assign(faceSet.shade, op.shades); Object.assign(faceSet.style, op.styles || STYLE_DEFAULTS); if (op.mine) faceSet.mine = op.mine;
    try {
      if (t.kind === "face") return await faceEdit(base, t.id, op.amt, op.face);
      if (t.kind === "body") return await bodyEdit(base, t.id, op.amt);
      return await hairColor(base, op.amt, op.shades.hcolor);
    } finally { Object.assign(faceSet.shade, keep); Object.assign(faceSet.style, keepStyle); faceSet.mine = keepMine; }
  }
  if (t.kind === "glowup") {
    const keep = { ...faceSet.shade }, keepStyle = { ...faceSet.style };
    Object.assign(faceSet.shade, op.shades || {}); Object.assign(faceSet.style, op.styles || STYLE_DEFAULTS);
    try { return await glowUp(base, op.glow, op.face); } finally { Object.assign(faceSet.shade, keep); Object.assign(faceSet.style, keepStyle); }
  }
  if (t.kind === "filter") return applyFilter(base, t.filter, op.amt ?? 1);
  if (t.kind === "adjust") return op.value ? adjust(base, t.id, op.value) : null;
  if (t.kind === "crop") {
    if (op.rect) return cropRect(base, op.turns, op.rect, op.aspect);
    return op.ratio || op.turns % 4 ? cropRotate(base, op.ratio, op.turns) : null; // steps saved before interactive crop
  }
  if (t.kind === "look") return applyLook(base, op.look);
  if (t.kind === "bg") {
    if (t.id === "bgremove") return cutout(base);
    if (t.id === "bgblur") return backdrop(base, "blur");
    if (t.id === "bgphoto") return op.bg ? backdrop(base, op.bg, { match: true, blur: op.bgBlur }) : null;
    if (t.id === "bgcolor") return backdrop(base, colorFill(op.bgColor));
    return backdrop(base, BG_FILLS[t.id]);
  }
  return null;
}
async function preview() {
  const t = sel && TOOL[sel]; if (!t || costOf(t) || t.kind === "crop") return;
  const token = ++previewToken, base = committed();
  if (t.kind === "face" || t.kind === "glowup") { await ensureFaces(); if (token !== previewToken || sel !== t.id) return; }
  const op = opFor(t);
  const slow = setTimeout(() => { if (token === previewToken) setBusy(true, t.kind === "face" || t.kind === "body" || t.kind === "hair" || t.kind === "bg" ? "Finding the details…" : "Working…"); }, 250);
  try {
    const out = await computeOp(op, base);
    if (token !== previewToken || sel !== t.id) return;
    ed.pending = out && out !== base ? { tool: t.id, data: out, op } : null;
    if (!t.reshape && reshapeNote && reshapeNote.tool === t.id) reshapeNote = null;
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
  if (ed.demo && t.kind === "ai") {
    if (!demo || !demo.ready.includes(t.id)) { pickAndOpen(); return; }
    if (demo.failed[t.id]) showDemoPreview(t.id); else { sel = null; renderEditor(); } return;
  }
  if (reviewing()) { await applyResult(); return; }
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
  if (account && balanceFor(t) < cost) {
    if (account.plan === "pro") openPacks("out"); else openPaywall();
    return;
  }
  if (jobActive()) { say(`${job.title} is still running. Check its status first.`, true); return; }
  if (resultReady()) { say(`Apply or discard the ${job.title} result first.`, true); return; }
  if (!aiLive(t.id)) return;
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
  let body, keep = {};
  try {
    const base = committed();
    if (MASK_TOOLS.includes(t.id)) {
      const up = await uploadable(base), dims = await loadImg(up), mask = eraseMask(dims.naturalWidth, dims.naturalHeight);
      const prompt = t.id === "fill" ? fillPrompt.trim().slice(0, 200) : "";
      body = { image: up, mode: t.id, mask, prompt: prompt || undefined };
      keep = { mask };   // to put every unmarked pixel back afterwards
    } else if (t.id === "glowup") {
      // Glow Up's AI step runs first; the free steps go on top when she applies the result.
      const up = await uploadable(base), mode = glow.ai;
      if (mode === "bgscene") { const mask = await sceneMask(up); body = { image: up, mode, mask, prompt: scenePrompt() }; keep = { mask }; }
      else body = { image: up, mode, prompt: mode === "custom" ? glow.words.trim().slice(0, 200) : undefined };
      keep.glow = opFor(t); keep.keepFace = mode !== "bgscene";
    } else if (t.id === "custom") {
      body = { image: await uploadable(base), mode: "custom", prompt: customText.trim().slice(0, 200) }; keep = { keepFace: true };
    } else if (t.id === "bgscene") {
      // Only the background (and the soft edge of her hair) is repainted; she stays her own pixels.
      const up = await uploadable(base), mask = await sceneMask(up);
      body = { image: up, mode: "bgscene", mask, prompt: scenePrompt() };
      keep = { mask };
    } else if (t.id === "expand") {
      const x = await expandInputs(base); body = { image: x.image, mode: "expand", mask: x.mask };
    } else body = { image: await uploadable(base), mode: t.id, extra: t.id === "outfit" ? outfitData : undefined };
  } catch (err) { setBusy(false); say(err.message, true); return; }
  job = { requestId: rid(), id: null, tool: t.id, title: t.title, session: ed.session, baseIdx: ed.idx, status: "starting", startedAt: Date.now(), before, ...keep };
  saveJob();
  let res;
  try {
    track("ai_start", { mode: t.id });
    res = await call("enhance", { method: "POST", body: JSON.stringify({ ...body, request_id: job.requestId }) });
  } catch (err) {
    setBusy(false);
    track("ai_fail", { mode: t.id, status: err.status || 0, limit: !!err.limit });
    if (err.status) {
      // The server answered, so the edit didn't start. It returns the credit itself if it had taken one.
      job = null; saveJob();
      // A premium tool on the free plan draws on the one-time trial, which never resets, so say that
      // rather than the server's "come back tomorrow".
      if (err.limit && trialTool(t)) err.message = "You've used your free premium credits. Go Pro or buy a credit pack to keep using premium AI tools, or use the everyday AI tools with your daily credits.";
      if (err.limit) { say(err.message, true); if (!err.blocked && (!account || account.plan !== "pro")) openPaywall(); renderPanel(); return; }
      await refreshAccount();
      const extra = before != null && account ? (account.remaining >= before ? " No AI credit was used." : ` Your balance shows ${account.remaining} left.`) : "";
      say(err.message + extra, true);
      return;
    }
    // No answer: the edit may or may not have started. Don't send it again.
    job.status = "unknown"; job.error = "The connection dropped before Glow heard back."; saveJob();
    return;
  }
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
  track(res.status === "succeeded" && res.output ? "ai_done" : "ai_fail", { mode: mine.tool, secs: Math.round((Date.now() - (mine.startedAt || Date.now())) / 1000), refunded: res.refunded === true });
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
  // Remove / Fill: only the marked area comes from the AI. It is blended into the FULL-SIZE photo
  // (every earlier step redone at full size), so every unmarked pixel is the photo's own, at its
  // own resolution. Only the marked area is limited to the size the AI worked at.
  const mineHere = mine.session === ed.session && hasPhoto() && ed.hist.length > mine.baseIdx;
  if (mineHere && mine.mask) {
    try { const fb = await renderExport(mine.baseIdx); full = await protectComposite(fb.data, full, mine.mask); } catch { mine.unblended = true; }
  }
  // Her face stays hers: if the AI moved or redrew it, her own face goes back in.
  if (mineHere && mine.keepFace) {
    try { const fb = await renderExport(mine.baseIdx), r = await restoreFace(fb.data, full); full = r.data; mine.faceKept = r.moved; } catch {}
  }
  // HD cutout: the AI's edge, applied to the full-size photo.
  if (mineHere && mine.tool === "bgcut") {
    try { const fb = await renderExport(mine.baseIdx); full = await applyCutout(fb.data, full); } catch { mine.unblended = true; }
  }
  const data = await shrinkData(full, 2048);
  if (mineHere) {
    // Every AI result waits for Apply. It is kept with the job, so it survives leaving the tool,
    // the editor, or a reload, and nothing is charged again to look at it.
    mine.status = "done"; mine.result = { data, full }; saveJob();
    renderEditor(); Platform.haptic();
    say(sel === mine.tool ? `${mine.title} is ready. Apply to keep it.` : `${mine.title} is ready to review.`);
  } else {
    recovered = { title: mine.title, data, full }; job = null; saveJob();
    Drafts.putRecovered(recovered).catch(() => {}); if (screen === "editorHome") renderHome();
    say(`${mine.title} is ready. Find it on the Editor screen.`);
  }
}
const blobToData = (b) => new Promise((ok, fail) => { const fr = new FileReader(); fr.onload = () => ok(fr.result); fr.onerror = fail; fr.readAsDataURL(b); });

function renderJob() {
  const bar = $("jobBar");
  const show = !!job && job.session === ed.session && screen === "editorScreen" && !reviewing();
  bar.hidden = !show;
  if (!show) return;
  const working = job.status === "starting" || (job.status === "processing" && following);
  $("jobSpin").hidden = !working;
  let text = `${job.title} ${JOB_TEXT[job.status] || ""}`;
  if (job.status === "processing" && !following) text = `${job.title} may still be processing.`;
  if (job.status === "unknown") text += ` ${job.error || ""} Glow won't charge you again to check.`;
  if (job.status === "failed") text += ` ${job.error}` + (job.refunded ? " Glow's server returned the AI credit." : account ? ` Your balance shows ${balanceText(account)}.` : "");
  if (job.status === "done" && ed.idx !== job.baseIdx) text += " It was made from an earlier version of this photo.";
  $("jobText").textContent = text;
  const btn = (label, fn, kind) => { const b = document.createElement("button"); b.className = "btn small " + (kind || "quiet"); b.textContent = label; b.addEventListener("click", fn); return b; };
  const acts = [];
  if (job.status === "unknown" || (job.status === "processing" && !following)) acts.push(btn("Check status", () => checkJob()));
  if (job.status === "done") acts.push(btn("Review", () => selectTool(job.tool)), btn("Apply", applyResult, ""));
  if (job.status === "done") acts.push(btn("Discard", discardResult, "ghost"));
  if (job.status === "failed" || job.status === "unknown") acts.push(btn("Dismiss", () => { job = null; saveJob(); }, "ghost"));
  $("jobActions").replaceChildren(...acts);
}
document.addEventListener("visibilitychange", () => { if (!document.hidden && job && job.status === "processing" && !following) checkJob(); });
window.addEventListener("online", () => { if (jobActive() && !following) checkJob(); });

// Magic-erase brush: strokes are kept in the committed photo's pixel coordinates.
// imageRect follows the inspection zoom, so strokes land where the finger is at any zoom.
function imageRect() {
  const img = $("before"), F = fitRect(), v = viewRect(F);
  return { x: v.x, y: v.y, s: v.w / img.naturalWidth, nw: img.naturalWidth, nh: img.naturalHeight };
}
function drawStrokes() {
  const cv = $("brush"), st = $("stage").getBoundingClientRect(), dpr = devicePixelRatio || 1;
  cv.width = st.width * dpr; cv.height = st.height * dpr;
  if (!hasPhoto() || !$("before").naturalWidth) return;
  const ctx = cv.getContext("2d"), r = imageRect();
  ctx.scale(dpr, dpr);
  // Marks are drawn solid on their own layer and shown at one opacity, so overlaps don't darken.
  ctx.strokeStyle = "rgb(214 70 128)"; ctx.lineCap = ctx.lineJoin = "round";
  for (const s of strokes) {
    ctx.globalCompositeOperation = s.erase ? "destination-out" : "source-over";
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
// One finger draws. A second finger drops the stroke it interrupted and both fingers move
// the view instead (pinch and pan), until they are lifted.
let painter = null;
$("brush").addEventListener("pointerdown", (e) => {
  e.stopPropagation(); $("brush").setPointerCapture(e.pointerId);
  if (navPtrs.size) { navDown(e); return; }
  if (painting) {
    painting = false; strokes.pop(); drawStrokes();
    navPtrs.set(painter.id, painter.p); painter = null; navDown(e); return;
  }
  if (e.pointerType === "mouse" && e.button !== 0) return;
  painting = true; painter = { id: e.pointerId, p: stagePt(e) };
  strokes.push({ w: brushSize / imageRect().s, pts: [brushPoint(e)], erase: brushMode === "erase" || undefined }); drawStrokes();
});
$("brush").addEventListener("pointermove", (e) => {
  if (navPtrs.has(e.pointerId)) { navPtrs.set(e.pointerId, stagePt(e)); navMove(); return; }
  if (!painting || painter.id !== e.pointerId) return;
  painter.p = stagePt(e); strokes[strokes.length - 1].pts.push(brushPoint(e)); drawStrokes();
});
["pointerup", "pointercancel"].forEach((ev) => $("brush").addEventListener(ev, (e) => {
  if (navPtrs.has(e.pointerId)) { navUp(e); return; }
  if (painting && painter.id === e.pointerId) { painting = false; painter = null; renderPanel(); }
}));
$("brush").addEventListener("wheel", (e) => { e.preventDefault(); const p = stagePt(e); zoomTo(insp.z * Math.exp(-e.deltaY * 0.0025), p.x, p.y); }, { passive: false });
// The mask is drawn at the size of the image that is uploaded.
function eraseMask(w, h) {
  const r = imageRect(), k = w / r.nw, c = newCanvas(w, h), ctx = c.getContext("2d");
  ctx.fillStyle = "#000"; ctx.fillRect(0, 0, w, h);
  ctx.lineCap = ctx.lineJoin = "round";
  for (const s of strokes) {
    ctx.strokeStyle = s.erase ? "#000" : "#fff";
    ctx.lineWidth = s.w * (s.erase ? 1 : 1.15) * k; ctx.beginPath();
    s.pts.forEach(([x, y], i) => (i ? ctx.lineTo : ctx.moveTo).call(ctx, x * k, y * k));
    if (s.pts.length === 1) ctx.lineTo(s.pts[0][0] * k + 0.1, s.pts[0][1] * k);
    ctx.stroke();
  }
  return c.toDataURL("image/png");
}
window.addEventListener("resize", () => { if (maskOn()) drawStrokes(); });

// Puts every unmarked pixel of the photo back over an AI result: the result is used only where
// the (slightly feathered) mask is white. Works at the size of the photo being edited.
async function protectComposite(baseSrc, resultSrc, maskSrc) {
  const [base, res, m] = await Promise.all([loadImg(baseSrc), loadImg(resultSrc), loadImg(maskSrc)]);
  const w = base.naturalWidth, h = base.naturalHeight, out = newCanvas(w, h), ctx = out.getContext("2d");
  ctx.drawImage(base, 0, 0);
  const mc = newCanvas(w, h), mx = mc.getContext("2d", { willReadFrequently: true });
  // The blend band: a feather of 0.2% of the long side (2 px or more) at the mask's edge.
  mx.filter = `blur(${Math.max(2, Math.round(Math.max(w, h) / 500))}px)`; mx.drawImage(m, 0, 0, w, h); mx.filter = "none";
  const d = mx.getImageData(0, 0, w, h);
  for (let i = 0; i < d.data.length; i += 4) { d.data[i + 3] = d.data[i]; d.data[i] = d.data[i + 1] = d.data[i + 2] = 255; }
  mx.putImageData(d, 0, 0);
  const layer = newCanvas(w, h), lx = layer.getContext("2d");
  lx.drawImage(res, 0, 0, w, h); lx.globalCompositeOperation = "destination-in"; lx.drawImage(mc, 0, 0);
  ctx.drawImage(layer, 0, 0);
  return /^data:image\/png/.test(baseSrc) ? out.toDataURL("image/png") : out.toDataURL("image/jpeg", 0.95);
}

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
// Redoes every step at full size, up to the current version (or step `upto`).
async function renderExport(upto = ed.idx) {
  const steps = ed.hist.slice(0, upto + 1);
  let k = 0;
  for (let i = steps.length - 1; i >= 1; i--) if (steps[i].op && steps[i].op.fixed) { k = i; break; }
  // A Revert step starts again from the original itself.
  const from = k && !steps[k].op.revert ? steps[k].full || steps[k].data : (ed.original && ed.original.blob) || steps[0].data;
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
  return { data, w: img.naturalWidth, h: img.naturalHeight, capped: base.capped, ai: k && TOOL[steps[k].op.tool] && steps[k].op.tool !== "camlook" ? TOOL[steps[k].op.tool] : null };
}
function exportNote(r) {
  if (r.preview) return ` Saved at ${r.w} × ${r.h}, the preview size, because the full-size version couldn't be made on this device.`;
  if (r.ai && ed.demo) return ` Saved at ${r.w} × ${r.h}, the prepared preview's size.`;
  if (r.ai) return ` Saved at ${r.w} × ${r.h}, the size ${r.ai.title} returned.`;
  if (r.capped) return ` Saved at ${r.w} × ${r.h}, Glow's 16-megapixel limit.`;
  return ` Saved at ${r.w} × ${r.h}.`;
}
async function saveEdit(opts) {
  const share = !!(opts && opts.share === true);   // the Share button: the share sheet wherever the browser has one
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
  // Free plan: the small Glow badge goes on the finished picture.
  const marked = await markForSave(out.data, isPng(out.data));
  if (!marked) { savingEdit = false; return false; }
  if (marked.marked) out = { ...out, data: marked.data, marked: true };
  const stamp = Date.now(), items = [{ data: out.data, name: ed.demo ? `glow-ai-sample-${demoSaveTag()}${stamp}` : `glow-${stamp}` }];
  const withOrig = !ed.demo && store.get("glowSaveOrig") === "on" && !ed.originalSaved && ed.original && ed.original.blob;
  if (withOrig) items.unshift({ blob: ed.original.blob, name: `glow-${stamp}-original` });
  try {
    const where = await Platform.savePhotos(items, { share });
    track(share ? "share" : "save", { from: "editor", edits: ed.idx, demo: !!ed.demo, marked: !!out.marked, where: String(where || "") });
    ed.savedIdx = ed.idx; if (withOrig) ed.originalSaved = true;
    ed.lastExport = { w: out.w, h: out.h, original: ed.original ? [ed.original.w, ed.original.h] : null };
    saveDraft(); renderEditor();
    // One quiet offer per session to make a Share Glow card; nothing happens unless it's tapped.
    const offer = CONFIG.publicUrl && !shareOffered ? { label: "Share Glow", run: () => openShareCard(out.data) } : null;
    if (offer) shareOffered = true;
    say(savedText(where, items.length, exportNote(out)), false, offer);
    return true;
  } catch (err) {
    if (err && err.name === "AbortError") return false;
    say(saveFailText(), true);
    return false;
  } finally { savingEdit = false; }
}
$("saveBtn").addEventListener("click", saveEdit);

// ---------- Glow badge on free saves ----------
// Saves on the free plan get a small Glow badge in the bottom-right corner: the app icon and
// "Glow" with the address under it, on a dark glass pill, like other camera apps sign their
// photos. It is drawn on the final full-size picture (after crop, rotation and every edit), never
// on the screen view. Glow Pro saves stay clean. The badge is part of saving only: no credit,
// request or allowance. Pro is remembered (until it expires) for when the server can't be reached
// yet, such as right after opening the app offline, so a Pro save never gets the badge.
const isPro = () => (account && account.plan ? account.plan === "pro" : new Date(store.get("glowPro") || 0) > new Date());
let shareOffered = false;
const BADGE_LINE = CONFIG.badgeLine === "none" ? "" : CONFIG.badgeLine || PUBLIC_HOST;
async function markFonts() {
  try { await Promise.all([document.fonts.load('500 40px Fraunces'), document.fonts.load("600 20px Figtree")]); } catch {}
}
const MARK_SERIF = (px) => `500 ${px}px Fraunces, Georgia, serif`, MARK_SANS = (px) => `600 ${px}px Figtree, system-ui, sans-serif`;
let badgeIcon = null;
const loadBadgeIcon = () => badgeIcon || (badgeIcon = loadImg("icon-512.png").catch(() => { badgeIcon = null; return null; }));
// Sized from the picture's shorter side: the pill is 5% of it tall (at least 26px), inset by
// half its height. The address line is left out when it would be too small to read or make the
// badge wider than 45% of the picture.
function markLayout(ctx, w, h) {
  const H = Math.max(26, Math.round(Math.min(w, h) * 0.05)), pad = Math.round(H * 0.16), icon = H - pad * 2, inset = Math.round(H * 0.5);
  const s = Math.round(H * 0.4), u = Math.round(H * 0.22);
  ctx.font = MARK_SERIF(s); const gw = ctx.measureText("Glow").width;
  let line = BADGE_LINE; ctx.font = MARK_SANS(u); let lw = line ? ctx.measureText(line).width : 0;
  const width = (tw) => Math.round(pad + icon + H * 0.22 + tw + H * 0.4);
  if (u < 9 || width(Math.max(gw, lw)) > w * 0.45) { line = ""; lw = 0; }
  const bw = width(Math.max(gw, lw));
  return { H, pad, icon, s, u, gw, line, bw, x: w - inset - bw, y: h - inset - H };
}
function pill(ctx, x, y, w, h) { const r = h / 2; ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
function drawBadge(ctx, m, icon) {
  const { x, y, H, pad } = m;
  ctx.save();
  // The pill: ink glass with a soft shadow and a hairline edge, so the white lettering reads on
  // white walls and skies as well as on dark or busy backgrounds.
  ctx.shadowColor = "rgba(0, 0, 0, 0.22)"; ctx.shadowBlur = H * 0.3; ctx.shadowOffsetY = H * 0.04;
  pill(ctx, x, y, m.bw, H); ctx.fillStyle = "rgba(29, 24, 27, 0.56)"; ctx.fill();
  ctx.shadowColor = "transparent"; ctx.lineWidth = Math.max(1, H * 0.025); ctx.strokeStyle = "rgba(255, 255, 255, 0.22)"; ctx.stroke();
  // The app icon, rounded like on a home screen.
  const ix = x + pad, iy = y + pad;
  if (icon) {
    ctx.save(); pill(ctx, ix, iy, m.icon, m.icon); ctx.clip();
    ctx.drawImage(icon, ix, iy, m.icon, m.icon); ctx.restore();
  }
  const tx = ix + m.icon + H * 0.22;
  ctx.fillStyle = "#ffffff"; ctx.textBaseline = "alphabetic";
  if (m.line) {
    ctx.font = MARK_SERIF(m.s); ctx.fillText("Glow", tx, y + H * 0.52);
    ctx.font = MARK_SANS(m.u); ctx.fillStyle = "rgba(255, 255, 255, 0.8)"; ctx.fillText(m.line, tx, y + H * 0.81);
  } else {
    ctx.font = MARK_SERIF(Math.round(H * 0.48)); ctx.fillText("Glow", tx, y + H * 0.66);
  }
  ctx.restore();
}
async function addMark(data, png) {
  await markFonts();
  const [img, icon] = await Promise.all([loadImg(data), loadBadgeIcon()]);
  const w = img.naturalWidth, h = img.naturalHeight, c = newCanvas(w, h), ctx = c.getContext("2d");
  ctx.drawImage(img, 0, 0);
  const m = markLayout(ctx, w, h);
  drawBadge(ctx, m, icon);
  // The disclosure preview: the corner of this exact picture, around the badge.
  const pw = Math.min(w, Math.round(m.bw * 1.5 + m.H)), ph = Math.min(h, Math.round(Math.max(m.H * 3, pw * 0.4)));
  const pc = canvasFor({ naturalWidth: pw, naturalHeight: ph }, 640), sc = pc.width / pw;
  pc.getContext("2d").drawImage(c, w - pw, h - ph, pw, ph, 0, 0, pw * sc, ph * sc);
  return { data: png ? c.toDataURL("image/png") : c.toDataURL("image/jpeg", 0.95), preview: pc.toDataURL("image/jpeg", 0.9),
    box: { x: m.x, y: m.y, w: m.bw, h: m.H }, line: m.line };
}
// The badged picture for a free save. The first time, the person sees exactly where the badge
// sits before anything is saved; null when they cancel. Pro saves come back unchanged.
async function markForSave(data, png) {
  if (isPro()) return { data, marked: false };
  let m; try { m = await addMark(data, png); } catch { m = null; }
  if (!m) return { data, marked: false };
  if (!store.get("glowBadgeSeen")) {
    const c = await ask({ title: "Free saves include a small Glow badge", text: "It sits in the bottom-right corner, like this, so friends can see where your photo was made. Glow Pro saves don't have it.",
      image: m.preview, caption: "The corner of your saved photo", actions: [{ label: "Save", value: "yes" }, { label: "Cancel", value: "", kind: "ghost" }] });
    if (!c) return null;
    store.set("glowBadgeSeen", "1");
  }
  return { data: m.data, marked: true };
}

// ---------- Share Glow card (only when chosen) ----------
// The saved photo with a footer under it: a QR code for Glow's public address and "Try Glow".
// Nothing is shared or sent until the person picks Share or Save on the preview.
function loadScript(src) {
  return new Promise((ok, bad) => { const s = document.createElement("script"); s.src = src; s.onload = ok; s.onerror = bad; document.head.append(s); });
}
async function makeShareCard(photo) {
  if (!window.qrcode) await loadScript("vendor/qrcode.js");
  await markFonts();
  const img = await loadImg(photo), W = 1080, F = 280, k = Math.min(W / img.naturalWidth, 1350 / img.naturalHeight);
  const pw = Math.round(img.naturalWidth * k), ph = Math.round(img.naturalHeight * k), c = newCanvas(W, ph + F), ctx = c.getContext("2d");
  ctx.fillStyle = "#f6f0ea"; ctx.fillRect(0, 0, W, ph + F);
  ctx.drawImage(img, Math.round((W - pw) / 2), 0, pw, ph);
  const q = window.qrcode(0, "M"); q.addData(CONFIG.publicUrl); q.make();
  const n = q.getModuleCount(), cell = Math.floor(200 / (n + 8)), qs = cell * (n + 8), qx = 48, qy = ph + Math.round((F - qs) / 2);
  ctx.fillStyle = "#ffffff"; ctx.fillRect(qx, qy, qs, qs); ctx.fillStyle = "#1d1418";
  for (let r = 0; r < n; r++) for (let col = 0; col < n; col++) if (q.isDark(r, col)) ctx.fillRect(qx + (col + 4) * cell, qy + (r + 4) * cell, cell, cell);
  const tx = qx + qs + 40;
  ctx.fillStyle = "#813b59"; ctx.font = MARK_SERIF(76); ctx.fillText("Try Glow", tx, ph + F / 2 + 4);
  ctx.fillStyle = "#72646f"; ctx.font = MARK_SANS(30); ctx.fillText(PUBLIC_HOST, tx, ph + F / 2 + 52);
  return c.toDataURL("image/jpeg", 0.92);
}
async function openShareCard(photo) {
  track("share_card", {});
  let card;
  try { card = await makeShareCard(photo); } catch { say("Couldn't make the share card. Try again.", true); return; }
  const c = await ask({ title: "Share Glow", text: "Your photo with a QR code to Glow underneath. Nothing is sent until you choose.", image: card, caption: "Share card preview",
    actions: [{ label: "Share card", value: "share" }, { label: "Save card", value: "save", kind: "ghost" }, { label: "Close", value: "", kind: "ghost" }] });
  if (!c) return;
  try { const where = await Platform.savePhotos([{ data: card, name: `glow-share-card-${Date.now()}` }], { download: c === "save" }); say(savedText(where, 1)); }
  catch (err) { if (!(err && err.name === "AbortError")) say(saveFailText(), true); }
}
// Back keeps the session; it's waiting on the Editor landing under "Continue editing".
$("backBtn").addEventListener("click", () => { setExpanded(false); discardPending(); sel = null; go("editor"); });

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
  chip.innerHTML = `<span>${icon("sparkle")}${n}</span>`;
  chip.setAttribute("aria-label", `${balanceText(a)}. Details`);
  $("homeCredits").innerHTML = icon("sparkle") + `<span>${balanceText(a)}</span>`;
}
function renderCreditsSheet() {
  // A balance card on top, then a few short facts. The rules are unchanged; only the layout is.
  const a = account;
  const fact = (ic, t, d) => `<li>${icon(ic)}<div><b>${t}</b>${d ? `<span>${d}</span>` : ""}</div></li>`;
  const card = (n, of, sub, note) => `<div class="cr-card"><div class="cr-num"><b>${n}</b><span>${of}</span></div>` +
    `<div class="cr-bar"><i style="width:${of ? Math.round(100 * Math.min(1, n / (+of.match(/\d+/)[0] || 1))) : 0}%"></i></div><p>${sub}</p>${note ? `<p class="cr-note">${note}</p>` : ""}</div>`;
  let html = "", facts = [];
  if (!a) html = `<div class="cr-card"><p>Your balance will show once Glow can reach its server.</p></div>`;
  else if (a.plan === "pro") {
    html = card(a.remaining, `of ${a.quota} AI credits left`, "Glow Pro includes 40 AI credits each week. Each credit comes back 7 days after you use it.",
      "Unused credits don't carry over. The yearly plan also has a limit of 80 credits in any 30 days.");
  } else {
    const r = nextUtcMidnight(), mins = Math.max(1, Math.round((r - Date.now()) / 60000));
    const left = mins >= 60 ? `${Math.floor(mins / 60)} h ${mins % 60} min` : `${mins} min`;
    html = card(a.remaining, `of ${a.quota} AI credits left today`, `Resets at ${fmtTime(r)} (in ${left}). Unused credits don't carry over.`,
      a.trialLeft !== undefined ? "Daily credits work with Enhance, AI retouch, Remove and Colorize." : "");
    if (a.trialLeft !== undefined) facts.push(fact("sparkle", `${a.trialLeft} free premium ${a.trialLeft === 1 ? "try" : "tries"} left`,
      "Pro edit, Golden hour, outfits, Describe, Fill, AI scene and portrait styles share 3 free premium credits, once, not each day. Fill, AI scene, Describe and the portrait styles use 2."));
    if (native && plugins.AdMob && a.adsLeft > 0) facts.push(fact("star", "Out of credits?",
      `Watch a short ad for 1 more credit${a.trialLeft !== undefined ? " for the daily tools" : ""}, up to ${a.adsLeft} more today. Ads are always optional.`));
  }
  if (a && a.bonus > 0) facts.unshift(fact("star", `${a.bonus} extra AI ${a.bonus === 1 ? "credit" : "credits"}, included above`,
    `They never expire and are used after your ${a.plan === "pro" ? "weekly" : "free"} credits${a.plan === "pro" ? "" : ", on every AI tool"}.`));
  facts.push(fact("save", "Saving is free and unlimited", "On the free plan, saves carry a small Glow mark."),
    fact("sliders", "On-device tools are always free", "Camera, filters, face, makeup, backgrounds, light and color. Undo and redo never use credits."),
    fact("wand", `Most AI tools use 1 credit`, `Headshot, Fashion, Describe${CONFIG.pricingV2 ? ", Fill and AI scene" : " and AI scene"} use 2. Each tool shows its cost before you apply it.`),
    fact("revert", "Failed edits are refunded", "If the AI service reports an edit failed, its credit comes back automatically."));
  $("creditsBody").innerHTML = html + `<ul class="cr-facts">${facts.join("")}</ul>`;
  $("creditsPro").hidden = !!(a && a.plan === "pro");
}
function openCredits() { refreshAccount(); renderCreditsSheet(); $("creditsSheet").showModal(); }
$("balanceBtn").addEventListener("click", openCredits);
$("homeCredits").addEventListener("click", openCredits);
$("creditsPro").addEventListener("click", () => { $("creditsSheet").close(); openPaywall(); });
$("creditsPacks").addEventListener("click", () => { $("creditsSheet").close(); openPacks(); });

function showUsage(u) {
  // A premium tool on the free plan draws on the one-time trial, not today's balance. The server's
  // trial balance includes extra credits; the exact split comes from the account a moment later.
  if (u && u.pool === "trial") {
    const extra = (account && account.bonus) || 0;
    u = { plan: u.plan, trialLeft: Math.max(0, u.remaining - extra) };
    if (extra) setTimeout(refreshAccount, 0);
  }
  else if (u && u.pool) { const { pool, ...rest } = u; u = rest; }
  account = { ...(account || {}), ...u };
  if (u && u.plan === "pro" && u.expires) store.set("glowPro", u.expires);
  else if (u && u.plan === "free") store.set("glowPro", "");
  $("planLine").textContent = account.plan === "pro"
    ? `Glow Pro: ${account.remaining} of ${account.quota} AI credits left this week.`
    : `Free plan: ${account.remaining} of ${account.quota} AI credits left today. On-device tools are always free.`;
  $("goProBtn").hidden = account.plan === "pro";
  renderCredits();
  if (screen === "editorScreen") { renderPanel(); }
  if (screen === "enhanceHome" && typeof renderEnhanceHome === "function") renderEnhanceHome();
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
  followAccount();
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
    const e = new Error(body.error || "Something went wrong."); e.status = res.status; e.limit = body.limit; e.blocked = !!body.blocked; throw e;
  }
  return body;
}

// ---------- Diagnostics ----------
// A few anonymous events (app opened, paywall seen, purchase, which AI tool ran) and app errors go to
// Glow's own database (migration 009) so the owner can see what works and what breaks. Never
// photos, prompts or personal details. Sent in small batches, and only once the app has its account.
const PLATFORM = native ? (window.Capacitor.getPlatform && window.Capacitor.getPlatform()) || "app" : "web";
// var, not const: say() and go() can run before this line, and track() must then just skip.
var telemetry = { queue: [], timer: 0, errors: new Set(), off: false };
function track(name, props) {
  if (typeof telemetry === "undefined" || telemetry.off) return;
  telemetry.queue.push({ name, props: props || {}, platform: PLATFORM });
  if (telemetry.queue.length > 50) telemetry.queue.splice(0, telemetry.queue.length - 50);
  clearTimeout(telemetry.timer);
  telemetry.timer = setTimeout(flushTelemetry, 4000);
}
async function postRows(table, rows) {
  if (!session || !rows.length) return false;
  // A token near expiry is refreshed first, so events from long sessions aren't lost.
  if (session.expires_at * 1000 < Date.now() + 60000) { try { await ensureSession(); } catch { return false; } }
  const res = await fetch(`${CONFIG.supabaseUrl}/rest/v1/${table}`, {
    method: "POST", keepalive: true,
    headers: { "Content-Type": "application/json", apikey: CONFIG.supabaseKey, Authorization: `Bearer ${session.access_token}`, Prefer: "return=minimal" },
    body: JSON.stringify(rows),
  });
  // Before migration 009 the tables don't exist: stop trying for this launch.
  if (res.status === 404) telemetry.off = true;
  return res.ok;
}
async function flushTelemetry() {
  if (!session) { clearTimeout(telemetry.timer); telemetry.timer = setTimeout(flushTelemetry, 15000); return; }
  const rows = telemetry.queue.splice(0);
  try { await postRows("app_events", rows); } catch {}
}
let buildFp = "";
function reportError(message, detail) {
  message = String(message || "Unknown error").slice(0, 500);
  // Each distinct error once per launch, and at most 5 in all.
  if (telemetry.off || telemetry.errors.has(message) || telemetry.errors.size >= 5) return;
  telemetry.errors.add(message);
  postRows("app_errors", [{ message, detail: detail ? String(detail).slice(0, 2000) : null, build: buildFp || FEATURES_SHORT, platform: PLATFORM }]).catch(() => {});
}
const FEATURES_SHORT = "web-" + location.host.split(".")[0].slice(0, 30);
window.addEventListener("error", (e) => {
  // Errors from other sites' scripts (fonts, ads) arrive without details; they aren't Glow's.
  if (!e.message || e.message === "Script error.") return;
  reportError(e.message, (e.error && e.error.stack) || `${e.filename}:${e.lineno}:${e.colno}`);
});
window.addEventListener("unhandledrejection", (e) => {
  const r = e.reason;
  if (r && (r.status || r.offline || r.lost || r.userCancelled || r.name === "AbortError")) return;   // expected, already shown to the person
  reportError((r && r.message) || String(r), r && r.stack);
});
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flushTelemetry(); });

// ---------- Camera ----------
// Looks: one-tap beauty settings, remembered between sessions.
// Face reshape and makeup (livebeauty.js) only touch the face the camera is following.
const PRESET_LOOKS = [
  { id: "original", name: "Original", smooth: 0, bright: 0, warm: 0, filter: "none" },
  { id: "natural", name: "Natural", smooth: 25, bright: 15, warm: 10, filter: "none", lips: 20, blush: 15, brows: 15 },
  { id: "softglam", name: "Soft Glam", smooth: 55, bright: 30, warm: 25, filter: "glow", eyes: 20, slim: 20, nose: 10,
    lips: 40, blush: 35, brows: 30, lipShade: "#b5485d", blushShade: "#e86a8a" },
  { id: "glam", name: "Glam", smooth: 75, bright: 40, warm: 35, filter: "warm", eyes: 30, slim: 30, nose: 20,
    lips: 60, blush: 40, brows: 45, lipShade: "#c0392b", blushShade: "#ff7f98", browShade: "#3b2a20" },
].map((l) => ({ ...LIVE_DEFAULTS, ...l }));
const LOOK_KEYS = ["smooth", "bright", "warm", "filter", ...Object.keys(LIVE_DEFAULTS)];
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
// Looks saved before the face settings existed have none of them, so those start at zero.
function useLook(l) { track("look", { id: String(l.id).startsWith("my") ? "my_look" : l.id }); lookId = l.id; Object.assign(beauty, LIVE_DEFAULTS, Object.fromEntries(LOOK_KEYS.filter((k) => k in l).map((k) => [k, l[k]]))); saveBeauty(); renderLooks(); }

const cam = { stream: null, facing: store.get("glowFacing") || "user", gl: null, raf: 0, state: "", torch: false, shot: null, thumb: "", gen: 0, opened: 0 };
const isOriginalLook = () => !beauty.smooth && !beauty.bright && !beauty.warm && beauty.filter === "none" && LIVE_KEYS.every((k) => !beauty[k]);
const SLIDERS = [["sSmooth", "smooth"], ["sBright", "bright"], ["sWarm", "warm"], ["sEyes", "eyes"], ["sSlim", "slim"], ["sNose", "nose"]];
// Makeup shows one part at a time (one slider and its shades), so the preview stays large.
const MAKEUP_PARTS = { lips: ["Lips", "lipShade"], blush: ["Blush", "blushShade"], brows: ["Brows", "browShade"] };
let makeupPart = "lips";
function renderLooks() {
  const live = !!cam.gl;
  $("camLooks").hidden = !live;
  SLIDERS.forEach(([id, k]) => { const v = beauty[k] || 0; $(id).value = v; $(id).nextElementSibling.textContent = v; $(id).setAttribute("aria-valuetext", `${v} percent`); });
  const [partName, sk] = MAKEUP_PARTS[makeupPart], mv = beauty[makeupPart] || 0;
  document.querySelectorAll("#makeupParts [role=radio]").forEach((r) => { const on = r.dataset.part === makeupPart; r.setAttribute("aria-checked", String(on)); r.tabIndex = on ? 0 : -1; });
  $("sMakeupName").textContent = partName; $("swMakeup").setAttribute("aria-label", `${partName} shade`);
  $("sMakeup").value = mv; $("sMakeup").nextElementSibling.textContent = mv; $("sMakeup").setAttribute("aria-valuetext", `${mv} percent`);
  $("swMakeup").replaceChildren(...LIVE_SHADES[makeupPart].map((hex, i) => {
    const b = document.createElement("button"); b.className = "cam-swatch"; b.style.background = hex;
    b.setAttribute("aria-label", `Shade ${i + 1}`); b.setAttribute("aria-pressed", String(beauty[sk] === hex));
    b.addEventListener("click", () => {
      beauty[sk] = hex; if (!beauty[makeupPart]) beauty[makeupPart] = 40;
      lookId = "custom"; saveBeauty(); renderLooks();
    });
    return b;
  }));
  renderAdjNote();
  const flt = FILTERS.find((f) => f.id === beauty.filter) || FILTERS[0];
  $("camCanvas").style.filter = flt.f === "none" ? "" : flt.f;
  const chip = (text, on, cls, fn) => {
    const b = document.createElement("button"); b.className = "look" + (cls ? " " + cls : ""); b.textContent = text;
    if (on != null) b.setAttribute("aria-pressed", String(on));
    b.addEventListener("click", fn); return b;
  };
  const adjustBtn = chip("Adjust", null, "adjust", () => {
    const open = $("adjustPanel").hidden; $("adjustPanel").hidden = !open; adjustBtn.setAttribute("aria-expanded", String(open));
    $("cameraScreen").classList.toggle("adjusting", open); cam.focusY = null; cam.posY = null; $("camCanvas").style.objectPosition = "";
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
      const l = { id: "my" + Date.now(), name: n, ...Object.fromEntries(LOOK_KEYS.map((k) => [k, beauty[k]])) };
      myLooks = [...myLooks, l].slice(-4); useLook(l); say(`Saved as "${n}". It's also in Editor under My Look.`);
    })] : []),
    adjustBtn,
  );
  $("camFilters").replaceChildren(...FILTERS.map((f) => chip(f.name, f.id === beauty.filter, "", () => {
    beauty.filter = f.id; lookId = "custom"; saveBeauty(); renderLooks();
  })));
}
document.querySelectorAll("#makeupParts [role=radio]").forEach((r, i, all) => {
  r.addEventListener("click", () => { makeupPart = r.dataset.part; renderLooks(); });
  r.addEventListener("keydown", (e) => {
    const d = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0; if (!d) return;
    e.preventDefault(); makeupPart = all[(i + d + all.length) % all.length].dataset.part; renderLooks();
    document.querySelector(`#makeupParts [data-part="${makeupPart}"]`).focus();
  });
});
$("sMakeup").addEventListener("input", (e) => {
  beauty[makeupPart] = +e.target.value; e.target.nextElementSibling.textContent = e.target.value; e.target.setAttribute("aria-valuetext", `${e.target.value} percent`);
  if (lookId !== "custom") { lookId = "custom"; renderLooks(); }
  saveBeauty();
});
SLIDERS.forEach(([id, k]) => $(id).addEventListener("input", (e) => {
  beauty[k] = +e.target.value; e.target.nextElementSibling.textContent = e.target.value; e.target.setAttribute("aria-valuetext", `${e.target.value} percent`);
  if (lookId !== "custom") { lookId = "custom"; renderLooks(); }
  saveBeauty();
}));

// Adjust has four tabs; only one group of controls shows at a time, to keep the photo large.
function showAdjTab(name, focus) {
  document.querySelectorAll("#adjustPanel [role=tab]").forEach((t) => {
    const on = t.dataset.adj === name;
    t.setAttribute("aria-selected", String(on)); t.tabIndex = on ? 0 : -1;
    $(t.getAttribute("aria-controls")).hidden = !on;
    if (on && focus) t.focus();
  });
  renderAdjNote();
}
document.querySelectorAll("#adjustPanel [role=tab]").forEach((t, i, all) => {
  t.addEventListener("click", () => showAdjTab(t.dataset.adj));
  t.addEventListener("keydown", (e) => {
    const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0; if (!d) return;
    e.preventDefault(); showAdjTab(all[(i + d + all.length) % all.length].dataset.adj, true);
  });
});
// Face and Makeup need the face model and a face in view; say so instead of a slider that does nothing.
function renderAdjNote() {
  const tab = (document.querySelector("#adjustPanel [aria-selected=true]") || {}).dataset;
  const faceTab = tab && (tab.adj === "face" || tab.adj === "makeup");
  const msg = !faceTab || cam.state !== "live" ? ""
    : liveFace.failed ? "Face effects couldn't load. Check your connection, then reopen the camera."
    : !cam.gl || !cam.gl.live ? "Face effects aren't available on this device."
    : !liveFace.ready ? "Getting face effects ready…"
    : !liveFace.seen ? "Point the camera at a face to see these." : "";
  if ($("adjNote").textContent !== msg) $("adjNote").textContent = msg;
  $("adjNote").hidden = !msg;
}
// Press and hold the preview to see the camera without the look.
let compareTimer = 0;
const endCompare = () => { clearTimeout(compareTimer); cam.compare = false; $("camCompare").hidden = true; };
$("viewfinder").addEventListener("pointerdown", (e) => {
  if (cam.state !== "live" || cam.shot || !cam.gl || e.target.closest(".vf-state")) return;
  compareTimer = setTimeout(() => { cam.compare = true; $("camCompare").hidden = false; }, 150);
});
["pointerup", "pointercancel", "pointerleave"].forEach((n) => $("viewfinder").addEventListener(n, endCompare));

function camState(kind) {
  // live = camera working; denied/error = someone who wanted the camera and couldn't use it.
  if (kind !== cam.state && ["live", "denied", "error", "unavailable"].includes(kind)) track("camera", { state: kind });
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
  renderAdjNote();
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
  cam.gl = cam.gl || initLive($("camCanvas")) || initGl($("camCanvas"));
  if (cam.gl && cam.gl.live) liveFinder();
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
  cam.stream = null; resetFace(); endCompare();
  const v = $("camVideo"); if (v.srcObject) { v.pause(); v.srcObject = null; }
}
const LIVE_PREVIEW = Math.round(Math.min(1280, Math.max(window.screen.width, window.screen.height) * Math.min(2, devicePixelRatio || 1)));
function drawFrame() {
  const v = $("camVideo"), c = $("camCanvas");
  if (!cam.stream) return;
  // One bad frame must never stop the loop: the preview would freeze until the camera reopens.
  try { drawCamFrame(v, c); } catch (e) { resetFace(); reportError(e && e.message, e && e.stack); }
  cam.raf = requestAnimationFrame(drawFrame);
}
function drawCamFrame(v, c) {
  if (v.videoWidth) {
    // The live look is drawn at about screen size (it is worked out in camera pixels, so it
    // looks the same); the photo itself is drawn at full size when the shutter is pressed.
    const s = cam.gl && cam.gl.live ? Math.min(1, LIVE_PREVIEW / Math.max(v.videoWidth, v.videoHeight)) : 1;
    const cw = Math.round(v.videoWidth * s), ch = Math.round(v.videoHeight * s);
    if (c.width !== cw || c.height !== ch) { c.width = cw; c.height = ch; if (cam.gl) cam.gl.gl.viewport(0, 0, c.width, c.height); }
    if (cam.gl && cam.gl.live) {
      const seen = liveFace.seen > 0;
      // The Original look (no smoothing, reshape or makeup) needs no face tracking.
      if (beauty.smooth || LIVE_KEYS.some((k) => beauty[k])) trackFace(v); else resetFace();
      drawLive(cam.gl, v, v.videoWidth, v.videoHeight, cam.facing === "user", beauty, cam.compare);
      if (seen !== liveFace.seen > 0) renderAdjNote();
      if (!$("adjustPanel").hidden) followFace(c);
    } else if (cam.gl) {
      const { gl } = cam.gl;
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, v);
      drawBeauty(cam.gl, c.width, c.height, cam.facing === "user", beauty);
    } else {
      const x = c.getContext("2d"); x.save();
      if (cam.facing === "user") { x.translate(c.width, 0); x.scale(-1, 1); }
      x.drawImage(v, 0, 0); x.restore();
    }
  }
}
// The preview fills the whole screen (cropped, not shrunk), with the controls over it. While
// Adjust is open, it keeps the face in the middle of the part the panel leaves, where it can.
function followFace(c) {
  const P = liveFace.pts, H = c.height;
  const fy = P ? (P[LIVE_PTS.brow][1] + P[LIVE_PTS.chin][1]) / 2 / liveFace.size[1] : 0.45;
  cam.focusY = cam.focusY == null ? fy : cam.focusY + (fy - cam.focusY) * 0.15;
  const bw = c.clientWidth, bh = c.clientHeight, k = Math.max(bw / c.width, bh / H), hs = H * k;
  if (!bw || hs - bh < 1) return;
  const open = $("camControls").getBoundingClientRect().top - c.getBoundingClientRect().top, vh = Math.max(bh / 3, Math.min(bh, open));
  const p = Math.min(1, Math.max(0, (cam.focusY * hs - vh / 2) / (hs - bh)));
  cam.posY = p;
  const pos = `50% ${(p * 100).toFixed(1)}%`;
  if (c.style.objectPosition !== pos) c.style.objectPosition = pos;
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
  track("capture", { look: lookId });
  Platform.haptic("heavy");
  const flash = document.createElement("div"); flash.className = "cam-flash"; document.body.append(flash); setTimeout(() => flash.remove(), 400);
  let shot;
  try {
    const o = newCanvas(v.videoWidth, v.videoHeight), octx = o.getContext("2d");
    if (cam.facing === "user") { octx.translate(o.width, 0); octx.scale(-1, 1); }
    octx.drawImage(v, 0, 0);
    const looked = cam.gl && !isOriginalLook();
    if (looked && cam.gl.live) {
      // One frame at the camera's full size for the photo; the next preview frame shrinks it back.
      const c = $("camCanvas"); c.width = v.videoWidth; c.height = v.videoHeight;
      drawLive(cam.gl, v, v.videoWidth, v.videoHeight, cam.facing === "user", beauty, false);
    }
    // The photo is what the screen showed: the full-screen preview's crop of the frame.
    const r = visibleRect(o.width, o.height), raw = cropTo(o, r);
    const processed = looked ? cropTo(withFilterCanvas($("camCanvas"), beauty.filter, o.width, o.height), r).toDataURL("image/jpeg", 0.92) : null;
    const stamp = Date.now();
    shot = { raw: raw.toDataURL("image/jpeg", 0.92), rawBlob: await canvasBlob(raw), processed, w: raw.width, h: raw.height,
      look: looked ? lookName() : null, stamp, saved: false, originalSaved: false, saving: null };
  } catch {
    say("Couldn't take the photo. Try again.", true); return;
  }
  cam.shot = shot;
  stopCamera(); renderReview();
  makeThumb(shot.processed || shot.raw).then((t) => { cam.thumb = t; renderReview(); }).catch(() => {});
  // With AI Enhance on, the photo goes straight to Enhance (enhance.js); auto-save then keeps
  // the enhanced photo, or this one if Enhance can't run.
  if (camAIOn()) camEnhance(shot, true);
  else if (autoSaveOn()) {
    $("alertLive").textContent = "Photo taken. Saving it now.";
    saveShot(shot, true);
  } else $("alertLive").textContent = "Photo taken. Save it, edit it, or retake.";
});
// The part of a W×H frame the preview shows (object-fit: cover, and Adjust's face position).
function visibleRect(W, H) {
  const c = $("camCanvas"), bw = c.clientWidth, bh = c.clientHeight;
  if (!bw || !bh) return { x: 0, y: 0, w: W, h: H };
  const k = Math.max(bw / W, bh / H), w = Math.min(W, Math.round(bw / k)), h = Math.min(H, Math.round(bh / k));
  return { x: Math.round((W - w) / 2), y: Math.round((H - h) * (cam.posY == null ? 0.5 : cam.posY)), w, h };
}
function cropTo(src, r) {
  if (r.x === 0 && r.y === 0 && r.w === src.width && r.h === src.height) return src;
  const c = newCanvas(r.w, r.h); c.getContext("2d").drawImage(src, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h); return c;
}
function renderReview() {
  const s = cam.shot;
  $("reviewImg").hidden = !s; $("camCanvas").hidden = !!s;
  $("liveControls").hidden = !!s; $("reviewControls").hidden = !s;
  $("camAI").hidden = !!s; $("shotAIBtn").hidden = !s;
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
  if (where === "downloaded") return /Android/i.test(navigator.userAgent)
    ? `${what} saved to Downloads. ${n > 1 ? "They show" : "It shows"} in your Gallery.${extra}`
    : `Download started. Your browser keeps ${n > 1 ? "them" : "it"} in Downloads.${extra}`;
  return `Sent to the share sheet. Choose Save Image there to keep ${n > 1 ? "them" : "it"}.${extra}`;
}
const saveFailText = () => (native ? "Couldn't save. Allow photo access for Glow in your phone's Settings, then try Save again." : "Couldn't save the photo. Try again.");

// Saves a camera photo once. Auto-save and the Save button share this, so a photo is never
// saved twice; with "Also save the original", the untouched frame goes too (only when a look
// changed it). Success is only shown once the platform says the save finished.
// Auto-save is on unless turned off, like a phone's own camera, except in iPhone browsers,
// where a save can only go through the share sheet (an automatic one would land in Files).
const autoSaveOn = () => { const v = store.get("glowAutoSave"); return v ? v === "on" : native || !/iPhone|iPad|iPod/.test(navigator.userAgent); };
function saveShot(s, auto, note = "") {
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
      track("save", { from: "camera", auto: !!auto, look: lookId, where: String(where || "") });
      s.saved = true; if (withOrig || !s.processed) s.originalSaved = true;
      if (cam.shot === s || ed.shotStamp === s.stamp) say(savedText(where, items.length, note));
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
  $("saveOrigToggle").checked = store.get("glowSaveOrig") === "on";
  $("autoSaveToggle").checked = autoSaveOn();
  applyTheme(); showBuild();
  $("settings").showModal();
}
// Which build this is, so a test on a phone can be matched to a commit. The fingerprint is a
// hash of the app's own files as served (tools/fingerprint.js computes the same from a checkout),
// so it identifies the code actually running, whichever URL or cache it came from.
const FEATURES = "reshape-v2 · crop-v2";
const BUILD_FILES = ["/index.html", "/app.js", "/engine.js", "/styles.css"];
async function showBuild() {
  let fp = "";
  try {
    const texts = await Promise.all(BUILD_FILES.map((f) => fetch(f, { cache: "no-store" }).then((r) => (r.ok ? r.text() : Promise.reject()))));
    const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(texts.join("\n")));
    fp = [...new Uint8Array(d)].slice(0, 4).map((b) => b.toString(16).padStart(2, "0")).join("");
  } catch {}
  buildFp = fp || buildFp;
  $("buildId").textContent = `Build ${fp || "unknown"} · ${FEATURES} · ${location.host || "app"}`;
}
$("camSettingsBtn").addEventListener("click", openSettings);
$("homeSettingsBtn").addEventListener("click", openSettings);
$("themeSeg").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) { store.set("glowTheme", b.dataset.theme); applyTheme(); track("setting", { theme: b.dataset.theme }); } });
$("saveOrigToggle").addEventListener("change", (e) => { store.set("glowSaveOrig", e.target.checked ? "on" : "off"); track("setting", { save_original: e.target.checked }); });
$("autoSaveToggle").addEventListener("change", (e) => { store.set("glowAutoSave", e.target.checked ? "on" : "off"); track("setting", { auto_save: e.target.checked }); });
$("autoSaveHelp").textContent = native && plugins.Media
  ? "Each photo goes to the Glow album as soon as you take it. You can still edit or retake it."
  : "Each photo downloads as soon as you take it. Look in Downloads; browsers can't save to your photo library.";
$("goProBtn").addEventListener("click", () => { $("settings").close(); openPaywall(); });
$("deleteAccount").addEventListener("click", async (e) => {
  e.preventDefault();
  const ok = await ask({ title: "Delete your account and data?", text: "This permanently deletes your Glow account and its data. It can't be undone. Cancel any subscription in your store settings too.",
    actions: [{ label: "Delete everything", value: "yes" }, { label: "Keep my account", value: "", kind: "ghost" }] });
  if (!ok) return;
  try {
    await call("account", { method: "DELETE" });
    session = null; store.set("glowSession", ""); store.set("glowPro", "");
    // The photos being edited on this device go too, so nothing of the old account is left behind.
    exitDemo(); ed.hist = []; ed.idx = 0; ed.pending = null; ed.session = ""; job = null; recovered = null; account = null;
    await Promise.all([Drafts.clear(), Drafts.clearJob(), Drafts.clearRecovered()]).catch(() => {});
    $("settings").close(); if (screen === "editorScreen" || screen === "editorHome") showScreen("editorHome");
    say("Your account and data were deleted.");
    refreshAccount();
  } catch (err) { say(err.message, true); }
});
// Contact support: the message goes to the admin page's inbox with the account ID, so the owner
// can look the account up, give credits back or check a purchase.
$("contactSupport").addEventListener("click", (e) => {
  e.preventDefault();
  const id = session && session.user_id;
  $("supportAccount").replaceChildren(id ? `Your account ID: ${id}. It's sent with your message so we can find your account.` : "");
  $("settings").close(); $("supportSheet").showModal();
});
$("supportForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const message = $("supportMessage").value.trim();
  if (!message) return;
  $("supportSend").disabled = true; $("supportSend").textContent = "Sending…";
  try {
    const context = { plan: (account && account.plan) || "", credits: account ? account.remaining : "", platform: PLATFORM, build: buildFp, screen,
      device: navigator.userAgent.replace(/\s*\([^)]*\)\s*/, " ").slice(0, 120) };
    await call("account", { method: "POST", body: JSON.stringify({ support: { topic: $("supportTopic").value, message, email: $("supportEmail").value.trim(), context } }) });
    track("support_sent", { topic: $("supportTopic").value });
    $("supportMessage").value = "";
    $("supportSheet").close();
    say($("supportEmail").value.trim() ? "Sent. We'll reply by email." : "Sent. Thanks for telling us.");
  } catch (err) { say(err.message, true); }
  finally { $("supportSend").disabled = false; $("supportSend").textContent = "Send"; }
});
$("manageSubs").addEventListener("click", (e) => {
  e.preventDefault();
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
  window.open(ios ? "https://apps.apple.com/account/subscriptions" : "https://play.google.com/store/account/subscriptions", "_blank");
});

// Subscriptions through RevenueCat (only inside the iPhone/Android app).
let plan = "yearly", rcReady = null, rcUser = "";
// RevenueCat must buy for the account Glow is signed in with now. If the account changes (it was
// deleted, or its sign-in expired and a new one was made), a purchase made under the old id would
// reach the server for an account that no longer exists, and Pro would never switch on.
function followAccount() {
  if (!rcUser || !session || !session.user_id || session.user_id === rcUser) return;
  const id = session.user_id;
  purchases().logIn({ appUserID: id }).then(() => { rcUser = id; }).catch((e) => reportError("RevenueCat logIn failed", e && e.message));
}
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
    rcUser = s.user_id; followAccount();   // the account may have changed while configuring
    packsReady = loadPacks();
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
  track("paywall_view", { plan: account ? account.plan : "", screen });
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
$("pwPacks").addEventListener("click", () => { $("paywall").close(); openPacks(); });
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
    track("purchase_start", { plan });
    await purchases().purchasePackage({ aPackage: packages[plan] });
    track("purchase", { plan });
    $("paywall").close();
    say((await afterPurchase()) ? "Welcome to Glow Pro. Your 40 weekly AI credits are ready." : "Purchase complete. Pro will switch on within a minute.");
  } catch (err) {
    track("purchase_fail", { plan, cancelled: !!(err && err.userCancelled) });
    if (!(err && err.userCancelled)) say((err && err.message) || "Purchase didn't go through.", true);
  } finally { $("buyBtn").disabled = !native; $("buyBtn").textContent = buyLabel(); }
});
async function restore() {
  try {
    if (!(await setupPurchases())) throw new Error("Restore works in the Glow app for iPhone and Android.");
    await purchases().restorePurchases();
    const back = await afterPurchase();
    track("restore", { found: back });
    say(back ? "Glow Pro restored." : "No active subscription found for this store account.");
    $("paywall").close(); $("settings").close();
  } catch (err) { say(err.message, true); }
}
$("restoreBtn").addEventListener("click", restore);

// One-time credit packs (RevenueCat consumables). RevenueCat tells our server about the purchase,
// which adds the credits to this account (migration 012): they never expire and are used after
// the plan's own credits. A consumable can't be restored, so the credits stay with this account.
const packProducts = {};
let packsReady = null;
async function loadPacks() {
  try {
    const { products } = await purchases().getProducts({ productIdentifiers: CONFIG.creditPacks.map((k) => k.id), type: "NON_SUBSCRIPTION" });
    for (const p of products || []) packProducts[p.identifier] = p;
  } catch (e) { console.warn(e); }
  if ($("packsSheet").open) renderPacks();
}
function renderPacks() {
  $("packs").innerHTML = CONFIG.creditPacks.map((k) => {
    const sp = packProducts[k.id];
    return `<button class="pack" data-pack="${k.id}"${native ? "" : " disabled"} aria-label="${k.credits} AI credits for ${sp ? sp.priceString : k.price}">` +
      `${k.tag ? `<em>${k.tag}</em>` : ""}<b>${k.credits}</b><span class="unit">AI credits</span><span class="price">${sp ? sp.priceString : k.price}</span></button>`;
  }).join("");
  $("packsNote").textContent = native
    ? "One-time purchase, charged to your store account. Credits are added to this Glow account and used after your free or weekly credits. Deleting the app or your account removes them."
    : "Credit packs are available in the Glow app for iPhone and Android.";
  $("packsPro").hidden = !!(account && account.plan === "pro");
}
function openPacks(why) {
  setupPurchases(); renderPacks();
  $("packsTitle").textContent = why === "out" ? "Out of AI credits for this week" : "AI credit packs";
  track("packs_view", { plan: account ? account.plan : "", from: why || screen });
  $("packsSheet").showModal();
}
$("packsPro").addEventListener("click", () => { $("packsSheet").close(); openPaywall(); });
// The store tells our server through RevenueCat; check a few times until the credits show up.
async function afterPack(before) {
  for (let i = 0; i < 6; i++) {
    await refreshAccount();
    if (account && (account.bonus || 0) > before) return true;
    await new Promise((r) => setTimeout(r, 2000));
  }
  return false;
}
$("packs").addEventListener("click", async (e) => {
  const b = e.target.closest(".pack"); if (!b || b.disabled) return;
  const k = CONFIG.creditPacks.find((x) => x.id === b.dataset.pack);
  const all = [...document.querySelectorAll(".pack")];
  try {
    if (await setupPurchases()) await packsReady;
    if (!packProducts[k.id]) throw new Error("The store isn't available right now. Try again in a moment.");
    all.forEach((x) => { x.disabled = true; }); b.setAttribute("aria-busy", "true");
    track("pack_start", { id: k.id });
    const before = (account && account.bonus) || 0;
    await purchases().purchaseStoreProduct({ product: packProducts[k.id] });
    track("pack_purchase", { id: k.id });
    $("packsSheet").close();
    say((await afterPack(before)) ? `${k.credits} AI credits added. They never expire.` : "Purchase complete. Your credits will appear within a minute.");
  } catch (err) {
    track("pack_fail", { id: k.id, cancelled: !!(err && err.userCancelled) });
    if (!(err && err.userCancelled)) say((err && err.message) || "Purchase didn't go through.", true);
  } finally { renderPacks(); }
});
$("restoreBtn2").addEventListener("click", restore);

// Optional rewarded ad: when free edits run out, the user can choose to watch one
// ad for one more edit (the server allows 1 a day, for the everyday AI tools). Google confirms the finished ad to our
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
    track("ad_watched", { rewarded: !!ok });
    $("paywall").close();
    if (ok) say("You earned 1 more AI credit.");
    else say("The ad didn't finish, so no edit was added.", true);
  } catch (err) { say(err.message, true); }
  finally { $("adBtn").disabled = false; }
});

// Android back button: close a sheet, leave the photo review or the editor, then exit.
if (native && plugins.App) plugins.App.addListener("backButton", () => {
  const open = document.querySelector("dialog[open]");
  if (open) { if (!(open.id === "enhSheet" && enh.busy)) open.close(); }
  else if (typeof enhanceBack === "function" && enhanceBack()) {}
  else if (screen === "editorScreen") $("backBtn").click();
  else if (screen === "cameraScreen" && cam.shot) $("retakeBtn").click();
  else plugins.App.exitApp();
});
// Keyboard: Escape closes the tool panel; Ctrl/Cmd+Z undoes.
document.addEventListener("keydown", (e) => {
  if (screen !== "editorScreen" || document.querySelector("dialog[open]") || e.target.matches("input[type=search], input[type=text]")) return;
  if (e.key === "Escape" && sel && !reviewing()) selectTool(null, { discard: true });
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && !cr) { e.preventDefault(); (e.shiftKey ? $("redoBtn") : $("undoBtn")).click(); }
});

// ---------- Start ----------
ensureSession().then(refreshAccount).catch((e) => say(e.message, true));
setupPurchases();
setupAds();
restoreDraft();
// Glow opens on Enhance, its main flow, unless Settings says otherwise. The Enhance screen is
// its own welcome (sample before/after, Choose a photo, Try the sample); Settings can still show
// the welcome screen.
function startApp() {
  store.set("glowOnboarded", "1");
  go(store.get("glowLastDest") || "enhance");
}
startApp();
track("app_open", { dest: store.get("glowLastDest") || "enhance" });
if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
