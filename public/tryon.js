// ---------- Try on: one tool for every outfit ----------
// Learned from the try-on apps (2026-10-31 research, notes/tryon-research.md): one place for
// the outfit, three ways to give it (a photo or screenshot of it, an idea from a list with a
// color, or her own words), a choice of which part to change, a free check of her photo before
// any credit is spent, her own face kept, every look she makes kept to flip back to for free,
// and outfit photos kept in a small closet on the device for the next photo.
// Classic script after app.js: it shares app.js's globals (TOOL, sel, job, ed, outfitData, …).

const TRY_IDEAS = [
  // [id, label, words for the AI, icon, part it changes]
  ["casual", "Casual", "a casual outfit: a fitted plain crew-neck T-shirt and straight-leg blue jeans", "outfit", "full"],
  ["suit", "Suit", "a sharp, tailored business suit with a crisp shirt", "suit", "full"],
  ["sundress", "Sundress", "a light, flowy floral summer dress", "sundress", "full"],
  ["lbd", "Black dress", "an elegant little black dress", "sundress", "full"],
  ["gown", "Gown", "an elegant floor-length evening gown", "gown", "full"],
  ["guest", "Wedding guest", "an elegant satin midi dress for a wedding guest", "sundress", "full"],
  ["blazer", "Blazer", "a structured, slightly oversized blazer over a simple top", "suit", "top"],
  ["leather", "Leather jacket", "a black leather biker jacket over a plain T-shirt", "street", "top"],
  ["knit", "Cozy knit", "a cozy, chunky cable-knit sweater", "outfit", "top"],
  ["coat", "Winter coat", "a long, tailored wool winter coat", "outfit", "top"],
  ["street", "Street", "trendy streetwear: an oversized jacket, a fitted top and stylish jeans", "street", "full"],
  ["sporty", "Sporty", "a matching athleisure set: a zip-up track jacket and joggers", "street", "full"],
  ["linen", "Linen", "a relaxed linen shirt and linen trousers for summer", "outfit", "full"],
];
const TRY_IDEA = Object.fromEntries(TRY_IDEAS.map((x) => [x[0], x]));
const TRY_COLORS = [["Any", "", ""], ["Black", "black", "#1d1b1e"], ["White", "white", "#f7f5f2"], ["Cream", "cream", "#efe3cc"], ["Red", "red", "#c22a34"],
  ["Blush", "blush pink", "#efb4c0"], ["Navy", "navy blue", "#1f2c4f"], ["Emerald", "emerald green", "#16704f"], ["Camel", "camel", "#b98552"]];
const TRY_PARTS = [["Auto", "auto"], ["Top", "top"], ["Bottom", "bottom"], ["Full look", "full"]];
// The sample's prepared previews (made with the earlier Suit and Summer dress tools).
const TRY_DEMO = { suit: "suit", sundress: "sundress" };
const CLOSET_MAX = 8, LOOKS_MAX = 8;

const tryOn = { src: "ideas", idea: "casual", color: "", words: "", part: "auto", closet: null, check: null, checkFor: "", demoShown: null };
// Every look made on this photo: { label, data, full, baseIdx }. Kept on the device with the
// session, so leaving and coming back (or a reload) still shows them; nothing is charged to look again.
let tryLooks = { session: null, items: [] };

function tryLooksNow() { return tryLooks.session === ed.session ? tryLooks.items : []; }
function saveLooks() { Drafts.write("tryLooks", tryLooks).catch(() => {}); }
Drafts.read("tryLooks").then((v) => { if (v && v.session && !tryLooks.items.length) tryLooks = v; }).catch(() => {});

async function closetLoad() {
  if (tryOn.closet) return tryOn.closet;
  const v = await Drafts.read("closet");
  return (tryOn.closet = Array.isArray(v) ? v.slice(0, CLOSET_MAX) : []);
}
function closetSave() { Drafts.write("closet", tryOn.closet || []).catch(() => {}); }
async function closetAdd(file) {
  const data = await shrinkData(await loadAndShrink(file), 1024);
  const c = await closetLoad();
  tryOn.closet = [data, ...c.filter((x) => x !== data)].slice(0, CLOSET_MAX);
  closetSave(); outfitData = data; tryOn.src = "photo";
}

