// Phone-size shots of the Enhance pick sheet: ready, working and the result, for tall (9:16),
// 3:4 and landscape photos. node tests/sheet-shots.js [outDir] [width] [height]
// Headless Chromium with mocked servers, not a device.
const H = require('./harness');
const path = require('path'), fs = require('fs');
const out = process.argv[2] || path.join(__dirname, 'out', 'sheet');
const W = +(process.argv[3] || 390), Hh = +(process.argv[4] || 844);
const scheme = process.argv[5] || 'light';
fs.mkdirSync(out, { recursive: true });
const PHOTOS = { tall: path.join(__dirname, 'fixtures/tall-916.jpg'), portrait: path.join(__dirname, '../public/samples/demo-v2/original.png'), wide: path.join(__dirname, 'fixtures/group-two.jpg') };
(async () => {
  for (const [name, file] of Object.entries(PHOTOS)) {
    const polls = Array(40).fill('processing').concat(['succeeded']);
    const { browser, p, state } = await H.launch({ start: 'enhance', camera: false, viewport: { width: W, height: Hh }, scheme, ai: { post: 'processing', polls } });
    await p.goto('https://app.test/'); await p.waitForFunction(() => screen === 'enhanceHome');
    await p.evaluate(() => document.getElementById('splash')?.remove());
    const fc = p.waitForEvent('filechooser'); await p.click('#enhPick'); await (await fc).setFiles(file);
    if (process.env.PRO) await p.evaluate(() => { ENH_STYLES.push({ id: 'pro', name: 'Pro Edit', line: 'Pro color, light and retouch', icon: 'wand', cost: 2, pro: true }); });
    await p.waitForSelector('#enhSheet[open]'); await p.waitForTimeout(900);
    if (process.env.PRO) await p.evaluate(() => renderEnhCost());
    await p.screenshot({ path: path.join(out, `${name}-1-ready-${W}x${Hh}.png`) });
    await p.click('#enhGo'); await p.waitForTimeout(2600);
    await p.screenshot({ path: path.join(out, `${name}-2-working-${W}x${Hh}.png`) });
    if (name === 'tall') { await p.waitForTimeout(5000); await p.screenshot({ path: path.join(out, `${name}-3-working-later-${W}x${Hh}.png`) }); }
    // Finish quickly: the next poll succeeds.
    await p.evaluate(() => 0); state.ai.polls = ['succeeded'];
    for (const j of Object.values(state.jobs)) j.n = 0;
    for (let i = 0; i < 60; i++) {
      if (await p.evaluate(() => !!document.querySelector('#enhSheetPic .done.in'))) { await p.waitForTimeout(450); await p.screenshot({ path: path.join(out, `${name}-3b-reveal-${W}x${Hh}.png`) }); break; }
      await p.waitForTimeout(100);
    }
    await p.waitForFunction(() => screen === 'enhanceResult' && $('enhAfter').naturalWidth > 0, null, { timeout: 60000 });
    await p.waitForTimeout(1600);
    await p.screenshot({ path: path.join(out, `${name}-4-result-${W}x${Hh}.png`) });
    if (state.errs.length) console.log(name, 'errors', state.errs);
    await browser.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
