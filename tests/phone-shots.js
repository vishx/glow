// Phone screenshots of the new tools (390×844, headless Chromium, mocked servers; not a device
// capture): node tests/phone-shots.js outDir
const H = require('./harness');
const path = require('path'), fs = require('fs');
const out = process.argv[2] || path.join(__dirname, 'out', 'phone');
fs.mkdirSync(out, { recursive: true });
const PORTRAIT = path.join(__dirname, '../public/samples/demo-v2/original.png');
const SCENE = path.join(__dirname, 'fixtures/coords-600x400.png');
(async () => {
  const { browser, p } = await H.launch({ start: 'editor', scheme: 'light' });
  const shot = (n) => p.screenshot({ path: path.join(out, n + '.png') });
  const idle = () => p.waitForFunction(() => !busyNow, null, { timeout: 60000 });
  const open = async (id) => {
    const home = await p.evaluate((x) => tabFor(x), id);
    if (!(await p.isVisible('#tabs .tab'))) await p.click('#cancelBtn');
    await p.click(`.tab[data-cat="${home[0]}"]`); await p.click(`.tool[data-tool="${id}"]`); await p.waitForTimeout(300); await idle();
  };
  await p.goto('https://app.test/');
  const fc = p.waitForEvent('filechooser'); await p.click('#pickBtn'); await (await fc).setFiles(PORTRAIT);
  await p.waitForFunction(() => screen === 'editorScreen' && $('before').naturalWidth > 0); await p.waitForTimeout(600);
  await p.evaluate(() => { CONFIG.aiV10 = true; });
  await open('glowup'); await p.waitForFunction(() => ed.pending, null, { timeout: 60000 }); await idle(); await p.waitForTimeout(500); await shot('00-glow-up');
  await p.click('#panelBody .opt:has-text("New background")'); await p.waitForTimeout(300); await shot('00b-glow-up-ai');
  await p.click('#panelBody .opt:has-text("No AI")'); await p.click('#cancelBtn');
  await open('flips'); await p.waitForTimeout(800); await idle(); await shot('01-lips');
  await p.click('#panelBody .swatch.more >> nth=0'); await p.waitForTimeout(300); await shot('02-color-picker');
  await p.click('#pickDone'); await idle();
  await open('feyecolor'); await p.waitForTimeout(800); await idle(); await shot('03-eye-color');
  await open('fglam'); await p.waitForTimeout(800); await idle(); await shot('04-looks');
  await p.click('#cancelBtn').catch(() => {});
  await p.click('.tab[data-cat="edit"]'); await p.waitForTimeout(200);
  await p.$eval('.tool[data-tool="bgscene"]', (b) => b.scrollIntoView({ inline: 'start' })); await p.waitForTimeout(200); await shot('05-background-row');
  await open('bgwhite'); await p.waitForFunction(() => ed.pending, null, { timeout: 30000 }); await idle(); await p.waitForTimeout(400); await shot('06-bg-white');
  await open('bgphoto');
  const f2 = p.waitForEvent('filechooser'); await p.click('#panelBody .outfit-pick button'); await (await f2).setFiles(SCENE);
  await p.waitForFunction(() => ed.pending && ed.pending.tool === 'bgphoto', null, { timeout: 30000 }); await idle(); await p.waitForTimeout(400); await shot('07-bg-your-photo');
  await open('bgscene'); await p.waitForTimeout(300); await shot('08-ai-scene');
  await open('vignette'); await shot('09-adjust');
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
