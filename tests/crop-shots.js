// Crop and rotate screenshots for review: node tests/crop-shots.js [outDir]
// Mocked browser renders (headless Chromium), not device captures.
const H = require('./harness');
const path = require('path'), fs = require('fs');
const out = process.argv[2] || path.join(__dirname, 'out', 'crop');
fs.mkdirSync(out, { recursive: true });
const PORTRAIT = path.join(__dirname, '../public/samples/demo-v2/original.png');
async function run(tag, opts) {
  const { browser, p, state } = await H.launch({ start: 'editor', ...opts });
  const shot = (n) => p.screenshot({ path: path.join(out, `${n}-${tag}.png`) });
  await p.goto('https://app.test/');
  const fc = p.waitForEvent('filechooser'); await p.click('#pickBtn'); await (await fc).setFiles(PORTRAIT);
  await p.waitForFunction(() => screen === 'editorScreen' && ed.hist.length > 0);
  await p.click('.tab[data-cat="edit"]'); await p.click('.subchip[data-chip="crop"]'); await p.click('.tool[data-tool="crop"]');
  await p.waitForFunction(() => !!cr); await p.waitForTimeout(500); await shot('crop-1-open');
  await p.click('.panel .opt:has-text("4:5")'); await p.fill('#cropZoom', '170'); await p.waitForTimeout(400); await shot('crop-2-4x5-zoomed');
  await p.click('.panel .opt:has-text("Free")'); await p.waitForTimeout(300);
  const b = await p.$eval('.crop-h[data-h="se"]', (e) => { const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
  await p.mouse.move(b[0], b[1]); await p.mouse.down(); await p.mouse.move(b[0] - 50, b[1] - 70, { steps: 5 }); await shot('crop-3-free-resizing');
  await p.mouse.up(); await p.waitForTimeout(400);
  await p.click('text=Rotate 90°'); await p.waitForTimeout(400); await shot('crop-4-rotated');
  await p.click('#applyBtn'); await p.waitForFunction(() => !busyNow && !cr); await p.waitForTimeout(500); await shot('crop-5-applied');
  if (state.errs.length) console.log(tag, state.errs);
  await browser.close();
}
(async () => {
  await run('dark-390x844', {});
  await run('light-390x844', { scheme: 'light' });
  await run('dark-1440x900', { viewport: { width: 1440, height: 900 }, mobile: false, touch: false });
})().catch((e) => { console.error(e); process.exit(1); });
