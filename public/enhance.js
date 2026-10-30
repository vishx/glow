// ---------- One-tap Enhance: Glow's main flow ----------
// Pick a photo, tap Enhance, compare before and after, switch enhancers on or off, save, share.
// One AI request per photo (the server's "enhance" mode: faces restored, background sharpened,
// 2x larger; an everyday AI tool, so it draws on the daily credits). Every toggle on the Result
// screen is made on the phone from that one result, so switching costs nothing and is instant
// the second time. Loaded after app.js and uses its helpers (call, account, readPhoto, ...).

const ENH_MODE = "enhance";
const ENH_SAMPLE = { original: DEMO_DIR + "original.png", result: DEMO_DIR + "enhance.jpg" };
// [key, label, icon, on by default]. Face and Background Enhancer choose, per area, between the
// AI result and the original; the rest are free on-device steps on top.
const ENH_TOGGLES = [["face", "Face Enhancer", "face", true], ["bg", "Background Enhancer", "upscale", true],
  ["retouch", "Face Retouch", "fsmooth", false], ["colors", "Colors", "palette", false], ["blur", "Background Blur", "bgblur", false]];
const enh = {
  src: null, original: null, name: "", demo: false,   // the picked photo (working size) and its untouched file
  ai: null, base: null, faces: [],                    // the AI result, the photo at the result's size, face outlines (0–1)
  on: {}, cache: new Map(), current: null, token: 0,  // toggle state and the composites made so far
  busy: false, pending: null, saved: null, split: 50,
};

// ---------- Launch animation ----------
// The mark draws itself, the glint pops, the wordmark settles, then the app shows through.
// It never holds the app back for more than about 1.4 s, and a tap skips it.
(function splash() {
  const s = $("splash"); if (!s) return;
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const hide = () => { if (s.classList.contains("out")) return; s.classList.add("out"); setTimeout(() => s.remove(), 700); };
  setTimeout(hide, Math.max(0, (reduce ? 300 : 1400) - performance.now()));
  s.addEventListener("pointerdown", hide);
})();

// ---------- Home ----------
setIcon($("enhSettingsBtn"), "settings");
$("enhSettingsBtn").addEventListener("click", openSettings);
function renderEnhanceHome() {
  const b = $("enhCredits"), a = account;
  b.hidden = !a;
  if (a) b.innerHTML = icon("sparkle") + `<span>${balanceText(a)}</span>`;
}
$("enhCredits").addEventListener("click", openCredits);
$("enhPick").addEventListener("click", enhancePick);
$("enhSample").addEventListener("click", enhanceSample);

async function enhancePick() {
  const f = await Platform.pickPhoto("file");
  if (!f) return;
  try { const r = await readPhoto(f, f.name); openEnhSheet(r.work, r.original, f.name, false); }
  catch (err) { say(err.message, true); }
}
async function enhanceSample() {
  try {
    const r = await fetch(ENH_SAMPLE.original); if (!r.ok) throw new Error();
    const p = await readPhoto(await r.blob(), "glow-sample");
    openEnhSheet(p.work, p.original, "AI sample", true);
  } catch { say("Couldn't load the sample. Check your internet and try again.", true); }
}