// What the request asks for, and a short name for the look.
function tryRequest() {
  if (tryOn.src === "photo") return outfitData ? { extra: outfitData, part: tryOn.part, label: "Your outfit" } : null;
  if (tryOn.src === "words") { const w = tryOn.words.trim().slice(0, 160); return w ? { prompt: w, part: tryOn.part, label: w.length > 24 ? w.slice(0, 22) + "…" : w } : null; }
  const i = TRY_IDEA[tryOn.idea]; if (!i) return null;
  const c = TRY_COLORS.find((x) => x[1] === tryOn.color);
  return { prompt: i[2] + (tryOn.color ? `, mainly in ${tryOn.color}` : ""), part: i[4], label: c && c[1] ? `${c[0]} ${i[1].toLowerCase()}` : i[1] };
}

// A free look at her photo before anything is charged: try-on needs the clothes to be in it.
async function tryCheck() {
  const base = committed();
  if (tryOn.checkFor === base) return;
  tryOn.checkFor = base; tryOn.check = null;
  let msg = "";
  try {
    const boxes = await faceBoxes(base);
    if (!boxes.length) msg = "No person found. Try on works on a photo of you.";
    else if (boxes.length > 1 && boxes[1].w * boxes[1].h > boxes[0].w * boxes[0].h * 0.5) msg = "Works best with one person in the photo. The largest person is dressed.";
    // How much of her is below the chin, in face heights: about 2 for a head-and-shoulders photo,
    // 3 to 4 from the waist up, 7 head to toe.
    else if ((1 - boxes[0].y - boxes[0].h) / boxes[0].h < 2.5) msg = "Little of your outfit shows here, so the AI guesses the rest. A waist-up photo works best.";
  } catch { msg = ""; }
  if (tryOn.checkFor !== base) return;
  tryOn.check = msg;
  if (sel === "outfit") renderPanel();
}

function trySeg(body) {
  const seg = options([["Ideas", "ideas"], ["Your photo", "photo"], ["Describe", "words"]], (v) => v === tryOn.src, (v) => { tryOn.src = v; tryChanged(); });
  seg.classList.add("try-seg"); seg.setAttribute("role", "group"); seg.setAttribute("aria-label", "Outfit from");
  body.append(seg);
}

function tryIdeas(body) {
  const row = document.createElement("div"); row.className = "try-cards"; row.setAttribute("role", "group"); row.setAttribute("aria-label", "Outfit ideas");
  const list = ed.demo ? TRY_IDEAS.filter((x) => TRY_DEMO[x[0]] && demo && demo.ready.includes(TRY_DEMO[x[0]])) : TRY_IDEAS;
  list.forEach(([id, label, , ic]) => {
    const b = document.createElement("button"); b.className = "try-card"; b.dataset.idea = id;
    const on = ed.demo ? tryDemoOn() === id : tryOn.idea === id;
    b.setAttribute("aria-pressed", String(on));
    const pic = ed.demo ? `${DEMO_DIR}thumbs/${TRY_DEMO[id]}.jpg` : "";
    const well = document.createElement("i"); well.className = "well";
    if (pic) { well.style.backgroundImage = `url(${pic})`; b.classList.add("photo"); } else well.innerHTML = icon(ic);
    const name = document.createElement("span"); name.textContent = label;
    b.append(well, name);
    b.addEventListener("click", () => {
      if (ed.demo) { tryOn.demoShown = id; showDemoPreview(TRY_DEMO[id], "outfit"); return; }
      tryOn.idea = id; tryChanged();
    });
    row.append(b);
  });
  body.append(row);
  if (ed.demo) return;
  const colors = document.createElement("div"); colors.className = "opts try-colors"; colors.setAttribute("role", "group"); colors.setAttribute("aria-label", "Color");
  TRY_COLORS.forEach(([label, v, hex]) => {
    const b = document.createElement("button"); b.className = "opt try-color"; b.setAttribute("aria-pressed", String(tryOn.color === v));
    b.setAttribute("aria-label", label); b.title = label;
    if (hex) { const dot = document.createElement("i"); dot.style.background = hex; b.append(dot); } else b.textContent = label;
    b.addEventListener("click", () => { tryOn.color = v; tryChanged(); });
    colors.append(b);
  });
  body.append(colors);
}

