// Device features behind one small interface: camera, photo picking, saving and
// haptics. The web versions live here; the phone app can swap in native ones
// (Capacitor plugins) without touching the screens in app.js.
const native = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
const plugins = (window.Capacitor && window.Capacitor.Plugins) || {};
const store = {
  get(k) { try { return localStorage.getItem(k) || ""; } catch { return ""; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
};

// Date taken: canvas re-encodes drop EXIF, so enhanced photos sorted as "today" in the gallery.
// photoDate() reads DateTimeOriginal ("YYYY:MM:DD HH:MM:SS") from a JPEG; withPhotoDate() writes
// just that tag into a JPEG (no location or other metadata is copied).
async function photoDate(blob) {
  try {
    if (!blob || !/jpe?g/i.test(blob.type || "image/jpeg")) return "";
    const b = new DataView(await blob.slice(0, 131072).arrayBuffer());
    if (b.getUint16(0) !== 0xffd8) return "";
    let o = 2;
    while (o + 4 < b.byteLength) {
      const m = b.getUint16(o), len = b.getUint16(o + 2);
      if (m === 0xffe1 && b.getUint32(o + 4) === 0x45786966) {
        const t = o + 10, le = b.getUint16(t) === 0x4949;
        const u16 = (p) => b.getUint16(t + p, le), u32 = (p) => b.getUint32(t + p, le);
        const tag = (ifd, want) => { const n = u16(ifd); for (let i = 0; i < n; i++) { const e = ifd + 2 + i * 12; if (u16(e) === want) return e; } return -1; };
        const ascii = (e) => { if (e < 0) return ""; const at = t + u32(e + 8); let str = ""; for (let i = 0; i < 19; i++) str += String.fromCharCode(b.getUint8(at + i)); return str; };
        const ifd0 = u32(4), ex = tag(ifd0, 0x8769);
        const d = (ex >= 0 && ascii(tag(u32(ex + 8), 0x9003))) || ascii(tag(ifd0, 0x0132));
        return /^\d{4}:\d\d:\d\d \d\d:\d\d:\d\d$/.test(d) ? d : "";
      }
      if ((m & 0xff00) !== 0xff00 || m === 0xffda) break;
      o += 2 + len;
    }
  } catch {}
  return "";
}
async function withPhotoDate(blob, date) {
  try {
    if (!date || !/jpe?g/i.test(blob.type)) return blob;
    const src = new Uint8Array(await blob.arrayBuffer());
    if (src[0] !== 0xff || src[1] !== 0xd8) return blob;
    const tiff = new Uint8Array(64), v = new DataView(tiff.buffer);
    v.setUint16(0, 0x4d4d); v.setUint16(2, 42); v.setUint32(4, 8);
    v.setUint16(8, 1); v.setUint16(10, 0x8769); v.setUint16(12, 4); v.setUint32(14, 1); v.setUint32(18, 26); v.setUint32(22, 0);
    v.setUint16(26, 1); v.setUint16(28, 0x9003); v.setUint16(30, 2); v.setUint32(32, 20); v.setUint32(36, 44); v.setUint32(40, 0);
    for (let i = 0; i < 19; i++) tiff[44 + i] = date.charCodeAt(i);
    const app1 = new Uint8Array(4 + 6 + 64), a = new DataView(app1.buffer);
    a.setUint16(0, 0xffe1); a.setUint16(2, app1.length - 2); app1.set([0x45, 0x78, 0x69, 0x66, 0, 0], 4); app1.set(tiff, 10);
    // After the JFIF header when there is one, as cameras write it.
    const at = src[2] === 0xff && src[3] === 0xe0 ? 4 + ((src[4] << 8) | src[5]) : 2;
    return new Blob([src.subarray(0, at), app1, src.subarray(at)], { type: blob.type });
  } catch { return blob; }
}

// Settings > Save as / Photo size, for edited and enhanced photos (never the untouched originals).
// A transparent PNG stays PNG whatever the format, so a cutout never gets a black background.
async function asSaved(blob) {
  const fmt = store.get("glowSaveFormat") || "jpg", size = store.get("glowSaveSize") || "full";
  const png = blob.type === "image/png";
  if (fmt === "jpg" && size === "full") return blob;
  try {
    const bm = await createImageBitmap(blob), max = size === "full" ? Infinity : Number(size);
    const k = Math.min(1, max / Math.max(bm.width, bm.height));
    const wantPng = fmt === "png" || png;
    if (k === 1 && (wantPng === png) && fmt !== "jpg85") { if (bm.close) bm.close(); return blob; }
    const c = document.createElement("canvas"); c.width = Math.round(bm.width * k); c.height = Math.round(bm.height * k);
    const x = c.getContext("2d"); x.imageSmoothingQuality = "high"; x.drawImage(bm, 0, 0, c.width, c.height); if (bm.close) bm.close();
    const out = await new Promise((ok) => c.toBlob(ok, wantPng ? "image/png" : "image/jpeg", fmt === "jpg85" ? 0.85 : 0.95));
    return out || blob;
  } catch { return blob; }
}

const Platform = {
  // Opens the system photo picker. Resolves with the File, or null if the user backs out.
  pickPhoto(inputId = "file") {
    return this.pickPhotos(inputId).then((fs) => fs[0] || null);
  },
  // The same, for an input that allows several photos. Resolves with an array (empty on cancel).
  pickPhotos(inputId = "files") {
    return new Promise((done) => {
      const input = document.getElementById(inputId);
      let settled = false;
      const finish = (f) => {
        if (settled) return; settled = true;
        window.removeEventListener("focus", onFocus); input.onchange = null; input.oncancel = null; input.value = "";
        done(f);
      };
      // Browsers that support it say "cancel" when the picker closes without a photo. Older ones only
      // give focus back; then wait a few seconds, because on a phone a photo coming from the cloud
      // (Google Photos, iCloud) can arrive well after the picker has closed.
      const onFocus = () => setTimeout(() => { if (!input.files.length) finish([]); }, 4000);
      input.onchange = async () => {
        const picked = [...input.files];
        // HEIC photos become JPEGs here in the phone app, so every screen can open them.
        finish(await Promise.all(picked.map(async (f) => {
          if (!this.isHeic(f, f.name)) return f;
          const j = await this.heicToJpeg(f).catch(() => null);
          return j ? new File([j], f.name.replace(/\.(heic|heif)$/i, "") + ".jpg", { type: "image/jpeg" }) : f;
        })));
      };
      input.oncancel = () => finish([]);
      window.addEventListener("focus", onFocus);
      input.click();
    });
  },

  // HEIC/HEIF photos (Samsung's "High efficiency pictures", photos from iPhones) don't open in
  // Android's WebView or Chrome. The phone app turns them into a JPEG with Android's own decoder
  // (the GlowImage plugin), the right way up.
  isHeic: (blob, name) => /hei[cf]/i.test((blob && blob.type) || "") || /\.(heic|heif)$/i.test(name || ""),
  async heicToJpeg(blob) {
    if (!native || !plugins.GlowImage) return null;
    const data = await new Promise((ok, fail) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = () => fail(r.error); r.readAsDataURL(blob); });
    const res = await plugins.GlowImage.toJpeg({ data });
    return (await fetch(res.data)).blob();
  },

  // Saves photos ({ blob } or { data: dataURL }, plus a name without extension). Resolves only
  // once the platform has finished, and says where they went: "photos" (the phone app saved them
  // to the Glow Studio album), "shared" (the share sheet closed; we can't tell what the user picked) or
  // "downloaded" (the browser started a download). Throws AbortError if the user cancels.
  // { download: true } skips the share sheet, for saves the user didn't tap for (auto-save);
  // { share: true } asks for the share sheet on computers too (the editor's Share button).
  async savePhotos(items, opts = {}) {
    const files = await Promise.all(items.map(async (it) => {
      let blob = it.blob || (await (await fetch(it.data)).blob());
      if (!it.raw && !/original/.test(it.name)) blob = await asSaved(blob);
      if (it.date) blob = await withPhotoDate(blob, it.date);
      const ext = (blob.type.split("/")[1] || "jpg").replace("jpeg", "jpg");
      return new File([blob], `${it.name}.${ext}`, { type: blob.type || "image/jpeg" });
    }));
    // The home screens' "Recent" row (kept on this device only), once the save went through.
    const where = await this.savePhotoFiles(files, opts);
    // Recents keep the unmarked picture (item.clean) when there is one, so re-editing a free save
    // doesn't stack a second badge, and a later Pro save of it comes out clean.
    if (!opts.share) (async () => {
      const rec = await Promise.all(items.map(async (it, i) => {
        if (!it.clean) return files[i];
        const b = await (await fetch(it.clean)).blob();
        return new File([b], files[i].name, { type: b.type || files[i].type });
      }));
      await Recents.add(rec);
    })().catch(() => {});
    return where;
  },
  async savePhotoFiles(files, opts) {
    if (native && plugins.Media) {
      // If the photo library refuses (permission turned off in Android settings), fall back to the
      // share sheet below so the photo isn't lost.
      try {
        for (const f of files) await saveToAlbum(await fileData(f), f.name.replace(/\.\w+$/, ""));
        return "photos";
      } catch (err) { console.warn("Saving to the photo library failed", err); if (!(plugins.Filesystem && plugins.Share)) throw err; opts = { ...opts, download: false }; }
    }
    if (native && plugins.Filesystem && plugins.Share && !opts.download) {
      const uris = [];
      for (const f of files) uris.push((await plugins.Filesystem.writeFile({ path: f.name, data: (await fileData(f)).split(",")[1], directory: "CACHE" })).uri);
      await plugins.Share.share({ title: "Glow Studio", files: uris });
      return "shared";
    }
    // iPhone: the share sheet has "Save Image". Android's share sheet has no save option (only
    // apps such as Drive), so Android and computers get a normal download, which lands in
    // Downloads and shows up in the phone's Gallery and Google Photos.
    const touch = matchMedia("(pointer: coarse)").matches, android = /Android/i.test(navigator.userAgent);
    if (!opts.download && ((touch && !android) || opts.share) && navigator.canShare && navigator.canShare({ files })) {
      await navigator.share({ files, title: "Glow Studio" });
      return "shared";
    }
    for (const f of files) {
      const a = document.createElement("a"); a.href = URL.createObjectURL(f); a.download = f.name;
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 60000);
    }
    return "downloaded";
  },

  // A short video (the before/after reveal): the share sheet where there is one, otherwise a download.
  async shareVideo(blob, name) {
    const ext = /mp4/.test(blob.type) ? "mp4" : "webm", f = new File([blob], `${name}.${ext}`, { type: blob.type });
    if (native && plugins.Filesystem && plugins.Share) {
      const uri = (await plugins.Filesystem.writeFile({ path: f.name, data: (await fileData(f)).split(",")[1], directory: "CACHE" })).uri;
      await plugins.Share.share({ title: "Glow Studio", files: [uri] });
      return "shared";
    }
    if (navigator.canShare && navigator.canShare({ files: [f] })) { await navigator.share({ files: [f], title: "Glow Studio" }); return "shared"; }
    const a = document.createElement("a"); a.href = URL.createObjectURL(f); a.download = f.name;
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 60000);
    return "downloaded";
  },

  haptic(kind = "light") {
    try {
      // "success": a two-beat buzz for the big moments (Enhance done, joining Pro).
      if (native && plugins.Haptics) (kind === "success" ? plugins.Haptics.notification({ type: "SUCCESS" }) : plugins.Haptics.impact({ style: kind === "heavy" ? "HEAVY" : "LIGHT" })).catch(() => {});
      else if (navigator.vibrate && matchMedia("(pointer: coarse)").matches) navigator.vibrate(kind === "success" ? [12, 70, 22] : kind === "heavy" ? 18 : 8);
    } catch {}
  },

  camera: {
    supported: () => !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia),
    // "granted", "denied", "prompt", or "unknown" where the browser can't say.
    async permission() {
      try { return (await navigator.permissions.query({ name: "camera" })).state; } catch { return "unknown"; }
    },
    // The chosen side is asked for exactly: as a mere preference, some Android phones picked the
    // back camera for a selfie because it suited the size better. Phones with one camera get it.
    async open(facing) {
      const ask = (facingMode) => navigator.mediaDevices.getUserMedia({
        video: { facingMode, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false,
      });
      try { return await ask({ exact: facing }); }
      catch (e) { if (e && (e.name === "OverconstrainedError" || e.name === "NotFoundError")) return ask(facing); throw e; }
    },
    async count() {
      try { return (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "videoinput").length; } catch { return 1; }
    },
    // Only offered when the camera really has a torch (most rear phone cameras on Android).
    torchSupported(stream) {
      const t = stream && stream.getVideoTracks()[0];
      try { return !!(t && t.getCapabilities && t.getCapabilities().torch); } catch { return false; }
    },
    async setTorch(stream, on) {
      const t = stream && stream.getVideoTracks()[0];
      if (t) await t.applyConstraints({ advanced: [{ torch: on }] });
    },
  },
};

