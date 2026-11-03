// Glow Studio: one Share sheet for every finished photo (Editor, Enhance, Studio, Camera).
// Classic script after enhance.js and studio.js: it uses their globals (loadImg, newCanvas, addMark,
// markFonts, makeRevealVideo, VIDEO_TYPE, Platform, track, say...).
//
// How the best photo apps do it (Remini, Facetune, Meitu, PS Express, VSCO, Lightroom): one Share
// button that goes straight to the phone's own share sheet with the photo itself, a separate Save,
// and the before/after as an option to pick, never a forced card. So the sheet shows:
//   the picture that will be sent | Photo · Before & after · Video | Save  [ Share ]
// Share sends exactly what the preview shows, with one tap. The Glow Studio badge follows the usual
// rule (free saves always, Pro unless switched off), on every format.

const ShareSheet = (() => {
  let st = null, seq = 0;
  const F = { photo: "Photo", pair: "Before & after", video: "Video" };

  // Two pictures are a before/after pair only when they have the same shape (a crop or a reframed
  // AI result can't be shown side by side with the photo it came from).
  const sameShape = (a, b) => Math.abs(a.naturalWidth / a.naturalHeight - b.naturalWidth / b.naturalHeight) < 0.02;

  // Before & after as one still: side by side for portrait and square photos (a 2-up that fits a
  // feed post or a Story), one above the other for wide photos. A thin light seam, quiet labels.
  async function makePair(beforeUrl, afterUrl, mark) {
    const [b, a] = await Promise.all([loadImg(beforeUrl), loadImg(afterUrl)]);
    const side = a.naturalWidth / a.naturalHeight < 1.2;
    const cw = side ? Math.min(1080, a.naturalWidth) : Math.min(1620, a.naturalWidth), ch = Math.round(cw * a.naturalHeight / a.naturalWidth);
    const seam = Math.max(4, Math.round(cw * 0.006));
    const W = side ? cw * 2 + seam : cw, H = side ? ch : ch * 2 + seam;
    const c = newCanvas(W, H), x = c.getContext("2d");
    x.imageSmoothingQuality = "high";
    x.fillStyle = "#f7f3ea"; x.fillRect(0, 0, W, H);
    x.drawImage(b, 0, 0, cw, ch);
    x.drawImage(a, side ? cw + seam : 0, side ? 0 : ch + seam, cw, ch);
    await markFonts();
    const u = Math.min(cw, ch) / 720;   // labels readable once the pair is shrunk into a feed
    const label = (t, X, Y) => {
      x.font = `700 ${Math.round(34 * u)}px Figtree, system-ui, sans-serif`;
      const w = x.measureText(t).width + 40 * u, h = 58 * u;
      x.fillStyle = "rgba(13, 13, 16, 0.62)"; pill(x, X, Y, w, h); x.fill();
      x.fillStyle = "#fff"; x.textBaseline = "middle"; x.fillText(t, X + 20 * u, Y + h / 2 + 1);
    };
    label("Before", 36 * u, 36 * u);
    label("After", (side ? cw + seam : 0) + 36 * u, (side ? 0 : ch + seam) + 36 * u);
    const data = c.toDataURL("image/jpeg", 0.93);
    return mark ? (await addMark(data, false)).data : data;
  }

  const el = (id) => document.getElementById(id);
  const dlg = () => el("shareSheet");

  // Opens the sheet for one finished photo.
  //   photo:  the picture as it is saved (with the badge when the rule says so)
  //   clean:  the same picture without the badge (null when it has none)
  //   before: the photo it was made from (optional; offers Before & after and Video)
  //   name:   file name without extension; date: the original's date for the saved file
  //   saved:  where it was already saved ("photos", "downloaded"...), so Save shows Saved
  //   save:   optional function that saves the photo the caller's way; returns where it went
  //   from:   "editor", "enhance", "studio", "camera" (for the numbers)
  async function open(o) {
    const my = ++seq;
    st = { ...o, f: "photo", made: {}, saved: o.saved ? { photo: o.saved } : {}, formats: ["photo"], ready: {} };
    prepare("photo");
    track("share_open", { from: o.from || "" });
    el("shImg").src = o.photo; el("shImg").hidden = false; el("shVideo").hidden = true; el("shVideo").removeAttribute("src"); el("shCanvas").hidden = true;
    renderFormats(); render();
    if (!dlg().open) dlg().showModal();
    // The pair and the video are offered once the before photo is known to match.
    if (o.before && featureOn("share:pair")) {
      try {
        const [b, a] = await Promise.all([loadImg(o.before), loadImg(o.clean || o.photo)]);
        if (my !== seq || !sameShape(a, b)) return;
        st.formats = ["photo", "pair"];
        if (VIDEO_TYPE && featureOn("share:video")) st.formats.push("video");
        renderFormats();
      } catch {}
    }
  }

  function renderFormats() {
    const box = el("shFormats");
    box.hidden = st.formats.length < 2;
    box.replaceChildren(...st.formats.map((f) => {
      const b = document.createElement("button"); b.type = "button"; b.dataset.f = f; b.textContent = F[f];
      b.setAttribute("aria-pressed", String(st.f === f));
      b.addEventListener("click", () => pick(f));
      return b;
    }));
  }

  function render() {
    const f = st.f, ready = f === "photo" || !!st.made[f], making = st.making === f;
    el("shFormats").querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.f === f)));
    el("shBusy").hidden = !making;
    el("shBusyText").textContent = f === "video" ? "Making your 5-second video…" : "Making your before & after…";
    const where = st.saved[f];
    el("shSave").disabled = !ready || !!where || !!st.saving;
    el("shSave").innerHTML = where ? icon("check") + "<span>Saved</span>" : st.saving ? "<span>Saving…</span>" : icon("save") + "<span>Save</span>";
    el("shShare").disabled = !ready || !!st.sharing;
    el("shNote").textContent = f === "pair" ? "Before and after, side by side." : f === "video" ? "A 5-second reveal for Reels, TikTok and Stories." : "";
    el("shNote").hidden = !el("shNote").textContent;
  }

  async function pick(f) {
    if (!st || st.f === f) return;
    st.f = f; render();
    track("share_format", { format: f, from: st.from || "" });
    if (f === "photo") { showImg(st.photo); return; }
    if (st.made[f]) { f === "pair" ? showImg(st.made.pair) : showVideo(st.made.video); return; }
    if (st.making) return;   // one at a time; the other is picked up when this one finishes
    await make(f);
  }

  async function make(f) {
    const my = seq, mark = !!st.clean, after = st.clean || st.photo;
    st.making = f; render();
    try {
      if (f === "pair") {
        el("shImg").style.opacity = "0.35";
        const data = await makePair(st.before, after, mark);
        if (my !== seq) return;
        st.made.pair = data; prepare("pair");
      } else {
        // The video is recorded on the sheet's own canvas, so the preview is the recording itself.
        const c = el("shCanvas"); el("shImg").hidden = true; el("shVideo").hidden = true; c.hidden = false;
        const blob = await makeRevealVideo(st.before, after, mark, c);
        if (my !== seq) return;
        st.made.video = blob; prepare("video"); Platform.haptic("success");
      }
    } catch (err) {
      if (my === seq) { say(f === "video" ? "Couldn't make the video. Try again." : "Couldn't make the before & after. Try again.", true); st.f = "photo"; showImg(st.photo); }
    } finally {
      if (my === seq) {
        st.making = null; el("shImg").style.opacity = "";
        if (st.f === "pair" && st.made.pair) showImg(st.made.pair);
        else if (st.f === "video" && st.made.video) showVideo(st.made.video);
        else if (st.f !== "photo" && !st.made[st.f]) { render(); return make(st.f); }
        render();
      }
    }
  }

  function showImg(src) { el("shCanvas").hidden = true; el("shVideo").hidden = true; el("shVideo").pause(); el("shImg").hidden = false; el("shImg").src = src; }
  function showVideo(blob) {
    const v = el("shVideo");
    if (v.dataset.url) URL.revokeObjectURL(v.dataset.url);
    v.dataset.url = URL.createObjectURL(blob); v.src = v.dataset.url;
    el("shImg").hidden = true; el("shCanvas").hidden = true; v.hidden = false; v.play().catch(() => {});
  }

  const stamp = () => Date.now();
  // The files for the chosen format, ready before the tap so the share sheet opens on the tap itself
  // (iPhone only opens it straight from a tap).
  async function files(f) {
    if (f === "video") return [Platform.videoFile(st.made.video, `glow-studio-before-after-${stamp()}`)];
    if (f === "pair") return [await Platform.photoFile({ data: st.made.pair, name: `glow-studio-before-after-${stamp()}` })];
    return [await Platform.photoFile({ data: st.photo, date: st.date, name: st.name || `glow-studio-${stamp()}` })];
  }

  function prepare(f) { const p = files(f); p.catch(() => {}); st.ready[f] = p; }

  async function share() {
    if (!st || st.sharing) return;
    const f = st.f; st.sharing = true; render();
    try {
      const where = await Platform.shareFiles(await (st.ready[f] || files(f)));
      track("share", { from: st.from || "", format: f, where });
      if (where === "copied") say("Copied. Paste it into any app or message.");
      else if (where === "downloaded") say(f === "video" ? "Video downloaded. Post it from your Downloads." : savedText("downloaded", 1));
    } catch (err) {
      if (!(err && (err.name === "AbortError" || err.name === "NotAllowedError"))) say("Couldn't open sharing. Try again.", true);
      else if (err.name === "NotAllowedError") say("Tap Share again to open sharing.");
    } finally { if (st) { st.sharing = false; render(); } }
  }

  async function save() {
    if (!st || st.saving) return;
    const f = st.f; st.saving = true; render();
    try {
      let where;
      if (f === "video") where = await Platform.saveVideo(st.made.video, `glow-studio-before-after-${stamp()}`);
      else if (f === "pair") where = await Platform.savePhotos([{ data: st.made.pair, name: `glow-studio-before-after-${stamp()}` }]);
      else if (st.save) where = await st.save();
      else where = await Platform.savePhotos([{ data: st.photo, clean: st.clean, date: st.date, name: st.name || `glow-studio-${stamp()}` }]);
      if (!where) return;
      st.saved[f] = where;
      track("save", { from: st.from || "", via: "share", format: f, where: String(where) });
      say(f === "video" ? (where === "photos" ? "Video saved to your Glow Studio album." : where === "downloaded" ? "Video downloaded." : savedText(where, 1)) : savedText(where, 1));
    } catch (err) {
      if (!(err && err.name === "AbortError")) say(saveFailText(), true);
    } finally { if (st) { st.saving = false; render(); } }
  }

  function close() {
    seq++;
    const v = el("shVideo"); v.pause(); if (v.dataset.url) { URL.revokeObjectURL(v.dataset.url); delete v.dataset.url; } v.removeAttribute("src");
    if (st && st.onClose) try { st.onClose(st.saved); } catch {}
    st = null;
  }

  el("shShare").innerHTML = icon("share") + "<span>Share</span>";
  el("shShare").addEventListener("click", share);
  el("shSave").addEventListener("click", save);
  dlg().addEventListener("close", close);
  // A tap on the dimmed backdrop closes, like the other sheets.
  dlg().addEventListener("click", (e) => { if (e.target === dlg()) dlg().close(); });

  return { open, isOpen: () => !!st, makePair };
})();
