// ---------- "Add Glow Studio to your home screen" ----------
// Apps can't put an icon on the home screen by themselves: the phone decides. Store installs on
// iPhone and most Android phones already add one. This covers the rest, asking once:
//  - Android app: the launcher's own "Add to home screen" dialog (GlowHome plugin, ShortcutManager).
//  - Website on Android Chrome / Edge / Samsung Internet: the browser's Install dialog
//    (beforeinstallprompt), which adds the icon and opens Glow Studio full screen.
//  - Website on iPhone / iPad: there is no install dialog, so the sheet shows the two taps
//    (Share, then Add to Home Screen).
// When: once per install, a few seconds after the first photo saved from Enhance or the Editor,
// and never on top of another sheet (the Pro screen wins; we try again at the next save). Never
// when Glow Studio is already running from the home screen. Any answer, including closing the
// sheet, means we don't ask again; Settings keeps an "Add to home screen" row for later.
// Uses app.js globals: $, store, native, plugins, say, track, featureOn, topDialog, screen.
const HomeAdd = (() => {
  const ASKED = "glowHomeAsk";
  const ua = navigator.userAgent || "";
  const standalone = () => !!(navigator.standalone || (window.matchMedia && matchMedia("(display-mode: standalone), (display-mode: fullscreen), (display-mode: minimal-ui)").matches));
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  // In-app browsers (Instagram, Facebook, TikTok, Snapchat, Google app...) have no Add to Home Screen.
  const inApp = /FBAN|FBAV|FB_IAB|Instagram|Line\/|TikTok|musical_ly|Snapchat|GSA\/|Twitter|Pinterest/i.test(ua);
  const phone = window.matchMedia && matchMedia("(pointer: coarse)").matches;
  const androidApp = native && window.Capacitor && window.Capacitor.getPlatform && window.Capacitor.getPlatform() === "android";
  let deferred = null;          // the browser's saved install prompt (Android Chrome and friends)
  let nativeState = null;       // { supported, pinned } from the Android app
  let timer = 0;

  // Which way this device can add the icon: "app" (Android app), "install" (browser dialog),
  // "ios" (instructions), or "" (none, or it's already there / running from it).
  function mode() {
    if (androidApp) return plugins.GlowHome && nativeState && nativeState.supported && !nativeState.pinned ? "app" : "";
    if (native || standalone()) return "";
    if (deferred) return "install";
    if (ios && !inApp) return "ios";
    return "";
  }

  window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); deferred = e; renderRow(); });
  window.addEventListener("appinstalled", () => { deferred = null; store.set(ASKED, "added"); track("home_added", { how: "install" }); renderRow(); });
  async function checkApp() {
    if (!androidApp || !plugins.GlowHome) return;
    try { nativeState = await plugins.GlowHome.status(); } catch { nativeState = null; }
    renderRow();
  }
  checkApp();
  document.addEventListener("visibilitychange", () => { if (!document.hidden) checkApp(); });

  // ---- The sheet ----
  const d = $("homeAdd");
  function fill(m) {
    $("homeAddText").textContent = m === "ios"
      ? "Open Glow Studio in one tap, full screen, like any app. It takes two taps:"
      : m === "install" ? "Open Glow Studio in one tap, full screen, like any app. Nothing to download from a store."
      : "Open Glow Studio in one tap from your home screen.";
    $("homeAddSteps").hidden = m !== "ios";
    $("homeAddYes").textContent = m === "ios" ? "Got it" : m === "install" ? "Install" : "Add to home screen";
    $("homeAddNo").hidden = m === "ios";
  }
  async function open(from) {
    const m = mode();
    if (!m || d.open) return false;
    fill(m);
    store.set(ASKED, "shown");
    track("home_offer", { from, how: m });
    d.returnValue = "";
    d.showModal();
    const choice = await new Promise((done) => { d.onclose = () => done(d.returnValue); });
    if (choice !== "yes") { track("home_dismiss", { from, how: m }); return false; }
    if (m === "ios") { track("home_steps", { from }); return true; }
    if (m === "install") {
      const ev = deferred; deferred = null; renderRow();
      try {
        await ev.prompt();
        const r = await ev.userChoice;
        track("home_install", { from, outcome: r && r.outcome });
        return r && r.outcome === "accepted";
      } catch { return false; }
    }
    try {
      const r = await plugins.GlowHome.pin();
      track("home_pin", { from, requested: !!(r && r.requested) });
      if (!(r && r.requested)) say("Your phone's home screen doesn't allow adding icons from apps. Long-press Glow Studio in your apps list and drag it to the home screen.");
      setTimeout(checkApp, 1500);
      return !!(r && r.requested);
    } catch { say("Couldn't add the icon. Try again from Settings.", true); return false; }
  }
  $("homeAddYes").addEventListener("click", () => { d.returnValue = "yes"; d.close(); });
  $("homeAddNo").addEventListener("click", () => { d.returnValue = "no"; d.close(); });

  // Called after a photo is saved. Waits so the "Saved" moment (and the Pro screen, when it shows)
  // comes first, then asks only if the person is still on the same screen with nothing else open.
  function afterSave(where) {
    if (store.get(ASKED) || !featureOn("app:home") || timer) return;
    if (!androidApp && !phone) return;   // computers: only from Settings
    if (!mode()) return;
    const from = screen;
    timer = setTimeout(() => {
      timer = 0;
      if (store.get(ASKED) || screen !== from || topDialog() || document.hidden || !mode()) return;
      open(where);
    }, 3200);
  }

  // ---- Settings row ----
  const row = $("homeAddRow");
  function renderRow() { if (row) row.hidden = !mode() || !featureOn("app:home"); }
  if (row) row.addEventListener("click", (e) => { e.preventDefault(); open("settings"); });
  try { Features.onChange(renderRow); } catch {}
  renderRow();

  return { afterSave, open, mode, get asked() { return store.get(ASKED); } };
})();
