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
const CROPS = [["Original", 0], ["Square", 1], ["4:5", 4 / 5], ["3:4", 3 / 4], ["9:16", 9 / 16], ["16:9", 16 / 9]];

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
  ["camGallery", "gallery"], ["camFlip", "flip"], ["flashBtn", "flashoff"], ["handle", "compare"]].forEach(([id, n]) => setIcon($(id), n));
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
const SLIDES = [
  { art: "camera", title: "Your light. Your look.", text: "Glow is a beauty camera and a photo editor. Take a new photo with a live look, or edit one you already love.", pair: true },
  { art: "sparkle", title: "A little—or a little more.", text: "Keep it natural or go full glam. Skin texture stays real, and reshaping is off unless you turn it on." },
  { art: "imageplus", title: "Start with your favorite photo.", text: "The camera, filters, face, makeup and background tools are free on your device. You also get 3 AI credits a day for tools like Enhance and styles." },
];
let slide = 0;
function renderSlide() {
  const s = SLIDES[slide];
  $("obSlide").innerHTML = `<div class="ob-art">${icon(s.art)}</div><h1 class="t-display">${s.title}</h1><p>${s.text}</p>` +
    (s.pair ? `<div class="ob-pair"><span>${icon("camera")}Camera</span><span>${icon("editor")}Editor</span></div>` : "");
  [...$("obDots").children].forEach((d, i) => d.classList.toggle("on", i === slide));
  $("obNext").textContent = slide === SLIDES.length - 1 ? "Open the camera" : "Next";
}
function finishOnboarding() { store.set("glowOnboarded", "1"); go("camera"); }
$("obNext").addEventListener("click", () => { if (slide < SLIDES.length - 1) { slide++; renderSlide(); } else finishOnboarding(); });
$("obSkip").addEventListener("click", finishOnboarding);
function showOnboarding() { slide = 0; renderSlide(); showScreen("onboarding"); }

// ---------- Editor state ----------
// hist[0] is the photo as opened; hist[idx] is the committed result Save exports.
// pending is an on-device preview that only becomes part of the photo on Apply.
const ed = { hist: [], idx: 0, pending: null, savedIdx: 0, fullOriginal: null, name: "", view: "split", split: 50 };
let sel = null;          // selected tool id, or null when no panel is open
let cat = store.get("glowCat") || "foryou";
let chipFor = {};
try { chipFor = JSON.parse(store.get("glowChips") || "{}"); } catch {}
let favs = [], recent = [];
try { favs = JSON.parse(store.get("glowFavs") || "[]"); recent = JSON.parse(store.get("glowRecent") || "[]"); } catch {}
let lastCommitTool = null;  // the AI tool behind the latest commit, to disclose a repeat charge
let outfitData = null, strokes = [], painting = false, busyNow = false, thumb = "";

const hasPhoto = () => ed.hist.length > 0;
const committed = () => ed.hist[ed.idx];
const unsaved = () => hasPhoto() && ed.idx > 0 && ed.savedIdx !== ed.idx;

// Tool settings. Reshaping tools start at 0, so nothing is reshaped unless the user asks.
const toolAmt = { light: 0, color: 0, warmth: 0, detail: 0 };
for (const t of TOOLS) if (t.reshape) faceSet.amt[t.id] = 0;
try {
  const s = JSON.parse(store.get("glowFace2") || "null") || { shade: (JSON.parse(store.get("glowFace") || "{}").shade) || {} };
  Object.assign(faceSet.amt, s.amt || {}); Object.assign(faceSet.shade, s.shade || {});
} catch {}
const saveFace = () => store.set("glowFace2", JSON.stringify(faceSet));
let cropSet = { ratio: 0, turns: 0 }, lookPick = null;