function tryPhoto(body) {
  const row = document.createElement("div"); row.className = "try-closet"; row.setAttribute("role", "group"); row.setAttribute("aria-label", "Your outfit photos");
  const add = document.createElement("button"); add.className = "try-add"; add.innerHTML = icon("plus") + "<span>Add</span>";
  add.setAttribute("aria-label", "Add an outfit photo or screenshot");
  add.addEventListener("click", async () => {
    const f = await Platform.pickPhoto("outfitFile");
    if (f) { try { await closetAdd(f); } catch (err) { say(err.message, true); } tryChanged(); }
  });
  row.append(add);
  // Paste a copied product photo (desktop, and phones that allow it).
  if (navigator.clipboard && navigator.clipboard.read) {
    const paste = document.createElement("button"); paste.className = "try-add"; paste.innerHTML = icon("paste") + "<span>Paste</span>";
    paste.setAttribute("aria-label", "Paste a copied outfit picture");
    paste.addEventListener("click", async () => {
      try {
        for (const it of await navigator.clipboard.read()) {
          const type = it.types.find((x) => x.startsWith("image/"));
          if (type) { await closetAdd(new File([await it.getType(type)], "outfit.png", { type })); tryChanged(); return; }
        }
        say("There's no picture to paste. Copy an outfit picture first.", true);
      } catch { say("Glow Studio couldn't read the clipboard. Save the picture and use Add instead.", true); }
    });
    row.append(paste);
  }
  (tryOn.closet || []).forEach((data, i) => {
    const b = document.createElement("button"); b.className = "try-item"; b.setAttribute("aria-pressed", String(outfitData === data));
    b.setAttribute("aria-label", `Outfit photo ${i + 1}`); b.style.backgroundImage = `url(${data})`;
    b.addEventListener("click", () => { outfitData = data; tryChanged(); });
    row.append(b);
    if (outfitData === data) {
      const x = document.createElement("button"); x.className = "try-remove"; x.innerHTML = icon("close"); x.setAttribute("aria-label", "Remove this outfit photo");
      x.addEventListener("click", () => { tryOn.closet = tryOn.closet.filter((d) => d !== data); outfitData = null; closetSave(); renderPanel(true); });
      b.append(x);
    }
  });
  body.append(row);
  if (!tryOn.closet) closetLoad().then(() => { if (sel === "outfit" && tryOn.src === "photo" && tryOn.closet.length) renderPanel(true); });
}

function tryWords(body) {
  const l = document.createElement("label"); l.className = "prompt";
  const inp = document.createElement("input"); inp.type = "text"; inp.id = "tryWords"; inp.maxLength = 160; inp.autocomplete = "off";
  inp.placeholder = "e.g. a red satin slip dress, a denim jacket"; inp.value = tryOn.words;
  inp.addEventListener("input", () => { tryOn.words = inp.value; if (tryIsKept()) { job = null; saveJob(); renderEditor(); } else panelState(TOOL.outfit); });
  l.append(Object.assign(document.createElement("span"), { className: "sr-only", textContent: "Describe the outfit" }), inp); body.append(l);
}

function tryParts(body) {
  const row = options(TRY_PARTS, (v) => v === tryOn.part, (v) => { tryOn.part = v; tryChanged(); });
  row.classList.add("try-parts"); row.setAttribute("role", "group"); row.setAttribute("aria-label", "What to change");
  body.append(row);
}

// A new pick while a look is showing means "make another": the look closes (it stays in Your
// looks), so the button is Try on again instead of Apply for the look on screen.
function tryChanged() {
  if (tryIsKept()) { job = null; saveJob(); panelBuilt = null; renderEditor(); return; }
  renderPanel(true);
}