// ---------- Pick sheet ----------
setIcon($("enhSheetClose"), "close");
function openEnhSheet(work, original, name, demo) {
  if (enh.busy) return;
  Object.assign(enh, { src: work, original, name, demo, ai: null, base: null, faces: [], pending: null, saved: null });
  enh.cache.clear();
  $("enhSheetImg").src = work;
  $("enhSheetSample").hidden = !demo;
  setSheetWorking(false);
  renderEnhCost();
  if (!$("enhSheet").open) $("enhSheet").showModal();
  if (!demo) refreshAccount().then(renderEnhCost);
}
function renderEnhCost() {
  const c = $("enhCost"), a = account, go = $("enhGoLbl");
  if (enh.busy) return;
  go.textContent = enh.pending ? "Check again" : "Enhance";
  if (enh.demo) { c.textContent = "Free on the sample. No credits used."; return; }
  if (enh.pending) { c.textContent = "Glow lost the connection while enhancing. Checking again is free and never charges twice."; return; }
  if (!a) { c.textContent = "Uses 1 AI credit."; return; }
  if (a.remaining < 1) {
    go.textContent = "Get more credits";
    c.textContent = a.plan === "pro" ? "You've used this week's AI credits. Each one comes back 7 days after you used it." : "You've used today's free AI credits. They come back at midnight UTC.";
    return;
  }
  c.innerHTML = `Uses 1 AI credit · <b>${a.remaining}</b> left ${a.plan === "pro" ? "this week" : "today"}`;
}
function setSheetWorking(on, text) {
  enh.busy = on;
  $("enhSheet").classList.toggle("working", on);
  $("enhGo").classList.toggle("busy", on); $("enhGo").disabled = on; $("enhSheetClose").disabled = on;
  if (on) { $("enhGoLbl").textContent = text || "Enhancing…"; $("enhCost").textContent = enh.demo ? "Showing a result prepared with Glow's Enhance." : "This usually takes 5 to 20 seconds."; }
  else renderEnhCost();
}
$("enhSheetClose").addEventListener("click", () => $("enhSheet").close());
$("enhSheet").addEventListener("cancel", (e) => { if (enh.busy) e.preventDefault(); });
$("enhGo").addEventListener("click", () => {
  if (!enh.demo && !enh.pending && account && account.remaining < 1) { openPaywall(); return; }
  runEnhance();
});

async function runEnhance() {
  if (enh.busy) return;
  const mine = enh.src;
  setSheetWorking(true);
  $("alertLive").textContent = "Enhancing your photo.";
  try {
    let url;
    if (enh.demo) { await sleep(1800); url = ENH_SAMPLE.result; }   // a prepared result: no request, no credit
    else url = await enhanceRequest();
    if (!url || enh.src !== mine) return;
    setSheetWorking(true, "Almost there…");
    let full;
    try { const r = await fetch(url); if (!r.ok) throw new Error(); full = await blobToData(await r.blob()); }
    catch { enh.pending = enh.pending || { done: url }; throw new Error("The result is ready but couldn't be downloaded yet. Tap Check again."); }
    enh.ai = await shrinkData(full, 2048); enh.pending = null;
    if (!enh.demo) refreshAccount();
    await prepareResult();
    setSheetWorking(false);
    if ($("enhSheet").open) $("enhSheet").close();
    showEnhResult();
    Platform.haptic("heavy");
  } catch (err) {
    setSheetWorking(false);
    if (err.limit) { say(err.message, true); if (!isPro()) openPaywall(); }
    else if (err.message) say(err.message, true);
  }
}

// Starts the AI request once, then follows it. A dropped connection never sends it again: it
// remembers the request and "Check again" only asks for its status, which is free.
async function enhanceRequest() {
  if (enh.pending && enh.pending.done) return enh.pending.done;
  if (!enh.pending) {
    const image = await uploadable(enh.src), requestId = rid();
    enh.pending = { requestId, id: null };
    try {
      const res = await call("enhance", { method: "POST", body: JSON.stringify({ image, mode: ENH_MODE, request_id: requestId }) });
      enh.pending.id = res.id || null;
      return await followEnhance(res);
    } catch (err) {
      // The server answered, so nothing started; it returns any credit it took.
      if (err.status) { enh.pending = null; throw err; }
      if (err.lost) throw err;
      throw lostConnection();
    }
  }
  return followEnhance(null);
}
function lostConnection() { const e = new Error("Glow lost the connection. Tap Check again; it won't charge you twice."); e.lost = true; return e; }
async function followEnhance(first) {
  const p = enh.pending, started = Date.now();
  let res = first, misses = 0;
  while (Date.now() - started < 240000) {
    if (res && res.status === "succeeded" && res.output) { p.done = Array.isArray(res.output) ? res.output[0] : res.output; return p.done; }
    if (res && ["failed", "canceled"].includes(res.status)) {
      enh.pending = null;
      throw new Error((res.error || "Enhance couldn't process this photo.") + (res.refunded ? " Your AI credit was returned." : ""));
    }
    if (res && res.status === "starting") $("enhGoLbl").textContent = "Warming up…";
    else if (res) $("enhGoLbl").textContent = "Enhancing…";
    await sleep(1500);
    const q = p.id ? "id=" + encodeURIComponent(p.id) : "request=" + encodeURIComponent(p.requestId);
    try { res = await call("enhance?" + q, { method: "GET" }); if (res.id) p.id = res.id; misses = 0; }
    catch (err) {
      if (err.status === 404 && !p.id) { enh.pending = null; throw new Error("Enhance never started, so no AI credit was used. Tap Enhance to try again."); }
      if (err.status && err.status !== 429 && err.status < 500) { throw lostConnection(); }
      if (++misses >= 3) throw lostConnection();
      res = null;
    }
  }
  throw lostConnection();
}