async function openPhoto(data, opts = {}) {
  ed.hist = [data]; ed.idx = 0; ed.pending = null; ed.savedIdx = 0; ed.fullOriginal = opts.fullOriginal || null;
  ed.name = opts.name || "Photo"; lastCommitTool = null; cutoutCache = {}; strokes = [];
  if (opts.processed) { ed.hist.push(opts.processed); ed.idx = 1; lastCommitTool = null; }
  if (opts.savedAlready) ed.savedIdx = ed.idx;
  sel = null; ed.view = "split"; ed.split = 50;
  showScreen("editorScreen");
  renderEditor(); saveDraft();
}
async function confirmReplace() {
  if (!unsaved()) return true;
  const c = await ask({ title: "Start a new edit?", text: "Your current edit hasn't been saved.", actions: [
    { label: "Save it first", value: "save" }, { label: "Discard it", value: "discard", kind: "ghost" }, { label: "Keep editing", value: "", kind: "ghost" }] });
  if (c === "save") return saveEdit();
  return c === "discard";
}
async function pickAndOpen() {
  if (!(await confirmReplace())) return;
  const f = await Platform.pickPhoto("file");
  if (!f) return;
  try { await openPhoto(await loadAndShrink(f), { name: f.name }); }
  catch (err) { say(err.message, true); }
}
$("pickBtn").addEventListener("click", pickAndOpen);
$("sampleBtn").addEventListener("click", async () => {
  if (!(await confirmReplace())) return;
  try { await openPhoto(await shrinkData("/samples/sample.jpg"), { name: "Sample" }); } catch { say("Couldn't open the sample. Check your connection.", true); }
});

// ---------- Draft: keeps the session through a refresh or the app closing ----------
let draftWarn = false;
async function saveDraft() {
  if (!hasPhoto()) return Drafts.clear();
  try {
    await Drafts.put({ orig: ed.hist[0], cur: committed(), saved: !unsaved(), name: ed.name, ts: Date.now() });
    draftWarn = false;
  } catch { draftWarn = true; }
}
window.addEventListener("beforeunload", (e) => { if (draftWarn && unsaved()) { e.preventDefault(); e.returnValue = ""; } });
async function restoreDraft() {
  const d = await Drafts.get();
  if (!d || !d.orig) return;
  ed.hist = d.cur && d.cur !== d.orig ? [d.orig, d.cur] : [d.orig];
  ed.idx = ed.hist.length - 1; ed.savedIdx = d.saved ? ed.idx : 0; ed.name = d.name || "Photo";
  if (screen === "editorHome") renderHome();
}
async function discardSession() {
  if (unsaved()) {
    const c = await ask({ title: "Discard this edit?", text: "Your changes will be lost. The original photo isn't affected.",
      actions: [{ label: "Discard", value: "yes" }, { label: "Keep it", value: "", kind: "ghost" }] });
    if (!c) return;
  }
  ed.hist = []; ed.idx = 0; ed.pending = null; sel = null;
  await Drafts.clear(); renderHome(); say("Edit discarded.");
}
$("discardBtn").addEventListener("click", discardSession);
$("resumeBtn").addEventListener("click", () => { showScreen("editorScreen"); renderEditor(); });

function renderHome() {
  $("resumeCard").hidden = !hasPhoto();
  if (hasPhoto()) {
    $("resumeImg").src = committed();
    $("resumeMeta").textContent = unsaved() ? "Not saved yet" : ed.idx > 0 ? "Saved" : "No edits yet";
  }
  renderCredits();
}

