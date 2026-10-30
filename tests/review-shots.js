// Phone-size review of the editor: Face shape and Nose at 0, 50 and 100 in Compare (divider on
// the face), and a transparent PNG for the checkerboard. node tests/review-shots.js [outDir]
// Headless Chromium against a local copy of public/ with mocked servers, not a device.
const H = require('./harness');
const path = require('path'), fs = require('fs');
const out = process.argv[2] || path.join(__dirname, 'out', 'review');
fs.mkdirSync(out, { recursive: true });
const PORTRAIT = path.join(__dirname, '../public/samples/demo-v2/original.png');
(async () => {
  const { browser, p, state } = await H.launch({ start: 'editor' });
  await p.goto('https://app.test/');
  const pick = async (f) => { const fc = p.waitForEvent('filechooser'); await p.click('#pickBtn'); await (await fc).setFiles(f); await p.waitForFunction(() => screen === 'editorScreen' && ed.hist.length > 0 && $('before').naturalWidth > 0); };
  await pick(PORTRAIT);
  for (const id of ['fslim', 'fnose']) {
    await p.click('.tab[data-cat="retouch"]'); await p.click('.subchip[data-chip="face"]'); await p.click(`.tool[data-tool="${id}"]`);
    await p.waitForFunction(() => reshapeNote && reshapeNote.msg === '', null, { timeout: 30000 });
    for (const v of [0, 50, 100]) {
      await p.fill('.panel input[type=range]', String(v)); await p.waitForTimeout(250); await p.waitForFunction(() => !busyNow);
      if (v) { if (await p.evaluate(() => ed.view !== 'split')) await p.click('.views [data-view="split"]'); }
      await p.waitForTimeout(400); await p.screenshot({ path: path.join(out, `${id}-${v}.png`) });
    }
    await p.click('#cancelBtn');
  }
  await p.evaluate(() => { ed.hist = []; showScreen('editorHome'); });
  await pick(path.join(__dirname, 'fixtures/transparent.png')); await p.waitForTimeout(400); await p.screenshot({ path: path.join(out, 'transparent.png') });
  console.log('errors', state.errs, 'posts', state.posts.length);
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
