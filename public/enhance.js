// ---------- One-tap Enhance: Glow Studio's main flow ----------
// Pick a photo, tap Enhance, compare before and after, switch enhancers on or off, save, share.
// One AI request per photo (the server's "enhance" mode: faces restored, background sharpened,
// 2x larger; an everyday AI tool, so it draws on the daily credits). Every toggle on the Result
// screen is made on the phone from that one result, so switching costs nothing and is instant
// the second time. Loaded after app.js and uses its helpers (call, account, readPhoto, ...).

const ENH_MODE = "enhance";
const ENH_SAMPLE = { original: DEMO_DIR + "original.png", result: DEMO_DIR + "enhance.jpg", pro: DEMO_DIR + "pro.jpg" };
// Pro Edit (2026-10-31): the photo finished the way a photographer and retoucher would (white
// balance, exposure, color grade, light skin retouch, a tidier background) by an image-edit model
// (the server's "pro" mode: a premium tool, 2 credits from migration 014), then proFinish() on the phone puts each
// person's own features and the photo's fine detail back, so faces stay true.
const PRO_MODE = "pro", PRO_COST = 2;
const proEditOn = () => featureOn("enhance:pro") && featureOn("tool:pro");
const enhStyle = () => (proEditOn() && store.get("glow.enhStyle") === PRO_MODE ? PRO_MODE : ENH_MODE);
// [key, label, icon, on by default]. Face and Background Enhancer choose, per area, between the
// AI result and the original; the rest are free on-device steps on top.
const ENH_TOGGLES = [["face", "Face Enhancer", "face", true], ["bg", "Background Enhancer", "upscale", true],
  ["retouch", "Face Retouch", "fsmooth", false], ["colors", "Colors", "palette", false], ["blur", "Background Blur", "bgblur", false]];
// Face and Background Enhancer are Enhance itself; the others can be switched off from the admin
// page (features.js), which hides them and leaves them out of the picture.
const enhToggleOn = (k) => k === "face" || k === "bg" || featureOn("enhance:" + k);
const enh = {
  src: null, original: null, name: "", demo: false,   // the picked photo (working size) and its untouched file
  ai: null, base: null, faces: [],                    // the AI result, the photo at the result's size, face outlines (0–1)
  on: {}, cache: new Map(), current: null, token: 0,  // toggle state and the composites made so far
  busy: false, pending: null, saved: null, split: 50,
};

// ---------- Launch animation ----------
// Holds the launch image's frame for a moment, then plays the Aperture animation (enhance.css).
// It never holds the app back for more than about 1.1 s after that, and a tap skips it.
(function splash() {
  const s = $("splash"); if (!s) return;
  if (window.Capacitor?.getPlatform?.() === "ios") s.classList.add("ios"); // iOS fills the screen with its square launch image
  const done = () => s.remove();
  setTimeout(() => s.classList.add("go"), Math.max(0, 450 - performance.now()));
  s.addEventListener("animationend", (e) => { if (e.target === s) done(); });
  setTimeout(done, 2400); // in case animations never run (a hidden tab, for example)
  s.addEventListener("pointerdown", () => { s.classList.remove("go"); s.classList.add("out"); });
})();

// ---------- Home ----------
setIcon($("enhSettingsBtn"), "settings");
$("enhSettingsBtn").addEventListener("click", openSettings);
function renderEnhanceHome() {
  if (typeof renderBatchLink === "function") renderBatchLink();
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
  try { const r = await readPhoto(f, f.name); openEnhSheet(r.work, r.original, f.name, false); track("photo_open", { from: "enhance" }); }
  catch (err) { say(err.message, true); }
}
async function enhanceSample() {
  try {
    const r = await fetch(ENH_SAMPLE.original); if (!r.ok) throw new Error();
    const p = await readPhoto(await r.blob(), "glow-sample");
    openEnhSheet(p.work, p.original, "AI sample", true);
    track("sample_open", { from: "enhance" });
  } catch { say("Couldn't load the sample. Check your internet and try again.", true); }
}

// ---------- Pick sheet ----------
setIcon($("enhSheetClose"), "close");
function openEnhSheet(work, original, name, demo) {
  if (enh.busy) return;
  Object.assign(enh, { changes: null, strength: 100, style: ENH_MODE, src: work, original, name, demo, ai: null, full: null, base: null, faces: [], pending: null, saved: null, fromBatch: null, fromCamera: null });
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
  c.classList.remove("err");
  renderEnhStyle();
  const pro = (enh.pending ? enh.pending.mode : enhStyle()) === PRO_MODE;
  go.textContent = enh.pending ? "Check again" : pro ? "Pro Edit" : "Enhance";
  if (enh.demo) { c.textContent = pro ? "A photographer's color, light, skin and background. Free on the sample." : "Free on the sample. No credits used."; return; }
  if (enh.pending) { c.textContent = "Glow Studio lost the connection while enhancing. Checking again is free and never charges twice."; return; }
  if (pro) {
    // A premium tool: Pro uses its weekly credits; free uses the one-time premium tries and any credit packs.
    const left = !a ? null : a.plan === "pro" ? a.remaining : (a.trialLeft || 0) + (a.bonus || 0);
    if (left !== null && left < PRO_COST) {
      go.textContent = "Get more credits";
      c.textContent = a.plan === "pro" ? "You've used this week's AI credits. Each one comes back 7 days after you used it." : "Pro Edit is a premium tool. Go Pro or get a credit pack to use it.";
      return;
    }
    c.innerHTML = `A photographer's color, light, skin and background. ${PRO_COST} premium credits` + (left === null ? "." : ` · <b>${left}</b> left`);
    return;
  }
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
  if (on) { $("enhGoLbl").textContent = text || "Enhancing…"; $("enhCost").textContent = enh.demo ? "Showing a result prepared with Glow Studio's Enhance." : "This usually takes 5 to 20 seconds."; }
  else renderEnhCost();
}
function renderEnhStyle() {
  $("enhStyle").hidden = !proEditOn() && !(enh.pending && enh.pending.mode === PRO_MODE);
  const st = enh.pending ? enh.pending.mode || ENH_MODE : enhStyle();
  for (const b of $("enhStyle").querySelectorAll("button")) b.setAttribute("aria-pressed", String(b.dataset.style === st));
}
$("enhStyle").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-style]");
  if (!b || enh.busy || enh.pending) return;
  store.set("glow.enhStyle", b.dataset.style);
  track("enhance_style", { style: b.dataset.style });
  renderEnhCost();
});
$("enhSheetClose").addEventListener("click", () => $("enhSheet").close());
$("enhSheet").addEventListener("cancel", (e) => { if (enh.busy) e.preventDefault(); });
$("enhGo").addEventListener("click", () => {
  if (!enh.demo && !enh.pending && account && proLeft(account) < (enhStyle() === PRO_MODE ? PRO_COST : 1)) { if (isPro() || enhStyle() !== PRO_MODE) openPaywall(); else openPacks(); return; }
  runEnhance();
});

