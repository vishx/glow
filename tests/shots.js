// Screenshots for review: node tests/shots.js [outDir] [scheme] [WxH]
// Mocked browser renders (fake camera, fake servers), not device captures.
const H = require('./harness');
const path = require('path');
const out = process.argv[2] || path.join(__dirname, 'out', 'shots');
const scheme = process.argv[3] || 'dark';
const [W, Ht] = (process.argv[4] || '390x844').split('x').map(Number);
require('fs').mkdirSync(out, { recursive: true });
// PREP=1 serves a test manifest whose two "prepared results" are tone changes of the sample
// (tests/fixtures/demo-test-*.jpg), to show the layout. Those images are not Glow output.
const prep = !!process.env.PREP;
const fx = (f) => path.join(__dirname, 'fixtures', f);
let files = {};
if (prep) {
  const m = JSON.parse(require('fs').readFileSync(path.join(__dirname, '../public/samples/demo/manifest.json')));
  for (const e of m.previews) Object.assign(e, e.tool === 'pro' || e.tool === 'relight' ? { status: 'ready', result: `test-${e.tool}.jpg` } : { status: 'needs-generation', result: null });
  files = { '/samples/demo/manifest.json': { json: m }, '/samples/demo/test-pro.jpg': fx('demo-test-a.jpg'), '/samples/demo/test-relight.jpg': fx('demo-test-b.jpg') };
}
const tag = `${scheme}-${W}x${Ht}` + (prep ? '-TESTASSET' : '');
(async () => {
  const { browser, p } = await H.launch({ onboarded: false, scheme, viewport: { width: W, height: Ht }, files, mobile: W < 900, touch: W < 900 });
  const shot = (n) => p.screenshot({ path: path.join(out, `${n}-${tag}.png`) });
  await p.goto('https://app.test/'); await p.waitForTimeout(800);
  for (let i = 1; i <= 3; i++) { await p.waitForTimeout(700); await shot(`onboarding-${i}`); if (i < 3) await p.click('#obActions .btn'); }
  await p.click('text=Choose a photo'); await p.waitForTimeout(600); await shot('editor-landing');
  await p.click('#sampleBtn'); await p.waitForSelector('#editorScreen:not([hidden])'); await p.waitForTimeout(1200); await shot('sample');
  const first = await p.$('#tools .tool'); if (first) { await first.click(); await p.waitForTimeout(2500); await shot('sample-tool'); }
  if (await p.isVisible('#cancelBtn')) { await p.click('#cancelBtn'); await p.waitForTimeout(300); }
  { await p.click('#stage'); await p.click('.views [data-view="split"]').catch(() => {}); await p.waitForTimeout(400); await shot('sample-compare'); }
  if (await p.isVisible('#cancelBtn')) await p.click('#cancelBtn');
  await p.click('#tabs [data-cat="all"]'); await p.waitForTimeout(400); await shot('all');
  await p.fill('#searchInput', 'hair'); await p.waitForTimeout(300); await shot('all-search');
  await p.evaluate(() => go('camera')); await p.waitForTimeout(2000); await shot('camera');
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
