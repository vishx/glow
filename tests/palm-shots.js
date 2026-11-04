// Phone-size screenshots of Show palm and Camera settings (shoot.js). node tests/palm-shots.js [outDir]
// Headless Chromium with the fake camera showing an open hand (tests/.assets/palm.y4m), not a device.
const H = require('./harness');
const path = require('path'), fs = require('fs');
const out = process.argv[2] || path.join(__dirname, 'out', 'palm');
fs.mkdirSync(out, { recursive: true });
(async () => {
  const { browser, p, state } = await H.launch({ start: 'camera', viewport: { width: 390, height: 844 }, deviceScaleFactor: 2,
    args: ['--use-file-for-fake-video-capture=' + path.join(__dirname, '.assets/palm.y4m')],
    init: () => { localStorage.setItem('glowAutoSave', 'off'); localStorage.setItem('glowTheme', 'dark'); } });
  await p.goto('https://app.test/');
  await p.waitForFunction(() => cam.state === 'live' && !!cam.zr, null, { timeout: 20000 });
  await p.waitForTimeout(600);
  await p.screenshot({ path: path.join(out, '1-hint.png') });
  await p.waitForFunction(() => !$('camPalm').hidden, null, { timeout: 60000 });
  await p.screenshot({ path: path.join(out, '2-palm-seen.png') });
  await p.waitForFunction(() => !!cam.counting, null, { timeout: 20000 });
  await p.waitForTimeout(150);
  await p.screenshot({ path: path.join(out, '3-countdown.png') });
  await p.waitForFunction(() => !!cam.shot, null, { timeout: 20000 });
  await p.click('#retakeBtn');
  await p.evaluate(() => { store.set('glowPalm', 'off'); });
  await p.waitForFunction(() => cam.state === 'live' && !!cam.zr, null, { timeout: 20000 });
  await p.click('#camSettingsBtn'); await p.waitForTimeout(400);
  await p.screenshot({ path: path.join(out, '4-camera-settings.png') });
  await p.evaluate(() => { $('csKeysRow').hidden = false; $('camSettings').scrollTop = 9999; }); await p.waitForTimeout(200);
  await p.screenshot({ path: path.join(out, '5-camera-settings-end.png') });
  await p.click('#csFloat'); await p.evaluate(() => $('camSettings').close());
  await p.click('#camMore'); await p.waitForTimeout(300);
  await p.screenshot({ path: path.join(out, '6-floating-shutter-quick.png') });
  console.log('errors', state.errs);
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