const proLeft = (a) => (enhStyle() !== PRO_MODE || a.plan === "pro" ? a.remaining : (a.trialLeft || 0) + (a.bonus || 0));
async function runEnhance() {
  if (enh.busy) return;
  const mine = enh.src;
  // Faces are cut from the untouched file at full size; a camera shot's file is the raw frame
  // (before its look), so its faces come from the picture itself.
  enh.cropFrom = enh.fromCamera ? null : enh.original;
  setSheetWorking(true);
  $("alertLive").textContent = "Enhancing your photo.";
  try {
    let url;
    const pro = (enh.pending ? enh.pending.mode : enhStyle()) === PRO_MODE;
    enh.style = pro ? PRO_MODE : ENH_MODE;
    if (enh.demo) { await sleep(1800); url = pro ? ENH_SAMPLE.pro : ENH_SAMPLE.result; }   // a prepared result: no request, no credit
    else if (pro) url = await proEditRequest(enh, enh.src, enhLabel, enh.fromCamera ? "camera" : "enhance");
    else url = await enhanceRequest(enh, enh.src, enhLabel, enh.fromCamera ? "camera" : "enhance");
    if (!url || enh.src !== mine) return;
    setSheetWorking(true, "Almost there…");
    let full;
    const facesUrl = enh.pending && enh.pending.faces;
    try { full = await enhResultData(url); }
    catch { enh.pending = enh.pending || { done: url }; throw new Error("The result is ready but couldn't be downloaded yet. Tap Check again."); }
    if (pro) {
      // Faces stay the person's own: the model's light and color, the photo's own features.
      setSheetWorking(true, "Keeping faces true…");
      // The detail comes from the photo with every face restored (the face sheet), not the model.
      const detail = await putFacesBack(enh.src, enh.sheet, facesUrl);
      try {
        const r = await proFinish(detail, full); full = r.data;
        track("pro_finish", { faces: r.faces, moved: r.moved, matched: r.matched, gap: r.gap, restored: detail !== enh.src });
        enh.changes = await proChanges(enh.src, full, r.faces, { restored: detail !== enh.src }).catch(() => []);
      }
      catch (e) { reportError("Pro Edit finish failed: " + (e && e.message)); }
    } else full = await putFacesBack(full, enh.sheet, facesUrl);
    // The toggles work on a 2048px copy; the untouched result is kept for saving at full size.
    enh.ai = await shrinkData(full, 2048); enh.full = full; enh.pending = null;
    if (!enh.demo) refreshAccount();
    await prepareResult();
    setSheetWorking(false);
    if ($("enhSheet").open) $("enhSheet").close();
    showEnhResult();
    Platform.haptic("heavy");
    return true;
  } catch (err) {
    setSheetWorking(false);
    if (err.limit) { say(err.message, true); if (!err.blocked && !isPro()) openPaywall(); }
    else if (err.message) {
      // With the sheet open the message goes on the sheet itself, right under the button she just
      // pressed (a toast used to land behind the sheet, so a failure looked like nothing happened).
      if ($("enhSheet").open) { const c = $("enhCost"); c.textContent = err.message; c.classList.add("err"); $("alertLive").textContent = err.message; track("error_shown", { msg: err.message.slice(0, 120), screen: "enhSheet" }); }
      else say(err.message, true);
    }
    if (!enh.demo) refreshAccount();
  }
}

// Starts the AI request once, then follows it. A dropped connection never sends it again: it
// remembers the request and "Check again" only asks for its status, which is free.
// `h` holds the request (h.pending); the single flow passes `enh`, batch Enhance one per photo.
async function enhanceRequest(h = enh, src = enh.src, onLabel = enhLabel, from = "enhance", maxSide = aiMaxSide(ENH_MODE), maxPixels = aiMaxPixels(ENH_MODE)) {
  if (h.pending && h.pending.done) return h.pending.done;
  if (!h.pending) {
    const image = await uploadable(src, maxSide, maxPixels), requestId = rid();
    // The sharper passes (first try only; a retry after a failure is the plain, smaller one):
    // Topaz for Pro and credit-pack credits (`hd`), tiles for free credits. The server decides
    // which one the charge buys and falls back to `image` if neither fits.
    const first = maxPixels === aiMaxPixels(ENH_MODE), plus = first ? await enhancePlus(src).catch(() => ({})) : {};
    h.sheet = await faceSheet(src, h.cropFrom).catch(() => null);
    h.pending = { requestId, id: null, layout: plus.layout || null };
    try {
      track("ai_start", { mode: ENH_MODE, from, hd: !!plus.hd, tiles: plus.tiles ? plus.tiles.length : 0 });
      const res = await call("enhance", { method: "POST", body: JSON.stringify({ image, mode: ENH_MODE, from: "enhance", request_id: requestId, faces: h.sheet ? h.sheet.data : undefined, hd: plus.hd, tiles: plus.tiles }) });
      h.pending.id = res.id || null;
      return await followEnhance(h, res, onLabel, from);
    } catch (err) {
      // The server answered, so nothing started; it returns any credit it took.
      if (err.status) { h.pending = null; track("ai_fail", { mode: ENH_MODE, from, status: err.status, limit: !!err.limit }); throw err; }
      // The AI failed (usually out of memory on a big photo) and the credit came back: try once more, smaller.
      if (err.oom && maxPixels > AI_RETRY.pixels) { onLabel("Trying again…"); return enhanceRequest(h, src, onLabel, from, AI_RETRY.side, AI_RETRY.pixels); }
      // The AI answered "failed": that's the real reason, not a lost connection.
      if (err.failed || err.lost) throw err;
      throw lostConnection();
    }
  }
  return followEnhance(h, null, onLabel, from);
}
// Pro Edit: one "pro" request (no face sheet, tiles or Topaz; the phone keeps the faces true
// afterwards). Like Enhance, a dropped connection never sends it twice.
async function proEditRequest(h, src, onLabel, from) {
  if (h.pending && h.pending.done) return h.pending.done;
  if (!h.pending) {
    const image = await uploadable(src, aiMaxSide(PRO_MODE), aiMaxPixels(PRO_MODE)), requestId = rid();
    h.sheet = await faceSheet(src, h.cropFrom, true).catch(() => null);
    h.pending = { requestId, id: null, mode: PRO_MODE };
    try {
      track("ai_start", { mode: PRO_MODE, from });
      const res = await call("enhance", { method: "POST", body: JSON.stringify({ image, mode: PRO_MODE, from: "enhance", platform: PLATFORM, build: APP_BUILD, request_id: requestId, faces: h.sheet ? h.sheet.data : undefined }) });
      h.pending.id = res.id || null;
      return await followEnhance(h, res, onLabel, from);
    } catch (err) {
      if (err.status) {
        h.pending = null; track("ai_fail", { mode: PRO_MODE, from, status: err.status, limit: !!err.limit });
        // The free plan's premium tries never reset, so don't say "come back tomorrow".
        if (err.limit && !isPro() && !err.blocked) err.message = "Pro Edit is a premium tool and you've used your free tries. Go Pro or get a credit pack to keep using it.";
        throw err;
      }
      if (err.failed || err.lost) throw err;
      throw lostConnection();
    }
  }
  return followEnhance(h, null, onLabel, from);
}
const enhLabel = (t) => { $("enhGoLbl").textContent = t; };
function lostConnection() { const e = new Error("Glow Studio lost the connection. Tap Check again; it won't charge you twice."); e.lost = true; return e; }
async function followEnhance(h, first, onLabel, from) {
  const p = h.pending, started = Date.now();
  let res = first, misses = 0;
  while (Date.now() - started < 240000) {
    if (res && res.status === "succeeded" && res.output) {
      track("ai_done", { mode: p.mode || ENH_MODE, from, secs: Math.round((Date.now() - started) / 1000), faces: h.sheet ? h.sheet.cells.length : 0, sheet: !!res.faces });
      p.faces = res.faces || null;
      // A tiled Enhance answers with every tile's result, in order; the phone stitches them.
      p.done = res.tiles && Array.isArray(res.output) && p.layout && res.output.length === p.layout.tiles.length
        ? { tiles: res.output, layout: p.layout } : Array.isArray(res.output) ? res.output[0] : res.output;
      if (res.hd) p.hd = true;
      track("ai_path", { from, path: res.hd ? "hd" : res.tiles ? "tiles" : "plain" });
      return p.done; }
    if (res && ["failed", "canceled"].includes(res.status)) {
      track("ai_fail", { mode: p.mode || ENH_MODE, from, refunded: res.refunded === true, oom: isOutOfMemory(res.error) });
      h.pending = null;
      const e = new Error(aiErrorText(res.error, p.mode === PRO_MODE ? "Pro Edit couldn't finish this photo. Please try again." : "Enhance couldn't finish this photo. Please try again.") + (res.refunded ? " Your AI credit was returned." : ""));
      // The live server words every failure the same way ("The AI couldn't edit this photo…"), so
      // the phone can't tell a GPU memory error from others. Any refunded failure gets one retry
      // at the smaller size: it costs nothing extra, and memory is the usual cause on big photos.
      e.failed = true; e.oom = res.refunded === true;
      throw e;
    }
    if (res && res.status === "starting") onLabel("Warming up…");
    else if (res) onLabel(p.mode === PRO_MODE ? "Editing like a pro…" : "Enhancing…");
    await sleep(1500);
    const q = p.id ? "id=" + encodeURIComponent(p.id) : "request=" + encodeURIComponent(p.requestId);
    try { res = await call("enhance?" + q, { method: "GET" }); if (res.id) p.id = res.id; misses = 0; }
    catch (err) {
      if (err.status === 404 && !p.id) { h.pending = null; throw new Error("Enhance never started, so no AI credit was used. Tap Enhance to try again."); }
      if (err.status && err.status !== 429 && err.status < 500) { throw lostConnection(); }
      if (++misses >= 3) throw lostConnection();
      res = null;
    }
  }
  throw lostConnection();
}

