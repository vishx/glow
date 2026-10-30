// Editor layout screenshots for before/after review: node tests/editor-shots.js outDir [tag]
// Headless Chromium, mocked servers; also prints how much of the screen the photo gets.
const H = require('./harness');
const path = require('path'), fs = require('fs');
const out = process.argv[2] || path.join(__dirname, 'out', 'editor');
const tag = process.argv[3] || 'shot';
fs.mkdirSync(out, { recursive: true });
const PORTRAIT = path.join(__dirname, '../public/samples/demo/original.png');
async function run(name, opts) {
  const { browser, p } = await H.launch({ start: 'editor', ...opts });
  const vp = opts.viewport || { width: 390, height: 844 };
  const shot = (n) => p.screenshot({ path: path.join(out, `${tag}-${n}-${name}.png`) });
  const photoBox = () => p.evaluate(() => {
    const st = $('stage').getBoundingClientRect(), b = $('before'), a = $('after'), m = !a.hidden && a.naturalWidth ? a : b;
    const s = Math.min(st.width / m.naturalWidth, st.height / m.naturalHeight);
    return { stage: [Math.round(st.width), Math.round(st.height)], photo: [Math.round(m.naturalWidth * s), Math.round(m.naturalHeight * s)] };
  });
  const res = {};
  await p.goto('https://app.test/');
  await p.click('#sampleBtn'); await p.waitForFunction(() => screen === 'editorScreen' && $('before').naturalWidth > 0); await p.waitForTimeout(900);
  await shot('sample'); res.sample = await photoBox();
  await p.click('.tab[data-cat="retouch"]'); await p.click('.subchip[data-chip="face"]'); await p.click('.tool[data-tool="fslim"]');
  await p.waitForFunction(() => !busyNow && reshapeNote && reshapeNote.msg === '', null, { timeout: 30000 });
  await p.fill('.panel input[type=range]', '60'); await p.waitForTimeout(300); await p.waitForFunction(() => !busyNow && !!ed.pending, null, { timeout: 30000 });
  await p.waitForTimeout(500); await shot('sample-tool'); res.tool = await photoBox();
  await browser.close();
  console.log(name, JSON.stringify(res), 'viewport', vp.width + 'x' + vp.height);
}
(async () => {
  await run('light-390x844', { scheme: 'light' });
  await run('dark-320x640', { viewport: { width: 320, height: 640 } });
  await run('light-412x915', { scheme: 'light', viewport: { width: 412, height: 915 } });
  await run('dark-1440x900', { viewport: { width: 1440, height: 900 }, mobile: false, touch: false });
})().catch((e) => { console.error(e); process.exit(1); });