// ---------- Result ----------
// The photo at the AI result's size, and where the faces are, so each area can come from
// either picture.
async function prepareResult() {
  const [a, o] = await Promise.all([loadImg(enh.ai), loadImg(enh.src)]);
  const W = a.naturalWidth, H = a.naturalHeight, c = newCanvas(W, H), x = c.getContext("2d");
  x.imageSmoothingQuality = "high"; x.drawImage(o, 0, 0, W, H);
  enh.base = c.toDataURL("image/jpeg", 0.94); enh.size = [W, H];
  try {
    const k = Math.min(1, 1024 / Math.max(o.naturalWidth, o.naturalHeight)), s = newCanvas(Math.round(o.naturalWidth * k), Math.round(o.naturalHeight * k));
    s.getContext("2d").drawImage(o, 0, 0, s.width, s.height);
    enh.faces = await findFaces(enh.src + "|enhance", s);
  } catch { enh.faces = []; }
}
function showEnhResult() {
  enh.on = Object.fromEntries(ENH_TOGGLES.map(([k, , , d]) => [k, d]));
  enh.cache.clear(); enh.cache.set(enhKey(), enh.ai); enh.current = enh.ai; enh.saved = null;
  if (!enh.faces.length) { enh.on.face = true; enh.on.retouch = false; }
  $("enhBefore").src = enh.src; $("enhAfter").src = enh.ai;
  $("enhSampleTag").hidden = !enh.demo;
  renderToggles();
  showScreen("enhanceResult");
  fitEnhFrame();
  // The reveal: the line sweeps in from the right edge to the middle.
  const f = $("enhFrame");
  f.classList.remove("reveal"); enhSetSplit(100);
  requestAnimationFrame(() => requestAnimationFrame(() => { f.classList.add("reveal"); enhSetSplit(50); setTimeout(() => f.classList.remove("reveal"), 950); }));
  $("enhDownload").classList.remove("ready"); void $("enhDownload").offsetWidth; $("enhDownload").classList.add("ready");
  $("alertLive").textContent = "Your enhanced photo is ready.";
}
setIcon($("enhClose"), "close"); setIcon($("enhDownload"), "save"); setIcon($("enhKnob"), "compare");

// Sizes the photo to the room it has, keeping its shape, so the line and labels sit on the photo.
function fitTo(box, el, pad) {
  const st = box.getBoundingClientRect(), [W, H] = enh.size;
  const k = Math.min((st.width - pad[0]) / W, (st.height - pad[1]) / H);
  el.style.width = Math.round(W * k) + "px"; el.style.height = Math.round(H * k) + "px";
}
function fitEnhFrame() {
  if (!enh.size) return;
  if (screen === "enhanceResult") fitTo($("enhStage"), $("enhFrame"), [16, 0]);
  if (screen === "enhanceShare") fitTo(document.querySelector(".enh-share-ph"), document.querySelector(".enh-share-ph .enh-card"), [32, 16]);
}
addEventListener("resize", fitEnhFrame);

function enhSetSplit(v) {
  enh.split = Math.max(0, Math.min(100, v));
  $("enhFrame").style.setProperty("--split", enh.split + "%");
  $("enhKnob").setAttribute("aria-valuenow", String(Math.round(enh.split)));
}
(function compareDrag() {
  const f = $("enhFrame");
  let id = null;
  const at = (e) => { const r = f.getBoundingClientRect(); enhSetSplit(((e.clientX - r.left) / r.width) * 100); };
  f.addEventListener("pointerdown", (e) => { id = e.pointerId; f.setPointerCapture(id); f.classList.remove("reveal"); at(e); });
  f.addEventListener("pointermove", (e) => { if (e.pointerId === id) at(e); });
  const end = (e) => { if (e.pointerId === id) id = null; };
  f.addEventListener("pointerup", end); f.addEventListener("pointercancel", end);
  $("enhKnob").addEventListener("keydown", (e) => {
    const d = { ArrowLeft: -5, ArrowRight: 5, Home: -100, End: 100 }[e.key];
    if (d === undefined) return; e.preventDefault(); enhSetSplit(enh.split + d);
  });
})();