// ---------- Sharper Enhance: Topaz (Pro, credit packs) and tiles (free) ----------
// Chosen by the owner on 2026-10-31 after a side-by-side test on a 12 MP phone photo. The main pass
// used to see at most 0.9 MP (more runs its GPU out of memory), so detail was lost before it began.
// Now the phone sends the working copy (up to 2048px, ~3 MP): Pro gets Topaz on it as one image, and
// free cuts it into 2-4 overlapping tiles under 0.9 MP each, run together on the same credit and
// stitched back here. Results come back at twice the working size (up to ~12 MP).
const ENH_PLUS = { hdPixels: 3_200_000, hdSide: 2560, srcPixels: 3_200_000, tilePixels: 820_000, overlap: 48 };
async function enhancePlus(src) {
  const a = account, pro = isPro(), packs = !!(a && a.bonus > 0);
  const img = await loadImg(src), W0 = img.naturalWidth, H0 = img.naturalHeight, out = {};
  if (pro || packs) out.hd = await uploadable(src, ENH_PLUS.hdSide, ENH_PLUS.hdPixels);
  if (!pro && W0 * H0 > aiMaxPixels(ENH_MODE)) {
    const k = Math.min(1, Math.sqrt(ENH_PLUS.srcPixels / (W0 * H0)));
    const W = Math.floor(W0 * k), H = Math.floor(H0 * k), o = ENH_PLUS.overlap;
    // Two tiles along the long side when that keeps each under the limit, otherwise a 2x2 grid.
    const two = (Math.max(W, H) / 2 + o) * Math.min(W, H) <= ENH_PLUS.tilePixels;
    const cols = two ? (W >= H ? 2 : 1) : 2, rows = two ? (W >= H ? 1 : 2) : 2;
    const tw = Math.ceil(W / cols), th = Math.ceil(H / rows), tiles = [];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const x = Math.max(0, c * tw - (c ? o : 0)), y = Math.max(0, r * th - (r ? o : 0));
      const w = Math.min(W, (c + 1) * tw + (c < cols - 1 ? o : 0)) - x, h = Math.min(H, (r + 1) * th + (r < rows - 1 ? o : 0)) - y;
      tiles.push({ x, y, w, h });
    }
    if (tiles.every((t) => t.w * t.h <= 1_000_000)) {
      out.tiles = tiles.map((t) => {
        const cv = newCanvas(t.w, t.h), cx = cv.getContext("2d");
        cx.imageSmoothingQuality = "high";
        cx.drawImage(img, t.x / k, t.y / k, t.w / k, t.h / k, 0, 0, t.w, t.h);
        return cv.toDataURL("image/jpeg", 0.92);
      });
      out.layout = { W, H, o, tiles };
    }
  }
  return out;
}
// The result as a data URL: one picture, or the tiles stitched back with soft seams.
async function enhResultData(done) {
  if (typeof done === "string") { const r = await fetch(done); if (!r.ok) throw new Error(); return blobToData(await r.blob()); }
  const { tiles, layout: L } = done, imgs = await Promise.all(tiles.map(loadImg));
  const s = imgs[0].naturalWidth / L.tiles[0].w, W = Math.round(L.W * s), H = Math.round(L.H * s), o = L.o * s;
  const c = newCanvas(W, H), x = c.getContext("2d");
  L.tiles.forEach((t, i) => {
    const w = Math.round(t.w * s), h = Math.round(t.h * s), cv = newCanvas(w, h), cx = cv.getContext("2d");
    cx.imageSmoothingQuality = "high"; cx.drawImage(imgs[i], 0, 0, w, h);
    // Fade in across the overlap with the tile to the left and above, so no seam shows.
    cx.globalCompositeOperation = "destination-in";
    if (t.x > 0) { const g = cx.createLinearGradient(0, 0, o * 2, 0); g.addColorStop(0, "rgba(0,0,0,0)"); g.addColorStop(1, "#000"); cx.fillStyle = g; cx.fillRect(0, 0, w, h); }
    if (t.y > 0) { const g = cx.createLinearGradient(0, 0, 0, o * 2); g.addColorStop(0, "rgba(0,0,0,0)"); g.addColorStop(1, "#000"); cx.fillStyle = g; cx.fillRect(0, 0, w, h); }
    x.drawImage(cv, Math.round(t.x * s), Math.round(t.y * s));
  });
  return c.toDataURL("image/jpeg", 0.95);
}

// ---------- Every face, group photos included ----------
// The main AI pass gets a shrunk photo, so in a group photo or wide shot each face is only a few
// dozen pixels and the face model skips or smudges it. So the phone finds every face itself, cuts
// each one from the full-size file, enlarges it into one cell of a "face sheet", and sends that
// sheet with the photo: the server restores every face on it in the same request (no extra credit),
// and putFacesBack() puts each restored face back over the result through a soft oval.
const SHEET = { cell: 320, max: 12, minPx: 16, bigPx: 240, room: 2.1 };
async function enhFaces(src, img) {
  const o = img || await loadImg(src), c = newCanvas(o.naturalWidth, o.naturalHeight);
  c.getContext("2d").drawImage(o, 0, 0);
  return findFaces(src + "|enhance", c);
}
// `src` is the working copy (faces are found on it); `from` is the untouched file, if any.
// `all`: every face, big ones too, in bigger cells when there are few (Pro Edit: its model returns
// faces soft, so each one is restored from the photo here and becomes the finish's detail).
async function faceSheet(src, from, all = false) {
  const work = await loadImg(src), faces = await enhFaces(src, work);
  if (!faces.length) return null;
  let pic = work, url = null;
  if (from && from.blob && Math.max(from.w || 0, from.h || 0) > Math.max(work.naturalWidth, work.naturalHeight) * 1.2) {
    try { url = URL.createObjectURL(from.blob); pic = await loadImg(url); } catch { pic = work; }
  }
  try {
    const W = pic.naturalWidth, H = pic.naturalHeight;
    // How big each face reaches the AI in the main pass, to leave out faces it already sees well.
    const maxPx = typeof aiMaxPixels === "function" ? aiMaxPixels(ENH_MODE) : Infinity;
    const sent = Math.min(1, (typeof aiMaxSide === "function" ? aiMaxSide(ENH_MODE) : 1600) / Math.max(W, H), Math.sqrt(maxPx / (W * H)));
    const cells = faces.map((f) => { const b = faceBox(f); return { cx: b.cx, cy: b.cy, px: Math.max(b.w * W, b.h * H) }; })
      .filter((f) => f.px >= SHEET.minPx && (all || f.px * sent < SHEET.bigPx))
      .sort((a, b) => b.px - a.px).slice(0, SHEET.max);
    if (!cells.length) return null;
    const cols = Math.ceil(Math.sqrt(cells.length)), rows = Math.ceil(cells.length / cols);
    // Never bigger than the face really is (x room), so nothing is blown up before the AI sees it.
    const C = all ? Math.round(Math.max(SHEET.cell, Math.min(cells.length === 1 ? 1024 : cells.length <= 4 ? 640 : SHEET.cell, cells[0].px * SHEET.room))) : SHEET.cell;
    const sheet = newCanvas(cols * C, rows * C), x = sheet.getContext("2d");
    x.imageSmoothingQuality = "high";
    cells.forEach((f, i) => {
      const side = f.px * SHEET.room;
      f.side = side / W;   // the cell's width as a share of the photo's width
      x.drawImage(pic, f.cx * W - side / 2, f.cy * H - side / 2, side, side, (i % cols) * C, Math.floor(i / cols) * C, C, C);
    });
    return { data: sheet.toDataURL("image/jpeg", 0.92), cells, cols, w: sheet.width, cell: C };
  } finally { if (url) URL.revokeObjectURL(url); }
}
// Puts each restored face from the sheet back over the AI result. Anything going wrong leaves the
// result as it was.
async function putFacesBack(full, sheet, facesUrl) {
  if (!sheet || !facesUrl) return full;
  try {
    const [r, o] = await Promise.all([loadImg(full), loadImg(facesUrl)]);
    const W = r.naturalWidth, H = r.naturalHeight, k = o.naturalWidth / sheet.w, C = (sheet.cell || SHEET.cell) * k;
    const c = newCanvas(W, H), x = c.getContext("2d");
    x.drawImage(r, 0, 0);
    for (const [i, f] of sheet.cells.entries()) {
      const S = Math.max(2, Math.round(f.side * W));
      const t = newCanvas(S, S), tx = t.getContext("2d");
      tx.imageSmoothingQuality = "high";
      tx.drawImage(o, (i % sheet.cols) * C, Math.floor(i / sheet.cols) * C, C, C, 0, 0, S, S);
      // A soft oval over the face (the face fills about the middle half of its cell).
      tx.globalCompositeOperation = "destination-in";
      tx.save(); tx.translate(S / 2, S / 2); tx.scale(1, 1.22);
      const g = tx.createRadialGradient(0, 0, 0, 0, 0, S * 0.33);
      g.addColorStop(0, "#000"); g.addColorStop(0.72, "#000"); g.addColorStop(1, "rgba(0,0,0,0)");
      tx.fillStyle = g; tx.fillRect(-S, -S, 2 * S, 2 * S); tx.restore();
      x.drawImage(t, Math.round(f.cx * W - S / 2), Math.round(f.cy * H - S / 2));
    }
    return c.toDataURL("image/jpeg", 0.95);
  } catch { return full; }
}

