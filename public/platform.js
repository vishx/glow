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
    return new Promise((done) => {
      const input = document.getElementById(inputId);
      let settled = false;
      const finish = (f) => {
        if (settled) return; settled = true;
        window.removeEventListener("focus", onFocus); input.onchange = null; input.value = "";
        done(f || null);
      };
      // Some browsers never fire "change" on cancel; returning focus without a file means cancel.
      const onFocus = () => setTimeout(() => { if (!input.files.length) finish(null); }, 1000);
      input.onchange = () => finish(input.files[0]);
      window.addEventListener("focus", onFocus);
      input.click();
    });
  },

  // Saves photos ({ data: dataURL, name }) to the library. Returns where they went:
  // "photos" (phone app), "shared" (share sheet) or "downloaded". Throws AbortError if the user cancels.
  async savePhotos(items) {
    if (native && plugins.Media) {
      for (const it of items) await saveToAlbum(it.data, it.name);
      return "photos";
    }
    const files = await Promise.all(items.map(async (it) => {
      const blob = await (await fetch(it.data)).blob();
      const ext = (blob.type.split("/")[1] || "jpg").replace("jpeg", "jpg");
      return new File([blob], `${it.name}.${ext}`, { type: blob.type });
    }));
    if (native && plugins.Filesystem && plugins.Share) {
      const uris = [];
      for (const f of files) {
        const data = await new Promise((ok) => { const fr = new FileReader(); fr.onload = () => ok(fr.result.split(",")[1]); fr.readAsDataURL(f); });
        uris.push((await plugins.Filesystem.writeFile({ path: f.name, data, directory: "CACHE" })).uri);
      }
      await plugins.Share.share({ title: "Glow", files: uris });
      return "shared";
    }
    // Phones: the share sheet has "Save Image". Computers: a normal download.
    const touch = matchMedia("(pointer: coarse)").matches;
    if (touch && navigator.canShare && navigator.canShare({ files })) {
      await navigator.share({ files, title: "Glow" });
      return "shared";
    }
    for (const f of files) {
      const a = document.createElement("a"); a.href = URL.createObjectURL(f); a.download = f.name;
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    }
    return "downloaded";
  },

  haptic(kind = "light") {
    try {
      if (native && plugins.Haptics) plugins.Haptics.impact({ style: kind === "heavy" ? "HEAVY" : "LIGHT" });
      else if (navigator.vibrate && matchMedia("(pointer: coarse)").matches) navigator.vibrate(kind === "heavy" ? 18 : 8);
    } catch {}
  },

  camera: {
    supported: () => !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia),
    // "granted", "denied", "prompt", or "unknown" where the browser can't say.
    async permission() {
      try { return (await navigator.permissions.query({ name: "camera" })).state; } catch { return "unknown"; }
    },
    async open(facing) {
      return navigator.mediaDevices.getUserMedia({
        video: { facingMode: facing, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false,
      });
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
  get() { return this.run("readonly", (s) => s.get("current")).catch(() => null); },
  put(d) { return this.run("readwrite", (s) => s.put(d, "current")); },
  clear() { return this.run("readwrite", (s) => s.delete("current")).catch(() => {}); },
};
