// Inspection zoom screenshots: node tests/zoom-shots.js outDir. Headless Chromium with CDP touch emulation, mocked servers.
const H = require('./harness');
const path = require('path'), fs = require('fs');
const out = process.argv[2] || path.join(__dirname, 'out', 'zoom');
fs.mkdirSync(out, { recursive: true });
(async () => {
  const { browser, p } = await H.launch({ start: 'editor', scheme: 'light' });
  await p.goto('https://app.test/');
  const fc = p.waitForEvent('filechooser'); await p.click('#pickBtn'); await (await fc).setFiles(path.join(__dirname, '../public/samples/demo/original.png'));
  await p.waitForFunction(() => screen === 'editorScreen' && $('before').naturalWidth > 0);
  await p.click('.tab[data-cat="retouch"]'); await p.click('.subchip[data-chip="face"]'); await p.click('.tool[data-tool="fslim"]');
  await p.waitForFunction(() => !busyNow && reshapeNote && reshapeNote.msg === '', null, { timeout: 30000 });
  await p.fill('.panel input[type=range]', '100'); await p.waitForTimeout(300); await p.waitForFunction(() => !busyNow && !!ed.pending, null, { timeout: 30000 });
  await p.click('.views [data-view="split"]'); await p.waitForTimeout(4200);
  await p.screenshot({ path: path.join(out, 'compare-fit.png') });
  const c = await p.context().newCDPSession(p), T = (type, pts) => c.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y, id]) => ({ x, y, id })) });
  const st = await p.evaluate(() => { const r = $('stage').getBoundingClientRect(); return { x: r.left + r.width * 0.3, y: r.top + r.height * 0.42 }; });
  await T('touchStart', [[st.x - 25, st.y, 0], [st.x + 25, st.y, 1]]);
  for (let i = 1; i <= 5; i++) await T('touchMove', [[st.x - 25 - 10 * i, st.y, 0], [st.x + 25 + 10 * i, st.y, 1]]);
  await T('touchEnd', []); await p.waitForTimeout(300);
  await p.screenshot({ path: path.join(out, 'compare-pinched.png') });
  await p.click('#collapseBtn'); await p.waitForTimeout(300);
  await p.screenshot({ path: path.join(out, 'panel-collapsed.png') });
  console.log(await p.evaluate(() => ({ z: insp.z.toFixed(2), hist: ed.hist.length })));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