// ---------- Result ----------
// The photo at the AI result's size, and where the faces are, so each area can come from
// either picture.
async function prepareResult() {
  const [a, o] = await Promise.all([loadImg(enh.ai), loadImg(enh.src)]);
  const W = a.naturalWidth, H = a.naturalHeight, c = newCanvas(W, H), x = c.getContext("2d");
  x.imageSmoothingQuality = "high"; x.drawImage(o, 0, 0, W, H);
  enh.base = c.toDataURL("image/jpeg", 0.94); enh.size = [W, H];
  try { enh.faces = await enhFaces(enh.src, o); } catch { enh.faces = []; }
}
function showEnhResult() {
  enh.on = Object.fromEntries(ENH_TOGGLES.map(([k, , , d]) => [k, d && enhToggleOn(k)]));
  enh.cache.clear(); enh.cache.set(enhKey(), enh.ai); enh.current = enh.ai; enh.saved = null;
  if (!enh.faces.length) { enh.on.face = true; enh.on.retouch = false; }
  $("enhBefore").src = enh.src; $("enhAfter").src = enh.ai;
  $("enhSampleTag").hidden = !enh.demo;
  renderProPanel();
  renderToggles();
  showScreen("enhanceResult");
  fitEnhFrame(); czReset();
  // The reveal: the line sweeps in from the right edge to the middle.
  const f = $("enhFrame");
  f.classList.remove("reveal"); enhSetSplit(100);
  requestAnimationFrame(() => requestAnimationFrame(() => { f.classList.add("reveal"); enhSetSplit(50); setTimeout(() => f.classList.remove("reveal"), 950); }));
  $("enhDownload").classList.remove("ready"); void $("enhDownload").offsetWidth; $("enhDownload").classList.add("ready");
  $("alertLive").textContent = "Your enhanced photo is ready.";
  if (!store.get("glow.compareZoomHint")) setTimeout(() => {   // once, after the reveal
    if (screen !== "enhanceResult" || $("toast").classList.contains("on")) return;
    store.set("glow.compareZoomHint", "1");
    say(matchMedia("(pointer: coarse)").matches ? "Pinch or double-tap to zoom in" : "Scroll or double-click to zoom in");
  }, 1300);
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
  if (screen === "enhanceResult") { fitTo($("enhStage"), $("enhFrame"), [16, 0]); czApply(); }
  if (screen === "enhanceShare") fitTo(document.querySelector(".enh-share-ph"), document.querySelector(".enh-share-ph .enh-card"), [32, 16]);
}
addEventListener("resize", fitEnhFrame);

function enhSetSplit(v) {
  enh.split = Math.max(0, Math.min(100, v));
  $("enhFrame").style.setProperty("--split", enh.split + "%");
  $("enhKnob").setAttribute("aria-valuenow", String(Math.round(enh.split)));
}
// Zoom for checking details. Both pictures move together under a divider that stays put, so
// any spot can be compared up close. cz.x/cz.y are the pictures' offset as a share of the frame.
const cz = { z: 1, x: 0, y: 0 };
const czMax = () => { const w = $("enhFrame").clientWidth; return enh.size && w ? Math.max(3, Math.min(8, (enh.size[0] / w) * 2)) : 3; };
function czApply() {
  const f = $("enhFrame");
  cz.z = Math.max(1, Math.min(czMax(), cz.z));
  cz.x = Math.min(0, Math.max(1 - cz.z, cz.x)); cz.y = Math.min(0, Math.max(1 - cz.z, cz.y));
  const t = `translate(${cz.x * f.clientWidth}px, ${cz.y * f.clientHeight}px) scale(${cz.z})`;
  $("enhBefore").style.transform = $("enhAfter").style.transform = t;
  const on = cz.z > 1.01; f.classList.toggle("zoomed", on); $("enhZoom").hidden = !on;
  if (on) { $("enhZoom").innerHTML = icon("fit") + cz.z.toFixed(1) + "×"; $("enhZoom").setAttribute("aria-label", `Zoomed ${cz.z.toFixed(1)} times. Fit photo`); }
}
// Zooms to z keeping the picture point under p (frame pixels) still, or bringing it to the middle.
function czTo(z, p, { centre = false, animate = false } = {}) {
  const f = $("enhFrame"), w = f.clientWidth, h = f.clientHeight, z1 = Math.max(1, Math.min(czMax(), z));
  const u = (p.x / w - cz.x) / cz.z, v = (p.y / h - cz.y) / cz.z;
  cz.x = (centre ? 0.5 : p.x / w) - u * z1; cz.y = (centre ? 0.5 : p.y / h) - v * z1; cz.z = z1;
  if (animate) { f.classList.add("zooming"); clearTimeout(czTo.t); czTo.t = setTimeout(() => f.classList.remove("zooming"), 260); }
  czApply();
}
function czReset() { cz.z = 1; cz.x = cz.y = 0; czApply(); }
const czMid = () => ({ x: $("enhFrame").clientWidth / 2, y: $("enhFrame").clientHeight / 2 });
$("enhZoom").addEventListener("click", () => { czTo(1, czMid(), { animate: true }); $("alertLive").textContent = "Photo fits the screen"; });