const fileData = (f) => new Promise((ok, fail) => { const fr = new FileReader(); fr.onload = () => ok(fr.result); fr.onerror = () => fail(fr.error); fr.readAsDataURL(f); });

// Phone app: save straight into a "Glow Studio" album.
async function saveToAlbum(dataUrl, name) {
  const media = plugins.Media;
  let album;
  if (window.Capacitor.getPlatform() === "android") {
    // The Glow Studio album is a nicety: without it (no permission to list albums) the photo still
    // goes to the phone's Pictures.
    try {
      const find = async () => ((await media.getAlbums()).albums || []).find((a) => a.name === "Glow Studio");
      album = await find();
      if (!album) { await media.createAlbum({ name: "Glow Studio" }); album = await find(); }
    } catch (err) { console.warn("Glow Studio album unavailable", err); album = null; }
  }
  await media.savePhoto({ path: dataUrl, albumIdentifier: album && album.identifier, fileName: name });
}

// The editing session survives a refresh or the app being closed: kept in IndexedDB.
const Drafts = {
  db: null,
  open() {
    if (!this.db) this.db = new Promise((ok, fail) => {
      const r = indexedDB.open("glow", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("drafts");
      r.onsuccess = () => ok(r.result); r.onerror = () => fail(r.error);
    });
    return this.db;
  },
  async run(mode, fn) {
    const db = await this.open();
    return new Promise((ok, fail) => {
      const tx = db.transaction("drafts", mode), req = fn(tx.objectStore("drafts"));
      tx.oncomplete = () => ok(req && req.result); tx.onerror = () => fail(tx.error);
    });
  },
  read(k) { return this.run("readonly", (s) => s.get(k)).then((v) => v || null).catch(() => null); },
  write(k, v) { return this.run("readwrite", (s) => s.put(v, k)); },
  remove(k) { return this.run("readwrite", (s) => s.delete(k)).catch(() => {}); },
  get() { return this.read("current"); },
  put(d) { return this.write("current", d); },
  clear() { return this.remove("current"); },
  // An AI edit in progress, kept apart from the session so it survives starting a new photo.
  getJob() { return this.read("job"); },
  putJob(j) { return this.write("job", j); },
  clearJob() { return this.remove("job"); },
  // A finished AI result whose session was discarded or replaced.
  getRecovered() { return this.read("recovered"); },
  putRecovered(r) { return this.write("recovered", r); },
  clearRecovered() { return this.remove("recovered"); },
};

// The last photos saved from Glow Studio, for the "Recent" row on the home screens. Kept on this device
// only (IndexedDB, next to the draft), newest first. Share cards and "also save the original" copies are left out.
const Recents = {
  MAX: 12,
  async list() { const r = await Drafts.read("recents"); return Array.isArray(r) ? r : []; },
  async thumb(blob) {
    const bm = await createImageBitmap(blob);
    const s = 240 / Math.min(bm.width, bm.height), c = document.createElement("canvas");
    c.width = Math.round(bm.width * s); c.height = Math.round(bm.height * s);
    c.getContext("2d").drawImage(bm, 0, 0, c.width, c.height); if (bm.close) bm.close();
    return c.toDataURL("image/jpeg", 0.8);
  },
  async add(files) {
    const keep = files.filter((f) => /^image\//.test(f.type || "image/") && !/share-card|original/i.test(f.name));
    if (!keep.length) return;
    const fresh = [];
    for (const f of keep) fresh.push({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, ts: Date.now(), name: f.name.replace(/\.\w+$/, ""), thumb: await this.thumb(f), blob: f });
    const all = fresh.reverse().concat(await this.list()).slice(0, this.MAX);
    await Drafts.write("recents", all);
    document.dispatchEvent(new CustomEvent("recents-changed"));
  },
  async remove(id) { await Drafts.write("recents", (await this.list()).filter((r) => r.id !== id)); document.dispatchEvent(new CustomEvent("recents-changed")); },
  async clear() { await Drafts.remove("recents"); document.dispatchEvent(new CustomEvent("recents-changed")); },
};
