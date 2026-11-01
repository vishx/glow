// Screenshots of the Photoshop Express style Adjust layout: node tests/live-adjust-shots.js outDir [width height]
const H = require('./harness');
const path = require('path'), fs = require('fs');
const out = process.argv[2] || '/tmp/live-shots', W = +process.argv[3] || 412, Hh = +process.argv[4] || 805;
fs.mkdirSync(out, { recursive: true });
const PHOTO = process.env.GLOW_TEST_BODY || path.join(__dirname, '../public/samples/demo-v2/original.png');
(async () => {
  const { browser, p } = await H.launch({ start: 'editor', scheme: process.env.SCHEME || 'light', viewport: { width: W, height: Hh } });
  await p.goto('https://app.test/');
  const fc = p.waitForEvent('filechooser'); await p.click('#pickBtn'); await (await fc).setFiles(PHOTO);
  await p.waitForFunction(() => screen === 'editorScreen' && $('before').naturalWidth > 0); await p.waitForTimeout(500);
  await p.click('.tab[data-cat="edit"]'); await p.waitForTimeout(200);
  await p.evaluate(() => document.querySelector('#tools .tool[data-tool="exposure"]').click());
  await p.waitForSelector('#areaBar .area[data-area="person"]:not([disabled])', { timeout: 60000 });
  await p.waitForTimeout(300);
  const m = async (name) => { await p.screenshot({ path: path.join(out, `${W}x${Hh}-${name}.png`) });
    return p.evaluate(() => { const i = $('before').getBoundingClientRect(); return Math.round(i.height); }); };
  console.log('open', await m('1-exposure'));
  await p.click('#areaBar .area[data-area="bg"]');
  await p.evaluate(() => { const r = document.querySelector('#panelBody .slider input'); r.value = -40; r.dispatchEvent(new Event('input')); r.dispatchEvent(new Event('change')); });
  await p.waitForFunction(() => ed.pending, null, { timeout: 30000 }); await p.waitForTimeout(400);
  console.log('bg', await m('2-background-darker'));
  await p.click('#toolInfo'); await p.waitForTimeout(200); console.log('info', await m('3-info'));
  await p.click('#toolInfo');
  await p.evaluate(() => document.querySelector('#tools .tool[data-tool="contrast"]').click()); await p.waitForTimeout(500);
  console.log('switched; idx', await p.evaluate(() => ed.idx), await m('4-contrast-after-switch'));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