// Gestures on the result. Before zooming, one finger anywhere moves the divider (as it always
// has); once zoomed, one finger on the divider moves it and anywhere else pans. Two fingers
// pinch (and leave the divider where it was); double-tap zooms in on a spot, or back to fit.
(function compareGestures() {
  const f = $("enhFrame"), ptrs = new Map();
  let div = null, g = null, lastTap = null;
  const pt = (e) => { const r = f.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const splitAt = (p) => enhSetSplit((p.x / f.clientWidth) * 100);
  const onLine = (e, p) => !!e.target.closest("#enhKnob") || Math.abs(p.x - (f.clientWidth * enh.split) / 100) <= 24;
  function base() {
    const pts = [...ptrs.values()].slice(0, 2);
    if (!pts.length) { g = null; return; }
    const m = pts.length > 1 ? { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 } : pts[0];
    g = { ...(g || { t: performance.now(), x0: m.x, y0: m.y, moved: 0, n: 0 }), z: cz.z, m,
      u: (m.x / f.clientWidth - cz.x) / cz.z, v: (m.y / f.clientHeight - cz.y) / cz.z,
      d: pts.length > 1 ? Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) : 0 };
    g.n = Math.max(g.n, pts.length);
  }
  function move() {
    const pts = [...ptrs.values()].slice(0, 2); if (!g || !pts.length) return;
    const m = pts.length > 1 ? { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 } : pts[0];
    const d = pts.length > 1 ? Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) : 0;
    g.moved = Math.max(g.moved, Math.hypot(m.x - g.x0, m.y - g.y0));
    cz.z = Math.max(1, Math.min(czMax(), g.d && d ? (g.z * d) / g.d : g.z));
    cz.x = m.x / f.clientWidth - g.u * cz.z; cz.y = m.y / f.clientHeight - g.v * cz.z;
    czApply();
  }
  // A quick tap with one finger that didn't move; two of them close together zoom.
  function tapped(t) {
    if (!t || t.n > 1 || t.moved > 10 || performance.now() - t.t > 300) { lastTap = null; return; }
    const now = performance.now(), p = { x: t.x0, y: t.y0 };
    if (lastTap && now - lastTap.t < 320 && Math.hypot(p.x - lastTap.x, p.y - lastTap.y) < 30) {
      lastTap = null;
      if (cz.z > 1.05) czTo(1, p, { animate: true });
      else { czTo(Math.min(2.5, czMax()), p, { centre: true, animate: true }); enhSetSplit(50); }   // the spot moves to the middle, under the divider
      $("alertLive").textContent = cz.z > 1.01 ? `Zoomed ${cz.z.toFixed(1)} times` : "Photo fits the screen";
    } else lastTap = { ...p, t: now };
  }
  f.addEventListener("pointerdown", (e) => {
    if ((e.pointerType === "mouse" && e.button !== 0) || e.target.closest("#enhZoom")) return;
    f.setPointerCapture(e.pointerId); f.classList.remove("reveal", "zooming");
    const p = pt(e);
    if (!ptrs.size && !div && (cz.z <= 1.01 || onLine(e, p))) {
      div = { id: e.pointerId, p, split0: enh.split, t: performance.now(), x0: p.x, y0: p.y, moved: 0, n: 1 };
      if (cz.z <= 1.01) splitAt(p);
      return;
    }
    if (div) { enhSetSplit(div.split0); ptrs.set(div.id, div.p); g = { t: div.t, x0: div.x0, y0: div.y0, moved: div.moved, n: 1 }; div = null; }   // a second finger: pinch, not divider
    ptrs.set(e.pointerId, p); base();
  });
  f.addEventListener("pointermove", (e) => {
    if (div && div.id === e.pointerId) { div.p = pt(e); div.moved = Math.max(div.moved, Math.hypot(div.p.x - div.x0, div.p.y - div.y0)); splitAt(div.p); return; }
    if (!ptrs.has(e.pointerId)) return;
    ptrs.set(e.pointerId, pt(e)); move();
  });
  const end = (e) => {
    if (div && div.id === e.pointerId) { const t = div; div = null; if (e.type === "pointerup") tapped(t); else lastTap = null; return; }
    if (!ptrs.delete(e.pointerId)) return;
    if (ptrs.size) { base(); return; }
    const t = g; g = null;
    if (e.type === "pointerup") tapped(t); else lastTap = null;
  };
  f.addEventListener("pointerup", end); f.addEventListener("pointercancel", end);
  // Desktop: the wheel (or a trackpad pinch) zooms around the cursor.
  f.addEventListener("wheel", (e) => {
    e.preventDefault(); f.classList.remove("zooming");
    const d = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    czTo(cz.z * Math.exp(-d * (e.ctrlKey ? 0.01 : 0.0025)), pt(e));
  }, { passive: false });
  f.addEventListener("dblclick", (e) => e.preventDefault());
  $("enhKnob").addEventListener("keydown", (e) => {
    const d = { ArrowLeft: -5, ArrowRight: 5, Home: -100, End: 100 }[e.key];
    if (d !== undefined) { e.preventDefault(); enhSetSplit(enh.split + d); return; }
    const k = { "+": 1.6, "=": 1.6, "-": 1 / 1.6, "0": 0 }[e.key];
    if (k === undefined) return;
    e.preventDefault(); czTo(k ? cz.z * k : 1, czMid(), { animate: true });
    $("alertLive").textContent = cz.z > 1.01 ? `Zoomed ${cz.z.toFixed(1)} times` : "Photo fits the screen";
  });
})();

// ---------- Pro Edit: what changed, and strength ----------
// A few plain chips measured from the photo and the result (nothing the model claims), so it is
// clear what the 2 credits did; and one strength slider, free to move.
function renderProPanel() {
  const pro = enh.style === PRO_MODE;
  $("enhPro").hidden = !pro;
  if (!pro) return;
  enh.strength = 100; $("enhStrength").value = "100"; $("enhStrengthVal").textContent = "100%";
  $("enhChanges").replaceChildren(...(enh.changes || []).map(([t, ok]) => { const s = document.createElement("span"); s.textContent = t; if (ok) s.className = "ok"; return s; }));
}
$("enhStrength").addEventListener("input", () => {
  enh.strength = Number($("enhStrength").value); $("enhStrengthVal").textContent = enh.strength + "%";
  clearTimeout(renderProPanel.t); renderProPanel.t = setTimeout(updateComposite, 120);
});
// Measures the change between the photo and the result: light, white balance, contrast, faces.
async function proChanges(before, after, faces, info) {
  const [a, b] = await Promise.all([loadImg(before), loadImg(after)]), w = 160, h = Math.max(1, Math.round(160 * a.naturalHeight / a.naturalWidth));
  const px = (img) => { const c = newCanvas(w, h), x = c.getContext("2d", { willReadFrequently: true }); x.drawImage(img, 0, 0, w, h); return x.getImageData(0, 0, w, h).data; };
  const A = px(a), B = px(b), st = (d) => { let l = 0, l2 = 0, rb = 0; const n = d.length / 4; for (let i = 0; i < d.length; i += 4) { const y = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; l += y; l2 += y * y; rb += d[i] - d[i + 2]; } l /= n; return { l, sd: Math.sqrt(Math.max(0, l2 / n - l * l)), rb: rb / n }; };
  const s0 = st(A), s1 = st(B), out = [];
  const dl = (s1.l - s0.l) / Math.max(1, s0.l), drb = s1.rb - s0.rb, dc = (s1.sd - s0.sd) / Math.max(1, s0.sd);
  if (Math.abs(drb) > 2.5) out.push([drb > 0 ? "Warmer white balance" : "Cooler white balance"]);
  if (Math.abs(dl) > 0.03) out.push([dl > 0 ? `Brighter ${Math.round(dl * 100)}%` : `Highlights recovered`]);
  if (Math.abs(dc) > 0.04) out.push([dc > 0 ? "More depth" : "Softer contrast"]);
  out.push(["Color graded"]);
  if (info && info.restored) out.push(["Face detail restored"]);
  if (faces) out.push([faces === 1 ? "Face kept true" : `${faces} faces kept true`, true]);
  return out;
}