function renderToggles() {
  const row = $("enhToggles");
  const btns = ENH_TOGGLES.map(([k, label, ic]) => {
    const b = document.createElement("button");
    b.className = "enh-t"; b.dataset.k = k; b.setAttribute("aria-pressed", String(!!enh.on[k]));
    b.disabled = (k === "face" || k === "retouch") && !enh.faces.length;
    if (b.disabled) b.title = "No face found in this photo";
    b.innerHTML = `<span class="ic">${icon(ic)}<span class="tick">${icon("check")}</span></span><span>${label}</span>`;
    return b;
  });
  const more = document.createElement("button");
  more.className = "enh-t more"; more.id = "enhMore";
  more.innerHTML = `<span class="ic">${icon("sliders")}</span><span>More tools</span>`;
  row.replaceChildren(...btns, more);
}
$("enhToggles").addEventListener("click", (e) => {
  const b = e.target.closest(".enh-t"); if (!b || b.disabled) return;
  if (b.id === "enhMore") { editEnhanced(); return; }
  Platform.haptic();
  enh.on[b.dataset.k] = !enh.on[b.dataset.k];
  b.setAttribute("aria-pressed", String(enh.on[b.dataset.k]));
  updateComposite();
});

const enhKey = () => ENH_TOGGLES.map(([k]) => (enh.on[k] ? 1 : 0)).join("");
async function updateComposite() {
  const key = enhKey(), token = ++enh.token;
  if (enh.cache.has(key)) { showComposite(enh.cache.get(key)); return; }
  const slow = setTimeout(() => { if (token === enh.token) $("enhWorking").classList.add("on"); }, 120);
  try {
    const out = await composeEnhanced(enh.on);
    enh.cache.set(key, out);
    if (token === enh.token) showComposite(out);
  } catch (err) { if (token === enh.token) say(err.message || "Couldn't make that change.", true); }
  finally { clearTimeout(slow); if (token === enh.token) $("enhWorking").classList.remove("on"); }
}
function showComposite(data) { enh.current = data; $("enhAfter").src = data; enh.saved = null; }

// Builds the picture for a set of toggles. Background Enhancer decides the whole frame (AI or
// original); Face Enhancer then puts the chosen face back in through a soft face outline.
// Retouch, Colors and Blur are the same free on-device tools the editor uses.
async function composeEnhanced(on) {
  let out;
  if (on.face === on.bg || !enh.faces.length) out = on.bg ? enh.ai : enh.base;
  else {
    const [bgImg, faceImg] = await Promise.all([loadImg(on.bg ? enh.ai : enh.base), loadImg(on.face ? enh.ai : enh.base)]);
    const [W, H] = enh.size, c = newCanvas(W, H), x = c.getContext("2d");
    x.drawImage(bgImg, 0, 0, W, H);
    const layer = newCanvas(W, H); layer.getContext("2d").drawImage(faceImg, 0, 0, W, H);
    const mask = softMask(W, H, 1, () => {});
    const m = mask.getContext("2d"); m.fillStyle = "#fff";
    for (const f of enh.faces) {
      const P = f.map(([px, py]) => [px * W, py * H]), fw = dist(P[234], P[454]), C = mean(FACE.oval.map((i) => P[i]));
      m.filter = `blur(${Math.max(2, Math.round(fw / 12))}px)`;
      tracePoly(m, FACE.oval.map((i) => [C[0] + (P[i][0] - C[0]) * 1.1, C[1] + (P[i][1] - C[1]) * 1.12])); m.fill();
    }
    blendMasked(x, layer, mask, 1);
    out = c.toDataURL("image/jpeg", 0.94);
  }
  if (on.retouch && enh.faces.length) {
    try { out = await faceEdit(out, "fauto", 0.55); out = await faceEdit(out, "fsmooth", 0.35); } catch (e) { if (!/face/i.test(e.message)) throw e; }
  }
  if (on.colors) out = await autoLight(out);
  if (on.blur) out = await backdrop(out, "blur");
  return out;
}

