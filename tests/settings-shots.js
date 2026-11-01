// Phone-size shots of Settings and its in-app help pages, light and dark, as on the Android app.
// node tests/settings-shots.js [outDir]. Headless Chromium with mocked servers, not a device.
const H = require('./harness');
const path = require('path'), fs = require('fs');
const out = process.argv[2] || path.join(__dirname, 'out', 'settings');
fs.mkdirSync(out, { recursive: true });
(async () => {
  for (const scheme of ['light', 'dark']) {
    const { browser, p, state } = await H.launch({ start: 'enhance', camera: false, viewport: { width: 390, height: 844 }, scheme,
      init: () => { window.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'android', Plugins: {} }; } });
    await p.goto('https://app.test/'); await p.waitForFunction(() => screen === 'enhanceHome');
    await p.evaluate(() => document.getElementById('splash')?.remove());
    await p.click('#enhSettingsBtn'); await p.waitForSelector('#settings[open]'); await p.waitForTimeout(600);
    await p.screenshot({ path: path.join(out, `settings-top-${scheme}.png`) });
    await p.evaluate(() => { const d = $('settings'); d.scrollTop = d.scrollHeight; }); await p.waitForTimeout(300);
    await p.screenshot({ path: path.join(out, `settings-bottom-${scheme}.png`) });
    for (const [row, f] of [['Help and FAQ', 'help'], ['Licenses', 'licenses']]) {
      if (!(await p.isVisible('#settings[open]'))) { await p.click('#enhSettingsBtn'); await p.evaluate(() => { const d = $('settings'); d.scrollTop = d.scrollHeight; }); }
      await p.click(`#settings [data-doc="${row}"]`); await p.waitForTimeout(900);
      await p.screenshot({ path: path.join(out, `${f}-${scheme}.png`) });
      await p.click('#docSheet [data-close]');
    }
    await p.evaluate(() => { account = { plan: 'free', remaining: 3, quota: 3, trialLeft: 3, adsLeft: 1 }; openCredits = openCredits; renderCreditsSheet(); $('creditsSheet').showModal(); });
    await p.waitForTimeout(500); await p.screenshot({ path: path.join(out, `credits-${scheme}.png`), fullPage: false });
    if (state.errs.length) console.log(scheme, 'errors', state.errs);
    await browser.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