function renderToggles() {
  const row = $("enhToggles");
  const btns = ENH_TOGGLES.filter(([k]) => enhToggleOn(k)).map(([k, label, ic]) => {
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
  more.hidden = !featureOn("screen:editor");
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

const enhKey = () => ENH_TOGGLES.map(([k]) => (enh.on[k] ? 1 : 0)).join("") + (enh.style === PRO_MODE ? ":" + enh.strength : "");
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
  on = Object.fromEntries(Object.entries(on).map(([k, v]) => [k, v && enhToggleOn(k)]));
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
  // Pro Edit's strength: the photo as it was, up to the full Pro result (the faces stay true either way).
  if (enh.style === PRO_MODE && enh.strength < 100) {
    const [b, a] = await Promise.all([loadImg(enh.base), loadImg(out)]), [W, H] = enh.size, c = newCanvas(W, H), x = c.getContext("2d");
    x.drawImage(b, 0, 0, W, H); x.globalAlpha = enh.strength / 100; x.drawImage(a, 0, 0, W, H);
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
  if (enh.fromBatch) { showScreen("enhanceBatch"); return; }   // the batch still holds this photo
  if (!enh.saved && !enh.demo) {
    const c = await ask({ title: "Leave without saving?", text: "This enhanced photo hasn't been saved yet.", actions: [
      { label: "Save it", value: "save" }, { label: "Discard", value: "discard", kind: "ghost" }, { label: "Keep looking", value: "", kind: "ghost" }] });
    if (c === "save") { enhDownload(); return; }
    if (c !== "discard") return;
  }
  enhExit();
}
// Where Enhance goes when it's finished: the batch, the camera (ready for the next photo), or home.
function enhExit() {
  if (enh.fromBatch) showScreen("enhanceBatch");
  else if (enh.fromCamera) { if (cam.shot === enh.fromCamera.shot) { cam.shot = null; renderReview(); } showScreen("cameraScreen"); }
  else showScreen("enhanceHome");
}

// ---------- Save and Share ----------
$("enhDownload").addEventListener("click", enhDownload);
async function enhDownload() {
  if (enh.busy || !enh.current) return;
  // With only the AI enhancers on, the photo saved is the AI's own full-size result (up to twice
  // the uploaded size) rather than the 2048px working copy.
  let data = enh.current === enh.ai && enh.full ? enh.full : enh.current;
  const marked = await markForSave(data, false);
  if (!marked) return;
  data = marked.data;
  const name = enh.demo ? `glow-studio-ai-sample-enhanced-${Date.now()}` : `glow-studio-enhanced-${Date.now()}`;
  try {
    const where = await Platform.savePhotos([{ data, name }]);
    track("save", { from: "enhance", demo: !!enh.demo, marked: marked.marked, where: String(where || "") });
    enh.saved = { data, where, name };
    if (enh.fromBatch) enh.fromBatch.saved = true;
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
  $("enhAnother").hidden = !!enh.fromBatch;
  $("enhAnother").innerHTML = enh.fromCamera ? "Take another" + icon("camera") : "Enhance another" + icon("sparkle");
  const st = $("enhSavedState"); st.style.animation = "none"; void st.offsetWidth; st.style.animation = "";
  showScreen("enhanceShare");
  fitEnhFrame();
  $("alertLive").textContent = $("enhSavedText").textContent + ".";
}
setIcon($("enhShareBack"), "back"); setIcon($("enhShareBtn"), "share"); setIcon(document.querySelector("#enhSavedState .ok"), "check");
$("enhShareBack").addEventListener("click", () => { showScreen("enhanceResult"); fitEnhFrame(); });
$("enhShareDone").addEventListener("click", enhExit);
$("enhShareBtn").addEventListener("click", async () => {
  try { await Platform.savePhotos([{ data: enh.saved.data, name: enh.saved.name }], { share: true }); track("share", { from: "enhance" }); }
  catch (err) { if (!(err && err.name === "AbortError")) say("Couldn't open sharing. Try again.", true); }
});
$("enhAnother").addEventListener("click", () => (enh.fromCamera ? enhExit() : enhancePick()));
$("enhEdit").addEventListener("click", editEnhanced);

// Hands the enhanced photo to the editor as its first step, so Undo there goes back to the original.
async function editEnhanced() {
  if (!enh.current || !featureOn("screen:editor")) return;
  const from = screen === "enhanceShare" ? "enhanceShare" : "enhanceResult";
  // Back in the editor with the same photo: carry on with that edit, no "Start a new edit?" question.
  if (!enh.demo && enh.edited === enh.current && !ed.demo && ed.hist[1] && ed.hist[1].op && ed.hist[1].op.label === "Enhance" && ed.hist[1].data === enh.current) {
    showScreen("editorScreen"); renderEditor(); setEditorReturn(from); return;
  }
  if (enh.demo) {   // the sample has its own editor demo (prepared AI previews)
    await openSample();
    if (screen === "editorScreen" && ed.demo) setEditorReturn(from);
    return;
  }
  if (!(await confirmReplace())) return;
  const full = enh.current === enh.ai && enh.full ? enh.full : enh.current;
  track("enhance_to_editor", {});
  await openPhoto(enh.src, enh.original, { name: enh.name, processed: { data: enh.current, full, label: "Enhance" } });
  enh.edited = enh.current;
  setEditorReturn(from);
}
// The editor's Back: show the Enhance result (or its Share screen) just as it was left.
function enhanceReturn(where) {
  if (!enh.current) return false;
  if (where === "enhanceShare" && enh.saved) { showScreen("enhanceShare"); fitEnhFrame(); return true; }
  showScreen("enhanceResult"); fitEnhFrame();
  return true;
}

// ---------- AI Enhance in the camera ----------
// The live looks are drawn on the phone, frame by frame; the AI Enhance is the same request as
// the Enhance tab (1 AI credit) run on the photo just taken. With the camera's AI switch on it
// runs after every shutter press; with it off, the review screen offers it for one photo.
const camAIOn = () => store.get("glowCamAI") === "on" && featureOn("camera:ai");
function renderCamAI() {
  const on = camAIOn(), b = $("camAI");
  b.setAttribute("aria-pressed", String(on));
  b.setAttribute("aria-label", on ? "AI Enhance on: each photo is enhanced, 1 AI credit per photo" : "AI Enhance off");
}
renderCamAI();
$("camAI").addEventListener("click", async () => {
  Platform.haptic();
  if (!camAIOn() && !store.get("glowCamAISeen")) {
    const c = await ask({ title: "AI Enhance every photo?", text: "Right after you take a photo, Glow Studio runs the same AI Enhance as the Enhance tab: a sharper face and clearer details, with your look kept. Each photo uses 1 AI credit.",
      actions: [{ label: "Turn on", value: "on" }, { label: "Not now", value: "", kind: "ghost" }] });
    if (!c) return;
    store.set("glowCamAISeen", "1");
  }
  store.set("glowCamAI", camAIOn() ? "off" : "on");
  track("camera_ai", { on: camAIOn() });
  renderCamAI();
  say(camAIOn() ? "AI Enhance on · 1 credit per photo" : "AI Enhance off");
});
$("shotAIBtn").addEventListener("click", () => { if (cam.shot) camEnhance(cam.shot, false); });

// auto: called by the shutter with AI Enhance on, so it starts at once. Otherwise the usual
// sheet opens with the cost and the Enhance button.
async function camEnhance(s, auto) {
  if (enh.busy) return;
  const autoSave = auto && autoSaveOn();
  const plainSave = (note) => { if (autoSave && cam.shot === s) { $("alertLive").textContent = "Saving the photo without AI Enhance."; saveShot(s, true, note); return true; } };
  if (auto && account && account.remaining < 1) {
    if (!plainSave(" No AI credits left, so it wasn't enhanced.")) say("No AI credits left, so this photo wasn't enhanced.", true, { label: "Get credits", run: openPaywall });
    return;
  }
  let work;
  try { work = await shrinkData(s.processed || s.raw); } catch { say("Couldn't prepare the photo for Enhance. Try again.", true); plainSave(); return; }
  if (cam.shot !== s) return;
  openEnhSheet(work, { blob: s.rawBlob, w: s.w, h: s.h, name: "Camera photo", type: "image/jpeg" }, "Camera photo", false);
  enh.fromCamera = { shot: s };
  track("camera_enhance", { auto: !!auto });
  if (!auto) return;
  const ok = await runEnhance();
  if (!ok) { plainSave(); return; }
  if (autoSave) enhAutoSave();
}
// Auto-save for an enhanced camera photo: saved quietly at full size (with the Glow Studio mark on
// free saves), staying on the Result screen.
async function enhAutoSave() {
  let data = enh.current === enh.ai && enh.full ? enh.full : enh.current;
  const marked = !isPro();
  if (marked) { try { const m = await addMark(data, false); if (m) data = m.data; } catch {} }
  const name = `glow-studio-enhanced-${Date.now()}`;
  try {
    const where = await Platform.savePhotos([{ data, name }], { download: true });
    track("save", { from: "camera_enhance", auto: true, marked, where: String(where || "") });
    enh.saved = { data, where, name };
    const note = marked && !store.get("glowBadgeSeen") ? " Free saves include a small Glow Studio badge in the corner." : "";
    if (marked) store.set("glowBadgeSeen", "1");
    say(savedText(where, 1, note));
  } catch (err) {
    if (!(err && err.name === "AbortError")) say("Auto-save didn't finish. " + saveFailText(), true);
  }
}

// ---------- Batch Enhance (Glow Studio Pro) ----------
// Up to 10 photos at once. Each photo is its own Enhance request (1 AI credit, refunded by the
// server if it fails), three run at a time, and each tile shows its result as soon as it is
// ready. The total cost shows before anything starts. Tapping a finished photo opens the usual
// Result screen (compare, enhancers, save); Save all saves every finished photo at full size.
const BATCH_MAX = 10, BATCH_PARALLEL = 3;
// items: { key, src, original, name, thumb, status, pending, full (Blob), after, error, saved, el }
// status: ready (not started), queued, working, done, failed.
const batch = { items: [], running: false, stop: false, loading: 0, saving: false, saved: "", action: "", next: 1 };
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
setIcon($("batchClose"), "close"); setIcon($("batchAdd"), "plus");

$("enhBatchPick").addEventListener("click", () => {
  if (batch.items.length) { showScreen("enhanceBatch"); renderBatch(); return; }   // back to the batch in progress
  if (!featureOn("enhance:batch")) { renderBatchLink(); return; }
  if (!isPro()) { track("batch_locked", {}); openPaywall(); return; }
  batchPick();
});
$("batchAdd").addEventListener("click", batchPick);
function renderBatchLink() {
  const n = batch.items.length, b = $("enhBatchPick");
  b.hidden = !n && !featureOn("enhance:batch");   // a batch already started can still be finished
  b.innerHTML = icon("gallery") + (n ? `Back to your ${plural(n, "photo")}` : `Enhance up to ${BATCH_MAX} at once<span class="pro-chip">Pro</span>`);
}

async function batchPick() {
  if (batch.running || batch.loading) return;
  const room = BATCH_MAX - batch.items.length;
  if (room < 1) { say(`Glow Studio enhances up to ${BATCH_MAX} photos at a time.`); return; }
  const files = await Platform.pickPhotos("files");
  if (!files.length) return;
  if (files.length > room) say(`Glow Studio enhances up to ${BATCH_MAX} photos at a time, so ${room === BATCH_MAX ? "the first " + room : room + " more"} were added.`);
  const take = files.slice(0, room);
  if (!batch.items.length) { batch.saved = ""; track("batch_open", { photos: take.length }); }
  batch.loading = take.length;
  if (screen !== "enhanceBatch") showScreen("enhanceBatch");
  renderBatch();
  refreshAccount().then(renderBatch);
  let bad = 0;
  for (const f of take) {
    try {
      const r = await readPhoto(f, f.name);
      batch.items.push({ key: batch.next++, src: r.work, original: r.original, name: f.name, thumb: await shrinkData(r.work, 480), status: "ready", pending: null });
      batch.saved = "";
    } catch { bad++; }
    batch.loading--; renderBatch();
  }
  if (bad) say(`${plural(bad, "photo")} couldn't be read. Try JPEG or PNG.`, true);
}

function renderBatch() {
  renderBatchLink();
  const its = batch.items, n = its.length, a = account;
  const done = its.filter((i) => i.status === "done"), todo = its.filter((i) => i.status === "ready" || i.status === "failed");
  const charge = todo.filter((i) => !i.pending).length;   // a photo already charged is only checked again, for free
  const grid = $("batchGrid");
  for (const it of its) renderTile(it);
  if (grid.children.length !== n || its.some((i, k) => grid.children[k] !== i.el)) grid.replaceChildren(...its.map((i) => i.el));
  const left = a ? (a.plan === "pro" ? "this week" : "today") : "";
  $("batchTitle").textContent = batch.running ? `${done.length} of ${n} ready` : n ? plural(n, "photo") : "Enhance several";
  $("batchAdd").hidden = batch.running || n >= BATCH_MAX || !!batch.loading;
  const go = $("batchGo"), lbl = $("batchGoLbl"), cost = $("batchCost");
  go.classList.toggle("busy", batch.running || batch.saving); go.classList.remove("off");
  let action = "";
  if (batch.loading) { lbl.textContent = "Adding photos…"; cost.textContent = ""; }
  else if (batch.running) {
    lbl.textContent = "Enhancing…";
    cost.innerHTML = batch.stop ? "Stopping once the photos already started are done." : `Each photo appears as soon as it's ready. <button class="link-btn" id="batchStop">Stop</button>`;
  } else if (batch.saving) { lbl.textContent = "Saving…"; cost.textContent = ""; }
  else if (!n) { action = "add"; lbl.textContent = "Choose photos"; cost.textContent = `Up to ${BATCH_MAX} photos. Each uses 1 AI credit.`; }
  else if (done.length) {
    action = batch.saved ? "done" : "save";
    lbl.textContent = batch.saved ? "Done" : done.length === n ? "Save all" : `Save ${done.length} enhanced`;
    if (todo.length) cost.innerHTML = `${plural(todo.length, "photo")} not enhanced. <button class="link-btn" id="batchRest">Enhance ${todo.length === 1 ? "it" : "them"}${charge ? ` · ${plural(charge, "credit")}` : " · free"}</button>`;
    else cost.textContent = batch.saved ? `${SAVED_LABEL[batch.saved] || "Saved"}: ${plural(done.length, "photo")}.` : "Tap a photo to compare before and after.";
  } else {
    action = "run";
    lbl.textContent = `Enhance ${plural(todo.length, "photo")}`;
    if (!a) cost.textContent = `Uses ${plural(charge, "AI credit")}.`;
    else if (a.remaining < charge) {
      action = "short"; go.classList.add("off");
      cost.textContent = a.remaining < 1
        ? (a.plan === "pro" ? "You've used this week's AI credits. Each one comes back 7 days after you used it." : "You've used today's AI credits.")
        : `You have ${plural(a.remaining, "AI credit")} left ${left}. Remove ${plural(charge - a.remaining, "photo")} to start.`;
    } else cost.innerHTML = `Uses ${plural(charge, "AI credit")} · <b>${a.remaining}</b> left ${left}`;
  }
  batch.action = action;
  go.disabled = !action;
  const ic = action === "save" ? "save" : action === "done" ? "check" : action === "add" ? "imageplus" : "sparkle";
  if ($("batchGoIc").dataset.icon !== ic) { $("batchGoIc").dataset.icon = ic; setIcon($("batchGoIc"), ic); }
  if ($("batchStop")) $("batchStop").onclick = batchStop;
  if ($("batchRest")) $("batchRest").onclick = () => batchRun(todo);
}

function renderTile(it) {
  if (!it.el) {
    it.el = document.createElement("div"); it.el.setAttribute("role", "listitem");
    it.el.innerHTML = `<button class="bt-ph"><img alt=""><span class="enh-scan" aria-hidden="true"></span><span class="bt-state"></span></button>` +
      `<button class="bt-x" aria-label="Remove photo">${icon("close")}</button>`;
    it.el.querySelector(".bt-ph").onclick = () => batchTap(it);
    it.el.querySelector(".bt-x").onclick = () => { if (batch.running) return; batch.items.splice(batch.items.indexOf(it), 1); renderBatch(); };
  }
  const st = it.status, img = it.el.querySelector("img"), src = st === "done" ? it.after : it.thumb;
  if (img.getAttribute("src") !== src) img.src = src;
  it.el.className = "bt " + st;
  it.el.querySelector(".bt-x").hidden = batch.running || st === "done" || st === "working" || st === "queued";
  const label = { ready: "", queued: "Waiting", working: it.label || "Enhancing…", done: "", failed: it.pending ? "Check again" : "Try again" }[st];
  it.el.querySelector(".bt-state").innerHTML = st === "done" ? icon("check") : st === "failed" ? icon("revert") + `<span>${label}</span>` : label ? `<span>${label}</span>` : "";
  it.el.querySelector(".bt-ph").setAttribute("aria-label", `${it.name}: ${st === "done" ? "enhanced, open to compare" : st === "failed" ? (it.error || "couldn't be enhanced") + ". Tap to try again" : label || "not enhanced yet"}`);
}

function batchTap(it) {
  if (it.status === "done") openBatchResult(it);
  else if (it.status === "failed" && !batch.running) {
    if (!it.pending && account && account.remaining < 1) { openCredits(); return; }
    batchRun([it]);
  } else if (it.status === "failed") say(it.error || "This photo couldn't be enhanced.", true);
}

$("batchGo").addEventListener("click", () => {
  const act = batch.action;
  if (act === "add") batchPick();
  else if (act === "run") batchRun(batch.items.filter((i) => i.status === "ready" || i.status === "failed"));
  else if (act === "short") say($("batchCost").textContent, true);
  else if (act === "save") batchSave();
  else if (act === "done") { batch.items = []; showScreen("enhanceHome"); }
});

async function batchRun(list) {
  if (batch.running || !list.length) return;
  if (!isPro()) { track("batch_locked", {}); openPaywall(); return; }
  Object.assign(batch, { running: true, stop: false, saved: "" });
  const t0 = Date.now();
  for (const it of list) { it.status = "queued"; it.error = ""; it.label = ""; }
  track("batch_start", { photos: list.length, charged: list.filter((i) => !i.pending).length });
  $("alertLive").textContent = `Enhancing ${plural(list.length, "photo")}.`;
  renderBatch();
  let limit = null;
  const worker = async () => {
    for (;;) {
      if (batch.stop) return;
      const it = batch.items.find((i) => i.status === "queued");
      if (!it) return;
      it.status = "working"; renderBatch();
      try { await batchOne(it); it.status = "done"; }
      catch (err) {
        // Out of credits: this photo wasn't charged, so it and the rest just wait.
        if (err.limit) { limit = limit || err; batch.stop = true; it.status = "ready"; }
        else { it.status = "failed"; it.error = err.message; }
      }
      renderBatch();
    }
  };
  await Promise.all(Array.from({ length: Math.min(BATCH_PARALLEL, list.length) }, worker));
  for (const it of batch.items) if (it.status === "queued") it.status = "ready";
  const ok = list.filter((i) => i.status === "done").length, failed = list.filter((i) => i.status === "failed").length;
  track("batch_done", { photos: list.length, done: ok, failed, stopped: batch.stop && !limit, limit: !!limit, secs: Math.round((Date.now() - t0) / 1000) });
  batch.running = false; batch.stop = false;
  renderBatch();
  refreshAccount().then(renderBatch);
  if (limit) say(limit.message, true);
  else if (failed) say(`${plural(failed, "photo")} couldn't be enhanced. Tap ${failed === 1 ? "it" : "one"} to try again.`, true);
  if (ok) { Platform.haptic("heavy"); $("alertLive").textContent = `${plural(ok, "enhanced photo")} ready.`; }
}
// One photo: the same request as the single flow, kept on the photo so a lost connection is
// checked again for free.
async function batchOne(it) {
  it.cropFrom = it.original;
  const url = await enhanceRequest(it, it.src, (t) => { if (it.label !== t) { it.label = t; renderTile(it); } }, "batch");
  const facesUrl = it.pending && it.pending.faces;
  let blob;
  try { blob = await (await fetch(await enhResultData(url))).blob(); }
  catch { throw new Error("The result is ready but couldn't be downloaded yet."); }
  if (facesUrl && it.sheet) { try { blob = await (await fetch(await putFacesBack(await blobToData(blob), it.sheet, facesUrl))).blob(); } catch { /* keep the main result */ } }
  it.full = blob; it.pending = null;
  it.after = await shrinkData(await blobToData(blob), 480);
}
function batchStop() { if (!batch.running) return; batch.stop = true; renderBatch(); }

async function openBatchResult(it) {
  if (enh.busy || batch.opening) return;
  batch.opening = true;
  try {
    const full = await blobToData(it.full);
    Object.assign(enh, { style: ENH_MODE, changes: null, strength: 100, src: it.src, original: it.original, name: it.name, demo: false, full, ai: await shrinkData(full, 2048), base: null, faces: [], pending: null, saved: null, fromBatch: it, fromCamera: null });
    enh.cache.clear();
    await prepareResult();
    showEnhResult();
  } catch { say("Couldn't open that photo. Try again.", true); }
  finally { batch.opening = false; }
}

// Saves every finished photo at the AI's full size, in one go.
async function batchSave() {
  const done = batch.items.filter((i) => i.status === "done");
  if (!done.length || batch.saving) return;
  batch.saving = true; renderBatch();
  try {
    const stamp = Date.now(), pro = isPro(), files = [];
    for (const [k, it] of done.entries()) {
      const name = `glow-studio-enhanced-${stamp}-${k + 1}`;
      if (pro) { files.push({ blob: it.full, name }); continue; }
      let m; try { m = await addMark(await blobToData(it.full), false); } catch { m = null; }   // Pro lapsed meanwhile: free saves carry the badge
      files.push(m ? { data: m.data, name } : { blob: it.full, name });
    }
    const where = await Platform.savePhotos(files);
    track("batch_save", { photos: files.length, marked: !pro, where: String(where || "") });
    batch.saved = where || "downloaded";
    for (const it of done) it.saved = true;
    $("alertLive").textContent = `${SAVED_LABEL[batch.saved] || "Saved"}: ${plural(files.length, "photo")}.`;
    Platform.haptic("heavy");
  } catch (err) {
    if (!(err && err.name === "AbortError")) say(saveFailText(), true);
  } finally { batch.saving = false; renderBatch(); }
}

$("batchClose").addEventListener("click", closeBatch);
async function closeBatch() {
  if (batch.running) {
    const c = await ask({ title: "Stop enhancing?", text: "Photos already being enhanced will finish. The rest won't start, so they won't use credits.",
      actions: [{ label: "Stop", value: "stop" }, { label: "Keep going", value: "", kind: "ghost" }] });
    if (c) batchStop();
    return;
  }
  const unsaved = batch.items.filter((i) => i.status === "done" && !i.saved).length;
  if (unsaved && !batch.saved) {
    const c = await ask({ title: "Leave without saving?", text: `${plural(unsaved, "enhanced photo")} ${unsaved === 1 ? "hasn't" : "haven't"} been saved yet.`, actions: [
      { label: "Save all", value: "save" }, { label: "Discard", value: "discard", kind: "ghost" }, { label: "Keep looking", value: "", kind: "ghost" }] });
    if (c === "save") { batchSave(); return; }
    if (c !== "discard") return;
  }
  batch.items = []; batch.saved = "";
  showScreen("enhanceHome");
}

// Back: Share goes back to Result, Result asks before leaving.
function enhanceBack() {
  if (screen === "enhanceBatch") { closeBatch(); return true; }
  if (screen === "enhanceShare") { showScreen("enhanceResult"); fitEnhFrame(); return true; }
  if (screen === "enhanceResult") { closeEnhResult(); return true; }
  return false;
}

if (screen === "enhanceHome") renderEnhanceHome();