// Every look made on this photo, to flip between for free. Tapping one shows it for review again.
function tryLooksRow(body) {
  const items = tryLooksNow();
  if (!items.length || ed.demo) return;
  const row = document.createElement("div"); row.className = "try-looks"; row.setAttribute("role", "group"); row.setAttribute("aria-label", "Your looks");
  const h = document.createElement("span"); h.className = "try-looks-label"; h.textContent = "Your looks"; row.append(h);
  items.forEach((it, i) => {
    const b = document.createElement("button"); b.className = "try-look"; b.style.backgroundImage = `url(${it.thumb || it.data})`;
    const on = tryLookShown() === it.id;
    b.setAttribute("aria-pressed", String(on)); b.setAttribute("aria-label", `${it.label}, look ${i + 1}`);
    b.addEventListener("click", () => tryShowLook(it));
    row.append(b);
  });
  body.append(row);
}
// Which kept look is showing for review, if any.
const tryLookShown = () => (job && job.status === "done" && job.tool === "outfit" && job.session === ed.session ? job.lookId || job.requestId : null);
const tryIsKept = () => !!tryLookShown() && tryLooksNow().some((x) => x.id === tryLookShown());
function tryShowLook(it) {
  if (jobActive()) { say(`Wait for ${job.title} to finish first.`, true); return; }
  if (tryLookShown() === it.id) return;
  if (resultReady() && !tryIsKept()) { say(`Apply or discard the ${job.title} result first.`, true); return; }
  job = { requestId: rid(), lookId: it.id, id: null, tool: "outfit", title: "Try on", look: it.label, session: ed.session, baseIdx: Math.min(it.baseIdx, ed.hist.length - 1), status: "done", startedAt: Date.now(), result: { data: it.data, full: it.full }, relook: true };
  saveJob(); sel = "outfit"; renderEditor();
  say(`${it.label} look shown. Apply keeps it.`);
}
// Called when a try-on result arrives: keep it in the looks row.
async function tryKeepLook(mine) {
  if (!mine || mine.tool !== "outfit" || !mine.result) return;
  let thumb = "";
  try { thumb = await shrinkData(mine.result.data, 160); } catch {}
  if (tryLooks.session !== ed.session) tryLooks = { session: ed.session, items: [] };
  const id = mine.lookId || mine.requestId;
  tryLooks.items = [{ id, label: mine.look || "Look", data: mine.result.data, full: mine.result.full, thumb, baseIdx: mine.baseIdx },
    ...tryLooks.items.filter((x) => x.id !== id)].slice(0, LOOKS_MAX);
  saveLooks();
  if (sel === "outfit") renderPanel(true);
}

function tryOnPanel(body) {
  if (ed.demo) { tryIdeas(body); return; }
  trySeg(body);
  if (tryOn.src === "ideas") tryIdeas(body);
  else if (tryOn.src === "photo") { tryPhoto(body); tryParts(body); }
  else { tryWords(body); tryParts(body); }
  tryLooksRow(body);
  tryCheck();
}
// The note under the title: the photo check first (it can save a credit), then the usual hint.
function tryOnNote() {
  if (tryOn.check) return tryOn.check;
  if (tryOn.src === "photo" && !outfitData) return "Add a photo or screenshot of the outfit.";
  return "";
}

// ---------- On the AI sample ----------
// The sample has prepared Suit and Summer dress results; Try on shows those, free.
const tryDemoReady = () => (demo ? Object.values(TRY_DEMO).filter((id) => demo.ready.includes(id)) : []);
const tryDemoOn = () => (ed.demo && ed.idx > 0 && tryOn.demoShown ? tryOn.demoShown : null);
function tryDemoState() {
  const chip = $("cost"), apply = $("applyBtn"), shown = tryDemoOn(), id = shown && TRY_DEMO[shown];
  chip.textContent = "Prepared preview"; chip.className = "chip"; apply.disabled = false;
  let note = "Tap an outfit to see a prepared result. No credits used.";
  if (demo && demo.loading && demo.loading === (TRY_DEMO[tryOn.demoShown] || "")) { apply.textContent = "Done"; apply.disabled = true; note = "Loading the prepared preview…"; }
  else if (tryOn.demoShown && demo && demo.failed[TRY_DEMO[tryOn.demoShown]]) { apply.textContent = "Retry"; note = "Couldn't load this preview. Check your connection and try again."; }
  else if (id) { apply.textContent = "Done"; note = `A prepared ${TRY_IDEA[shown][1]} result. On your own photo, use any outfit photo, idea or words.`; }
  else apply.textContent = "Use your photo";
  $("panelNote").textContent = note; fitDock();
}
function tryDemoApply() {
  const shown = tryOn.demoShown;
  if (shown && demo && demo.failed[TRY_DEMO[shown]]) { showDemoPreview(TRY_DEMO[shown], "outfit"); return; }
  if (tryDemoOn()) { sel = null; renderEditor(); return; }
  pickAndOpen();
}