// ---------- Editor rendering ----------
function renderEditor() {
  if (!hasPhoto()) return;
  const st = $("stage"), brushing = sel === "erase";
  const after = ed.pending ? ed.pending.data : ed.idx > 0 ? committed() : null;
  const b = $("before"), a = $("after");
  const wantBefore = brushing ? committed() : ed.hist[0];
  if (b.getAttribute("src") !== wantBefore) b.src = wantBefore;
  if (after && !brushing) {
    if (a.getAttribute("src") !== after) {
      a.classList.add("fade"); a.onload = () => a.classList.remove("fade"); a.src = after;
    }
    a.hidden = false;
  } else a.hidden = true;
  st.classList.toggle("has-after", !!after && !brushing);
  st.classList.toggle("checker", /^data:image\/png/.test(after || "") && !brushing);
  st.dataset.view = brushing ? "original" : ed.view;
  document.querySelectorAll(".views button").forEach((v) => v.setAttribute("aria-pressed", String(v.dataset.view === ed.view)));
  $("previewBadge").hidden = !ed.pending;
  setSplit(ed.split);
  $("brush").hidden = !brushing;
  if (brushing) requestAnimationFrame(drawStrokes);
  $("undoBtn").disabled = !!busyNow || (ed.idx === 0 && !ed.pending);
  $("redoBtn").disabled = !!busyNow || ed.idx >= ed.hist.length - 1;
  $("saveBtn").disabled = !!busyNow || (ed.idx === 0 && !ed.pending);
  $("editorScreen").classList.toggle("editing-tool", !!sel);
  if (thumbFor !== committed()) { thumbFor = committed(); refreshThumb(); }
  renderTabs(); renderTools(); renderPanel(); renderCredits();
}
let thumbFor = null;
function setSplit(pct) {
  ed.split = Math.max(0, Math.min(100, pct));
  $("after").style.clipPath = $("stage").dataset.view === "split" ? `inset(0 0 0 ${ed.split}%)` : "";
  $("divider").style.left = ed.split + "%";
  $("handle").setAttribute("aria-valuenow", String(Math.round(ed.split)));
  $("handle").setAttribute("aria-valuetext", `${Math.round(ed.split)}% original`);
}
document.querySelector(".views").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-view]"); if (!b) return;
  ed.view = b.dataset.view; renderEditor();
});
// Drag the divider (or anywhere on the photo) to compare; arrow keys move the handle.
let dragging = false;
const dragTo = (e) => { const r = $("stage").getBoundingClientRect(); setSplit(((e.clientX - r.left) / r.width) * 100); };
$("stage").addEventListener("pointerdown", (e) => {
  if (!$("stage").classList.contains("has-after") || $("stage").dataset.view !== "split" || e.target.closest(".views")) return;
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
function commit(data, t) {
  ed.hist = ed.hist.slice(0, ed.idx + 1); ed.hist.push(data);
  if (ed.hist.length > 21) { ed.hist.splice(1, 1); ed.savedIdx = Math.max(-1, ed.savedIdx - 1); }
  ed.idx = ed.hist.length - 1; ed.pending = null;
  lastCommitTool = t && t.kind === "ai" ? t.id : null;
  if (t) { recent = [t.id, ...recent.filter((x) => x !== t.id)].slice(0, 8); store.set("glowRecent", JSON.stringify(recent)); }
  ed.view = "split"; ed.split = 50;
  saveDraft();
}
$("undoBtn").addEventListener("click", () => {
  if (ed.pending) { ed.pending = null; previewToken++; }
  else if (ed.idx > 0) ed.idx--;
  lastCommitTool = null; renderEditor(); saveDraft(); say("Undone.");
});
$("redoBtn").addEventListener("click", () => {
  if (ed.idx < ed.hist.length - 1) { ed.pending = null; ed.idx++; lastCommitTool = null; renderEditor(); saveDraft(); say("Redone."); }
});

// ---------- Categories and tools ----------
function groupsFor(c) {
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
  if (groups) {
    const pick = chipFor[cat] || groups[0][0];
    $("chips").replaceChildren(...groups.map(([k, name]) => {
      const b = document.createElement("button"); b.className = "subchip"; b.textContent = name; b.dataset.chip = k;
      b.setAttribute("aria-pressed", String(k === pick)); return b;
    }));
  }
  $("searchBox").hidden = cat !== "all";
}
function toolButton(t) {
  const b = document.createElement("button");
  b.className = "tool"; b.dataset.tool = t.id;
  b.setAttribute("aria-pressed", String(sel === t.id));
  const cost = costOf(t);
  b.setAttribute("aria-label", t.label + (cost ? `, uses ${credits(cost)}` : ", free"));
  const well = document.createElement("i"); well.className = "well";
  if (t.kind === "filter") {
    if (thumb) { well.style.backgroundImage = `url(${thumb})`; well.style.filter = t.filter.f; }
  } else well.innerHTML = icon(t.id);
  if (cost) { const c = document.createElement("span"); c.className = "cost"; c.textContent = `AI · ${cost}`; c.setAttribute("aria-hidden", "true"); well.append(c); }
  const name = document.createElement("span"); name.className = "name"; name.textContent = t.label;
  b.append(well, name);
  return b;
}
function renderTools() {
  const groups = groupsFor(cat), box = $("tools");
  if (!groups.length) { box.innerHTML = `<p class="empty-note">No tools match that search.</p>`; return; }
  const showLabels = cat === "foryou" || cat === "all";
  box.replaceChildren(...groups.map(([, name, ids]) => {
    const g = document.createElement("div"); g.className = "group"; g.setAttribute("role", "group"); g.setAttribute("aria-label", name);
    if (showLabels) { const l = document.createElement("span"); l.className = "group-label"; l.textContent = name; l.setAttribute("aria-hidden", "true"); g.append(l); }
    const items = document.createElement("div"); items.className = "group-items";
    items.append(...ids.filter((id) => TOOL[id]).map((id) => toolButton(TOOL[id])));
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
  cat = t.dataset.cat; store.set("glowCat", cat); renderTabs(); renderTools();
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
  sel = id; strokes = []; outfitData = null; cropSet = { ratio: 0, turns: 0 }; panelBuilt = null;
  lookPick = editorLooks().some((l) => l.id === lookId) ? lookId : "natural";
  if (id in toolAmt) toolAmt[id] = 0; // adjustments start from the committed photo
  renderEditor();
  if (id) {
    const t = TOOL[id];
    if (t.kind === "adjust" || t.kind === "crop") return; // previews once changed
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
  const o = document.createElement("output"); o.textContent = fmt(value);
  r.addEventListener("input", () => { o.textContent = fmt(+r.value); onInput && onInput(+r.value); });
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
    body.append(options(CROPS, (v) => v === cropSet.ratio, (v) => { cropSet.ratio = v; renderPanel(true); preview(); }));
    const r = document.createElement("button"); r.className = "btn quiet small"; r.innerHTML = icon("rotate") + "Rotate";
    r.addEventListener("click", () => { cropSet.turns++; preview(); }); body.append(r);
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
  const cost = costOf(t), chip = $("cost"), apply = $("applyBtn");
  let note = t.hint || "";
  if (!cost) { chip.textContent = "Free · on-device"; chip.className = "chip free"; }
  else { chip.textContent = `AI · ${credits(cost)}`; chip.className = "chip"; }
  if (t.reshape && !(faceSet.amt[t.id] > 0)) note = (note ? note + " " : "") + "Starts at 0. Move the slider to reshape.";
  if ($("clearMarks")) $("clearMarks").disabled = !strokes.length;

  // Apply: on-device tools commit the preview; AI tools charge here, once.
  apply.disabled = busyNow;
  if (!cost) {
    apply.textContent = "Apply";
    if (t.kind === "adjust") apply.disabled ||= !ed.pending;
    if (t.reshape) apply.disabled ||= !(faceSet.amt[t.id] > 0);
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
    if (t.id === "outfit" && !outfitData && !short) apply.disabled = true;
    if (t.id === "erase" && !strokes.length && !short) apply.disabled = true;
  }
  $("panelNote").textContent = note;
}

// On-device previews. A newer preview replaces an older one that is still running.
let previewToken = 0;
async function computeLocal(t, base) {
  if (t.kind === "face") return faceEdit(base, t.id, (faceSet.amt[t.id] ?? 50) / 100);
  if (t.kind === "body") return bodyEdit(base, t.id, (faceSet.amt[t.id] ?? 50) / 100);
  if (t.kind === "hair") return hairColor(base, (faceSet.amt[t.id] ?? 50) / 100, faceSet.shade.hcolor);
  if (t.kind === "filter") return applyFilter(base, t.filter);
  if (t.kind === "adjust") return toolAmt[t.id] ? adjust(base, t.id, toolAmt[t.id]) : null;
  if (t.kind === "crop") return cropSet.ratio || cropSet.turns % 4 ? cropRotate(base, cropSet.ratio, cropSet.turns) : null;
  if (t.kind === "look") return applyLook(base, editorLooks().find((l) => l.id === lookPick) || PRESET_LOOKS[1]);
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
  const t = sel && TOOL[sel]; if (!t || costOf(t)) return;
  const token = ++previewToken, base = committed();
  const slow = setTimeout(() => { if (token === previewToken) setBusy(true, t.kind === "face" || t.kind === "body" || t.kind === "hair" || t.kind === "bg" ? "Finding the details…" : "Working…"); }, 250);
  try {
    const out = await computeLocal(t, base);
    if (token !== previewToken || sel !== t.id) return;
    ed.pending = out ? { tool: t.id, data: out } : null;
    if (out) { ed.view = "split"; $("alertLive").textContent = ""; }
  } catch (err) {
    if (token === previewToken) { ed.pending = null; say(err.message, true); }
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
  const cost = costOf(t);
  if (!cost) {
    let data = ed.pending && ed.pending.tool === t.id ? ed.pending.data : null;
    if (!data) {
      setBusy(true, "Working…");
      try { data = await computeLocal(t, committed()); } catch (err) { say(err.message, true); } finally { setBusy(false); }
    }
    if (!data) return;
    commit(data, t); sel = null; renderEditor();
    say(`${t.title} applied.`); Platform.haptic();
    return;
  }
  // AI: check the balance we know about first; the server makes the final call.
  if (account && account.remaining < cost) {
    if (account.plan === "pro") say("You've used this week's AI credits. Each one comes back 7 days after it was used.", true); else openPaywall();
    return;
  }
  const before = account ? account.remaining : null;
  setBusy(true, `${t.title}…`, "AI edits can take up to a minute.");
  $("alertLive").textContent = `${t.title} is running.`;
  try {
    const base = committed();
    let out;
    if (t.id === "erase") {
      const up = await uploadable(base), dims = await loadImg(up);
      out = await runModel("erase", up, t.title, eraseMask(dims.naturalWidth, dims.naturalHeight));
      strokes = [];
    } else if (t.id === "expand") {
      const x = await expandInputs(base);
      out = await runModel("expand", x.image, t.title, x.mask);
    } else if (t.id === "outfit") {
      out = await runModel("outfit", base, t.title, undefined, outfitData);
    } else out = await runModel(t.id, base, t.title);
    commit(out, t); sel = null;
    say(`${t.title} done. Drag the line to compare.`); Platform.haptic();
  } catch (err) {
    if (err.limit) { say(err.message, true); if (!account || account.plan !== "pro") openPaywall(); renderPanel(); }
    else {
      // Only report what the server confirms about the credit.
      await refreshAccount();
      let extra = "";
      if (before != null && account) extra = account.remaining >= before ? " No AI credit was used." : ` This used ${credits(before - account.remaining)}.`;
      say(err.message + extra, true);
    }
  } finally { setBusy(false); }
}

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
async function saveEdit() {
  if (ed.pending) {
    const t = TOOL[ed.pending.tool];
    const c = await ask({ title: `Apply ${t.title} before saving?`, text: "This change is only a preview so far.", actions: [
      { label: "Apply and save", value: "apply" }, { label: "Save without it", value: "skip", kind: "ghost" }, { label: "Keep editing", value: "", kind: "ghost" }] });
    if (!c) return false;
    if (c === "apply") { commit(ed.pending.data, t); sel = null; } else { discardPending(); sel = null; }
    renderEditor();
  }
  if (ed.idx === 0) { say("Nothing to save yet. Apply a tool first."); return false; }
  const stamp = Date.now(), items = [{ data: committed(), name: `glow-${stamp}` }];
  if (store.get("glowSaveOrig") === "on") items.unshift({ data: ed.fullOriginal || ed.hist[0], name: `glow-${stamp}-original` });
  try {
    const where = await Platform.savePhotos(items);
    ed.savedIdx = ed.idx; saveDraft(); renderEditor();
    say(where === "photos" ? "Saved to your Glow album." : where === "downloaded" ? "Saved to your downloads." : "Choose Save Image to keep it.");
    return true;
  } catch (err) {
    if (err && err.name === "AbortError") return false;
    say(native ? "Couldn't save. Allow photo access for Glow in your phone's settings." : "Couldn't save the photo. Try again.", true);
    return false;
  }
}
$("saveBtn").addEventListener("click", saveEdit);
// Back keeps the session; it's waiting on the Editor landing under "Continue editing".
$("backBtn").addEventListener("click", () => { discardPending(); sel = null; go("editor"); });

// ---------- Credits ----------
let account = null;
function balanceText(a) { const n = a.remaining; return `${n} AI credit${n === 1 ? "" : "s"} left ${a.plan === "pro" ? "this week" : "today"}`; }
function nextUtcMidnight() { const d = new Date(); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1)); }
function renderCredits() {
  const a = account;
  $("balanceBtn").hidden = !a; $("homeCredits").hidden = !a;
  if (!a) return;
  $("balanceBtn").innerHTML = icon("sparkle") + `<span>${balanceText(a)}</span>`;
  $("balanceBtn").setAttribute("aria-label", `${balanceText(a)}. Details`);
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

const cam = { stream: null, facing: store.get("glowFacing") || "user", gl: null, raf: 0, state: "", torch: false, shot: null, thumb: "" };
const isOriginalLook = () => !beauty.smooth && !beauty.bright && !beauty.warm && beauty.filter === "none";
function renderLooks() {
  const live = !!cam.gl;
  $("camLooks").hidden = !live;
  ["sSmooth", "sBright", "sWarm"].forEach((id, i) => { const v = beauty[["smooth", "bright", "warm"][i]]; $(id).value = v; $(id).nextElementSibling.textContent = v; });
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
  beauty[k] = +e.target.value; e.target.nextElementSibling.textContent = e.target.value;
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
  try { await openPhoto(await loadAndShrink(f), { name: "Camera photo" }); } catch (err) { say(err.message, true); }
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
async function startCamera() {
  stopCamera();
  camState("starting");
  cam.gl = cam.gl || initGl($("camCanvas"));
  renderLooks();
  $("camNote").hidden = !!cam.gl;
  $("camNote").textContent = "Live looks aren't available on this device. Your photo is captured as is; tap Edit photo afterwards to add looks, filters and retouching.";
  try {
    cam.stream = await Platform.camera.open(cam.facing);
  } catch (e) {
    const n = e && e.name;
    camState(n === "NotAllowedError" || n === "SecurityError" ? "denied" : n === "NotFoundError" || n === "OverconstrainedError" ? "none" : n === "NotReadableError" ? "busy" : "none");
    return;
  }
  if (screen !== "cameraScreen" || cam.shot) { stopCamera(); return; }
  const v = $("camVideo"); v.srcObject = cam.stream;
  try { await v.play(); } catch {}
  camState("live");
  const torch = Platform.camera.torchSupported(cam.stream);
  $("flashBtn").hidden = !torch; $("flashSpacer").hidden = torch;
  if (torch && cam.torch) Platform.camera.setTorch(cam.stream, true).catch(() => {});
  $("camFlip").hidden = (await Platform.camera.count()) < 2;
  drawFrame();
}
function stopCamera() {
  cancelAnimationFrame(cam.raf);
  if (cam.stream) cam.stream.getTracks().forEach((t) => t.stop());
  cam.stream = null;
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
document.addEventListener("visibilitychange", () => {
  if (screen !== "cameraScreen" || cam.shot) return;
  if (document.hidden) stopCamera(); else if (cam.state === "live" || cam.state === "starting") startCamera();
});
$("camFlip").addEventListener("click", () => {
  cam.facing = cam.facing === "user" ? "environment" : "user"; store.set("glowFacing", cam.facing); Platform.haptic(); startCamera();
});
$("flashBtn").addEventListener("click", async () => {
  cam.torch = !cam.torch;
  try { await Platform.camera.setTorch(cam.stream, cam.torch); } catch { cam.torch = false; say("Flash isn't available right now.", true); }
  $("flashBtn").setAttribute("aria-pressed", String(cam.torch)); setIcon($("flashBtn"), cam.torch ? "flash" : "flashoff");
  $("flashBtn").setAttribute("aria-label", cam.torch ? "Flash on" : "Flash off");
});

// Capture: the preview and the photo match, mirroring included.
$("shutter").addEventListener("click", () => {
  const v = $("camVideo"); if (!v.videoWidth || cam.state !== "live") return;
  Platform.haptic("heavy");
  const flash = document.createElement("div"); flash.className = "cam-flash"; document.body.append(flash); setTimeout(() => flash.remove(), 400);
  try {
    const o = newCanvas(v.videoWidth, v.videoHeight), octx = o.getContext("2d");
    if (cam.facing === "user") { octx.translate(o.width, 0); octx.scale(-1, 1); }
    octx.drawImage(v, 0, 0);
    const raw = o.toDataURL("image/jpeg", 0.92);
    const processed = cam.gl && !isOriginalLook() ? withFilter($("camCanvas"), o.width, o.height, beauty.filter) : raw;
    cam.shot = { raw, processed, look: isOriginalLook() ? null : lookName(), stamp: Date.now(), saved: false };
    stopCamera(); renderReview();
    makeThumb(processed).then((t) => { cam.thumb = t; }).catch(() => {});
    $("alertLive").textContent = "Photo taken. Save it, edit it, or retake.";
  } catch {
    say("Couldn't take the photo. Try again.", true);
  }
});
function renderReview() {
  const s = cam.shot;
  $("reviewImg").hidden = !s; $("camCanvas").hidden = !!s;
  $("liveControls").hidden = !!s; $("reviewControls").hidden = !s;
  $("nav").hidden = screen !== "cameraScreen" ? $("nav").hidden : !!s;
  if (s) {
    $("reviewImg").src = s.processed; $("camState").hidden = true; $("camNote").hidden = true;
    $("saveShotBtn").disabled = s.saved; $("saveShotBtn").innerHTML = s.saved ? icon("check") + "Saved" : "Save";
  }
  const g = $("camGallery");
  if (cam.thumb) { g.innerHTML = `<img alt="" src="${cam.thumb}">`; } else setIcon(g, "gallery");
}
async function makeThumb(src) { const img = await loadImg(src), c = canvasFor(img, 160); c.getContext("2d").drawImage(img, 0, 0, c.width, c.height); return c.toDataURL("image/jpeg", 0.8); }
$("retakeBtn").addEventListener("click", () => {
  cam.shot = null; renderReview(); $("nav").hidden = false; startCamera();
});
$("saveShotBtn").addEventListener("click", async () => {
  const s = cam.shot; if (!s) return;
  const items = [{ data: s.processed, name: `glow-${s.stamp}` }];
  if (store.get("glowSaveOrig") === "on" && s.processed !== s.raw) items.unshift({ data: s.raw, name: `glow-${s.stamp}-original` });
  $("saveShotBtn").disabled = true;
  try {
    const where = await Platform.savePhotos(items);
    s.saved = true;
    say(where === "photos" ? "Saved to your Glow album." : where === "downloaded" ? "Saved to your downloads." : "Choose Save Image to keep it.");
  } catch (err) {
    if (!(err && err.name === "AbortError")) say(native ? "Couldn't save. Allow photo access for Glow in your phone's settings." : "Couldn't save the photo. Try again.", true);
  }
  renderReview();
});
$("editShotBtn").addEventListener("click", async () => {
  const s = cam.shot; if (!s) return;
  if (!(await confirmReplace())) return;
  const raw = await shrinkData(s.raw), processed = s.processed === s.raw ? null : await shrinkData(s.processed);
  cam.shot = null; renderReview();
  await openPhoto(raw, { name: "Camera photo", processed, fullOriginal: s.raw, savedAlready: s.saved });
  if (processed) say(`${s.look} look applied. Undo removes it.`);
});
async function galleryToEditor() {
  stopCamera();
  if (!(await confirmReplace())) { if (screen === "cameraScreen") enterCamera(); return; }
  const f = await Platform.pickPhoto("file");
  if (!f) { if (screen === "cameraScreen") enterCamera(); return; }
  try { cam.shot = null; await openPhoto(await loadAndShrink(f), { name: f.name }); } catch (err) { say(err.message, true); }
}
$("camGallery").addEventListener("click", galleryToEditor);

// ---------- Settings ----------
function openSettings() {
  refreshAccount();
  const start = store.get("glowStart") || "last";
  document.querySelectorAll("#startSeg button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.start === start)));
  $("saveOrigToggle").checked = store.get("glowSaveOrig") === "on";
  applyTheme();
  $("settings").showModal();
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
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); (e.shiftKey ? $("redoBtn") : $("undoBtn")).click(); }
});

// ---------- Start ----------
ensureSession().then(refreshAccount).catch((e) => say(e.message, true));
setupPurchases();
setupAds();
restoreDraft();
if (!store.get("glowOnboarded")) showOnboarding();
else { const pref = store.get("glowStart") || "last"; go(pref === "last" ? store.get("glowLastDest") || "camera" : pref); }
if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
