// Device features behind one small interface: camera, photo picking, saving and
// haptics. The web versions live here; the phone app can swap in native ones
// (Capacitor plugins) without touching the screens in app.js.
const native = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
const plugins = (window.Capacitor && window.Capacitor.Plugins) || {};
const store = {
  get(k) { try { return localStorage.getItem(k) || ""; } catch { return ""; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
};

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
        window.removeEventListener("focus", onFocus); input.onchange = null; input.value = "";
        done(f);
      };
      // Some browsers never fire "change" on cancel; returning focus without a file means cancel.
      const onFocus = () => setTimeout(() => { if (!input.files.length) finish([]); }, 1000);
      input.onchange = () => finish([...input.files]);
      window.addEventListener("focus", onFocus);
      input.click();
    });
  },

  // Saves photos ({ blob } or { data: dataURL }, plus a name without extension). Resolves only
  // once the platform has finished, and says where they went: "photos" (the phone app saved them
  // to the Glow album), "shared" (the share sheet closed; we can't tell what the user picked) or
  // "downloaded" (the browser started a download). Throws AbortError if the user cancels.
  // { download: true } skips the share sheet, for saves the user didn't tap for (auto-save);
  // { share: true } asks for the share sheet on computers too (the editor's Share button).
  async savePhotos(items, opts = {}) {
    const files = await Promise.all(items.map(async (it) => {
      const blob = it.blob || (await (await fetch(it.data)).blob());
      const ext = (blob.type.split("/")[1] || "jpg").replace("jpeg", "jpg");
      return new File([blob], `${it.name}.${ext}`, { type: blob.type || "image/jpeg" });
    }));
    if (native && plugins.Media) {
      for (const f of files) await saveToAlbum(await fileData(f), f.name.replace(/\.\w+$/, ""));
      return "photos";
    }
    if (native && plugins.Filesystem && plugins.Share && !opts.download) {
      const uris = [];
      for (const f of files) uris.push((await plugins.Filesystem.writeFile({ path: f.name, data: (await fileData(f)).split(",")[1], directory: "CACHE" })).uri);
      await plugins.Share.share({ title: "Glow", files: uris });
      return "shared";
    }
    // iPhone: the share sheet has "Save Image". Android's share sheet has no save option (only
    // apps such as Drive), so Android and computers get a normal download, which lands in
    // Downloads and shows up in the phone's Gallery and Google Photos.
    const touch = matchMedia("(pointer: coarse)").matches, android = /Android/i.test(navigator.userAgent);
    if (!opts.download && ((touch && !android) || opts.share) && navigator.canShare && navigator.canShare({ files })) {
      await navigator.share({ files, title: "Glow" });
      return "shared";
    }
    for (const f of files) {
      const a = document.createElement("a"); a.href = URL.createObjectURL(f); a.download = f.name;
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 60000);
    }
    return "downloaded";
  },

  haptic(kind = "light") {
    try {
      if (native && plugins.Haptics) plugins.Haptics.impact({ style: kind === "heavy" ? "HEAVY" : "LIGHT" }).catch(() => {});
      else if (navigator.vibrate && matchMedia("(pointer: coarse)").matches) navigator.vibrate(kind === "heavy" ? 18 : 8);
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

// Phone app: save straight into a "Glow" album.
async function saveToAlbum(dataUrl, name) {
  const media = plugins.Media;
  let album;
  if (window.Capacitor.getPlatform() === "android") {
    const find = async () => ((await media.getAlbums()).albums || []).find((a) => a.name === "Glow");
    album = await find();
    if (!album) { await media.createAlbum({ name: "Glow" }); album = await find(); }
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
