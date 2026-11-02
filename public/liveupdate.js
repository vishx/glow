// ---------- Live updates (phone app only) ----------
// The phone app opens from the screens built into it, so it starts at once and works offline. Then,
// in the background, it reads the live site's app-update/manifest.json (made by
// mobile/live-update.mjs at each release) and, if that names a different version, downloads only
// the files that changed (the updater plugin copies everything else from the APK). The new screens
// are switched in at a calm moment: the next time the app opens, after a long break, or right away
// when someone is still on the home screen moments after opening. Nothing happens on the website.
//
// Safety:
//  - A new version must say "started fine" (notifyAppReady, below) within 15 seconds or the plugin
//    goes back to the previous screens; that version is then never tried again on this phone.
//  - Each manifest names the native app build it needs (minNative). Phones with an older app keep
//    their screens and are asked once a day to update from the store instead of getting screens
//    that call camera features their app doesn't have.
//  - Never goes below the screens built into the installed app.
//  - Admin can pause it (Features: "Phone app live updates"); rolling the website back on Vercel
//    rolls phones back too, because the manifest then names the older version.
const LiveUpdate = (() => {
  const cap = window.Capacitor;
  const isNative = !!(cap && cap.isNativePlatform && cap.isNativePlatform());
  const U = isNative && cap.Plugins && cap.Plugins.CapacitorUpdater;
  const MANIFEST = "https://glow-photo-enhancer.vercel.app/app-update/manifest.json";
  const K = "glowLiveUpdate";   // { pending: {id, version}, trying, bad: [versions], builtin: {version, build, native}, asked }
  const opened = Date.now();
  const read = () => { try { return JSON.parse(localStorage.getItem(K) || "{}") || {}; } catch { return {}; } };
  const write = (patch) => { const s = { ...read(), ...patch }; try { localStorage.setItem(K, JSON.stringify(s)); } catch {} return s; };
  const log = (...a) => { try { console.info("[live update]", ...a); } catch {} };
  let current = null, checking = null, nativeBuild = 0;
  const state = { version: "", source: "", status: "" };   // for Settings and diagnostics
  // The last check's answer is kept, so Settings still shows it when a reopen skips the check.
  const setStatus = (t) => { state.status = t; write({ status: t }); };

  // At start: if a downloaded version is waiting, switch to it now, before anyone has started doing
  // anything (the launch animation covers the reload).
  async function boot() {
    if (!U) return;
    try {
      current = (await U.current()).bundle;
      const s = read();
      const onBuiltin = !current || current.id === "builtin";
      if (s.trying && s.pending && s.trying === s.pending.id && current && current.id !== s.pending.id) {
        // We switched to it last time and the plugin had to go back: never try that version again.
        log("version failed to start, staying on", current && current.version, "instead of", s.pending.version);
        write({ pending: null, trying: "", bad: [...(s.bad || []), s.pending.version].slice(-10) });
        setStatus("rolled back");
      } else if (s.pending && current && current.id !== s.pending.id && !onBuiltinTooNew(s)) {
        const list = (await U.list()).bundles || [];
        const b = list.find((x) => x.id === s.pending.id && x.status !== "error" && x.status !== "deleting");
        if (b) { write({ trying: b.id }); log("switching to", b.version); await U.set({ id: b.id }); return; }
        write({ pending: null });
      }
    } catch (e) { log("boot", e && e.message); }
  }
  // A pending download made for an older app must not replace the screens of a newer app (after a
  // store update the plugin already clears downloads; this is the belt to that).
  const onBuiltinTooNew = (s) => s.builtin && s.pending && s.pending.build && s.pending.build < s.builtin.build;

  // Called when the app has really started (see below). Confirms the screens work.
  async function ready() {
    if (!U) return;
    try {
      await U.notifyAppReady();
      current = (await U.current()).bundle;
      const s = read();
      if (s.pending && current && current.id === s.pending.id) write({ pending: null, trying: "", status: "up to date" });
      const info = cap.Plugins.App ? await cap.Plugins.App.getInfo() : {};
      nativeBuild = Number(info.build) || 0;
      if (!current || current.id === "builtin") {
        // Remember what this installed app carries, to never go below it.
        let v = {};
        try { v = await (await fetch("bundle-version.json", { cache: "no-store" })).json(); } catch {}
        write({ builtin: { version: v.version || "", build: v.build || APP_BUILD, native: nativeBuild } });
        state.version = v.version || String(APP_BUILD); state.source = "built in";
      } else { state.version = current.version; state.source = "live update"; }
      log("running", state.version, "(" + state.source + "), app build", nativeBuild);
      if (!state.status) state.status = read().status || "";
    } catch (e) { log("ready", e && e.message); }
    setTimeout(() => check(), 2500);
    if (cap.Plugins.App) cap.Plugins.App.addListener("appStateChange", ({ isActive }) => { if (isActive) { check(); applyIfCalm(); } else away = Date.now(); });
  }
  let away = 0;

  // Reads the manifest and downloads a new version if there is one.
  function check({ force = false } = {}) {
    if (!U || checking) return checking;
    if (!force && typeof featureOn === "function" && !featureOn("app:liveupdate")) return null;
    const last = Number(read().checkedAt) || 0;
    if (!force && Date.now() - last < 60000) return null;
    write({ checkedAt: Date.now() });
    checking = (async () => {
      try {
        const res = await fetch(MANIFEST + "?t=" + Date.now(), { cache: "no-store" });
        if (!res.ok) return;
        const m = await res.json();
        if (!m || !m.version || !Array.isArray(m.files)) return;
        const s = read();
        const platform = cap.getPlatform();
        const need = Number(m.minNative && m.minNative[platform]) || 0;
        const running = current && current.id !== "builtin" ? current.version : (s.builtin && s.builtin.version) || "";
        if (m.version === running) { setStatus("up to date"); return; }
        if ((s.bad || []).includes(m.version)) { setStatus("skipped a version that failed"); return; }
        if (s.builtin && m.build < s.builtin.build) { setStatus("the installed app is newer"); return; }
        if (need && nativeBuild && nativeBuild < need) { setStatus("needs an app update"); askStoreUpdate(); return; }
        if (s.pending && s.pending.version === m.version) { applyIfCalm(); return; }
        setStatus("downloading");
        log("downloading", m.version, "over", running);
        const b = await U.download({ url: MANIFEST, version: m.version, manifest: m.files });
        write({ pending: { id: b.id, version: m.version, build: m.build } });
        setStatus("ready for next open");
        try { if (typeof track === "function") track("live_update_ready", { from: running, to: m.version }); } catch {}
        cleanup(b.id);
        applyIfCalm();
      } catch (e) { setStatus("check failed"); log("check", e && e.message); }
      finally { checking = null; }
    })();
    return checking;
  }

  // Switches right away only when it can't interrupt anything: moments after opening, or back from
  // a long break, on a home screen with nothing open and no photo in progress.
  function applyIfCalm() {
    const s = read();
    if (!U || !s.pending || (current && current.id === s.pending.id)) return;
    const fresh = Date.now() - opened < 12000, longBreak = away && Date.now() - away > 30 * 60000;
    const home = typeof screen === "string" && (screen === "enhanceHome" || screen === "editorHome");
    const busy = !!document.querySelector("dialog[open]") || (typeof enh !== "undefined" && enh && enh.busy);
    if ((fresh || longBreak) && home && !busy && document.visibilityState === "visible") {
      write({ trying: s.pending.id });
      log("switching now to", s.pending.version);
      U.set({ id: s.pending.id }).catch((e) => log("set", e && e.message));
    }
  }

  // Deletes old downloads other than the one in use and the one waiting.
  async function cleanup(keepId) {
    try {
      const list = (await U.list()).bundles || [];
      for (const b of list) if (b.id !== keepId && (!current || b.id !== current.id) && b.id !== "builtin") await U.delete({ id: b.id }).catch(() => {});
    } catch {}
  }

  // The installed app is too old for the new screens: offer the store, at most once a day.
  async function askStoreUpdate() {
    const s = read();
    if (Date.now() - (Number(s.asked) || 0) < 24 * 3600000) return;
    write({ asked: Date.now() });
    if (typeof say !== "function") return;
    say("A new version of Glow Studio is ready.", false, { label: "Update", run: storeUpdate });
  }
  async function storeUpdate() {
    try {
      if (cap.getPlatform() === "android") {
        const info = await U.getAppUpdateInfo();
        if (info && info.immediateUpdateAllowed) { await U.performImmediateUpdate(); return; }
      }
      await U.openAppStore();
    } catch (e) { log("store", e && e.message); try { await U.openAppStore(); } catch {} }
  }

  if (U) {
    // Old versions of the app registered the website's offline cache; the phone app has its files on
    // the phone already, and a cache could serve old screens after an update.
    try { if (navigator.serviceWorker) navigator.serviceWorker.getRegistrations().then((rs) => rs.forEach((r) => r.unregister())).catch(() => {}); } catch {}
    boot();
    // "Started fine" means every script ran and the home screen is up. If a new version breaks
    // before that, this never happens and the plugin rolls back on its own.
    const healthy = () => typeof go === "function" && typeof enhanceBack === "function" && typeof screen === "string" && !!screen;
    const confirm = () => { if (healthy()) ready(); else log("not confirming: the app did not start"); };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => setTimeout(confirm, 300));
    else setTimeout(confirm, 300);
  }
  return { native: !!U, state, check: () => check({ force: true }), storeUpdate };
})();
