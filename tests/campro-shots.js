// Phone-size screenshots of the pro camera controls (lens pill, dial, focus square, 3:4 frame,
// grid and level, quick settings). node tests/campro-shots.js [outDir]
// Headless Chromium with the fake camera and mocked servers, not a device.
const H = require('./harness');
const path = require('path'), fs = require('fs');
const out = process.argv[2] || path.join(__dirname, 'out', 'campro');
fs.mkdirSync(out, { recursive: true });
(async () => {
  const { browser, p, state } = await H.launch({ start: 'camera', viewport: { width: 390, height: 844 } });
  await p.goto('https://app.test/');
  await p.waitForFunction(() => cam.state === 'live' && !!cam.zr, null, { timeout: 20000 });
  await p.waitForTimeout(1200);
  await p.screenshot({ path: path.join(out, '1-full-1x.png') });
  await p.click('#camRatio');
  await p.evaluate(() => { store.set('glowGrid', 'on'); store.set('glowLevel', 'on'); layoutCamFrame(); startLevel(); const e = new Event('devicemotion'); e.accelerationIncludingGravity = { x: -0.6, y: 9.78, z: 0 }; for (let i = 0; i < 20; i++) window.dispatchEvent(e); });
  await p.click('#camMore'); await p.waitForTimeout(300);
  await p.screenshot({ path: path.join(out, '2-3x4-grid-level-quick.png') });
  await p.click('#camMore');
  await p.evaluate(() => { const r = $('viewfinder').getBoundingClientRect(); for (const t of ['pointerdown', 'pointerup']) $('viewfinder').dispatchEvent(new PointerEvent(t, { pointerId: 1, clientX: r.left + 230, clientY: r.top + 330, bubbles: true })); cam.ev = 0.7; renderEv(); applyEv(); });
  await p.waitForTimeout(500);
  await p.screenshot({ path: path.join(out, '3-focus-exposure.png') });
  await p.evaluate(() => { camSetZoom(2.6); showDial(true); });
  await p.waitForTimeout(300);
  await p.screenshot({ path: path.join(out, '4-dial-2.6x.png') });
  console.log('errors', state.errs);
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