$("enhClose").addEventListener("click", closeEnhResult);
async function closeEnhResult() {
  if (!enh.saved && !enh.demo) {
    const c = await ask({ title: "Leave without saving?", text: "This enhanced photo hasn't been saved yet.", actions: [
      { label: "Save it", value: "save" }, { label: "Discard", value: "discard", kind: "ghost" }, { label: "Keep looking", value: "", kind: "ghost" }] });
    if (c === "save") { enhDownload(); return; }
    if (c !== "discard") return;
  }
  showScreen("enhanceHome");
}

// ---------- Save and Share ----------
$("enhDownload").addEventListener("click", enhDownload);
async function enhDownload() {
  if (enh.busy || !enh.current) return;
  let data = enh.current;
  if (!isPro()) {
    let m; try { m = await addMark(data, false); } catch { m = null; }
    if (m) {
      if (!store.get("glowMarkSeen")) {
        const c = await ask({ title: "Free saves include a small Glow mark", text: "It sits in the bottom-right corner, like this. Glow Pro saves don't have it.",
          image: m.preview, caption: "The corner of your saved photo", actions: [{ label: "Save", value: "yes" }, { label: "Cancel", value: "", kind: "ghost" }] });
        if (!c) return;
        store.set("glowMarkSeen", "1");
      }
      data = m.data;
    }
  }
  const name = enh.demo ? `glow-ai-sample-enhanced-${Date.now()}` : `glow-enhanced-${Date.now()}`;
  try {
    const where = await Platform.savePhotos([{ data, name }]);
    enh.saved = { data, where, name };
    showEnhShare();
  } catch (err) {
    if (err && err.name === "AbortError") return;
    say(saveFailText(), true);
  }
}
const SAVED_LABEL = { photos: "Saved to Photos", downloaded: "Downloaded", shared: "Sent to share sheet" };
function showEnhShare() {
  $("enhShareImg").src = enh.saved.data;
  $("enhSavedText").textContent = SAVED_LABEL[enh.saved.where] || "Saved";
  const st = $("enhSavedState"); st.style.animation = "none"; void st.offsetWidth; st.style.animation = "";
  showScreen("enhanceShare");
  fitEnhFrame();
  $("alertLive").textContent = $("enhSavedText").textContent + ".";
}
setIcon($("enhShareBack"), "back"); setIcon($("enhShareBtn"), "share"); setIcon(document.querySelector("#enhSavedState .ok"), "check");
$("enhShareBack").addEventListener("click", () => { showScreen("enhanceResult"); fitEnhFrame(); });
$("enhShareDone").addEventListener("click", () => showScreen("enhanceHome"));
$("enhShareBtn").addEventListener("click", async () => {
  try { await Platform.savePhotos([{ data: enh.saved.data, name: enh.saved.name }], { share: true }); }
  catch (err) { if (!(err && err.name === "AbortError")) say("Couldn't open sharing. Try again.", true); }
});
$("enhAnother").addEventListener("click", enhancePick);
$("enhEdit").addEventListener("click", editEnhanced);

// Hands the enhanced photo to the editor as its first step, so Undo there goes back to the original.
async function editEnhanced() {
  if (!enh.current) return;
  if (enh.demo) { openSample(); return; }   // the sample has its own editor demo (prepared AI previews)
  if (!(await confirmReplace())) return;
  await openPhoto(enh.src, enh.original, { name: enh.name, processed: { data: enh.current, full: enh.current, label: "Enhance" } });
}

// Android back: Share goes back to Result, Result asks before leaving.
function enhanceBack() {
  if (screen === "enhanceShare") { showScreen("enhanceResult"); fitEnhFrame(); return true; }
  if (screen === "enhanceResult") { closeEnhResult(); return true; }
  return false;
}

if (screen === "enhanceHome") renderEnhanceHome();
