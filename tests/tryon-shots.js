// Phone screenshots of Try on (390×844, headless Chromium, mocked servers; not a device capture):
// node tests/tryon-shots.js outDir [dark]
const H = require('./harness');
const path = require('path'), fs = require('fs');
const out = process.argv[2] || path.join(__dirname, 'out', 'tryon');
fs.mkdirSync(out, { recursive: true });
const PORTRAIT = process.env.PORTRAIT || path.join(__dirname, '../public/samples/demo-v2/original.png');
const OUTFIT = path.join(__dirname, 'fixtures/coords-600x400.png');
(async () => {
  const { browser, p } = await H.launch({ start: 'editor', scheme: process.argv[3] || 'light' });
  const shot = (n) => p.screenshot({ path: path.join(out, n + '.png') });
  await p.goto('https://app.test/');
  const fc = p.waitForEvent('filechooser'); await p.click('#pickBtn'); await (await fc).setFiles(PORTRAIT);
  await p.waitForFunction(() => screen === 'editorScreen' && $('before').naturalWidth > 0); await p.waitForTimeout(600);
  await p.click('.tab[data-cat="looks"]'); await p.waitForTimeout(300); await shot('00-looks-tab');
  await p.click('.tool[data-tool="outfit"]'); await p.waitForFunction(() => tryOn.check !== null, null, { timeout: 30000 }); await p.waitForTimeout(300); await shot('01-ideas');
  await p.click('.try-card[data-idea="gown"]'); await p.click('.try-color[aria-label="Red"]'); await p.waitForTimeout(200); await shot('02-idea-color');
  await p.click('#applyBtn'); await p.waitForTimeout(150); await shot('02b-working'); await p.waitForFunction(() => job && job.status === 'done', null, { timeout: 30000 }); await p.waitForTimeout(500); await shot('03-result');
  await p.click('#cancelBtn'); await p.waitForTimeout(300);
  if (!(await p.evaluate(() => sel === 'outfit'))) await p.click('.tool[data-tool="outfit"]');
  await p.click('.try-seg .opt:has-text("Your photo")'); await p.waitForTimeout(200); await shot('04-your-photo-empty');
  const f2 = p.waitForEvent('filechooser'); await p.click('.try-add[aria-label^="Add"]'); await (await f2).setFiles(OUTFIT);
  await p.waitForFunction(() => !!outfitData); await p.waitForTimeout(300); await shot('05-your-photo');
  await p.click('.try-seg .opt:has-text("Describe")'); await p.fill('#tryWords', 'a red satin slip dress'); await p.waitForTimeout(200); await shot('06-describe');
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
