// Editor tool menu screenshots, every tab (and a tool open): node tests/menu-shots.js outDir [tag]
// Headless Chromium, mocked servers, the free AI sample photo.
const H = require('./harness');
const path = require('path'), fs = require('fs');
const out = process.argv[2] || path.join(__dirname, 'out', 'menu');
const tag = process.argv[3] || 'shot';
fs.mkdirSync(out, { recursive: true });
async function run(name, opts) {
  const { browser, p } = await H.launch({ start: 'editor', ...opts });
  const shot = (n) => p.screenshot({ path: path.join(out, `${tag}-${name}-${n}.png`) });
  await p.goto('https://app.test/');
  await p.click('#sampleBtn'); await p.waitForFunction(() => screen === 'editorScreen' && $('before').naturalWidth > 0); await p.waitForTimeout(900);
  const tabs = await p.evaluate(() => [...document.querySelectorAll('#tabs .tab')].filter((t) => !t.hidden).map((t) => t.dataset.cat));
  for (const c of tabs) { await p.click(`.tab[data-cat="${c}"]`); await p.waitForTimeout(400); await shot(c); }
  await p.click('.tab[data-cat="looks"]'); await p.waitForTimeout(200);
  const first = await p.evaluate(() => { const b = document.querySelector('#tools .tool:not(#searchBtn)'); return b && b.dataset.tool; });
  if (first) { await p.click(`.tool[data-tool="${first}"]`); await p.waitForTimeout(900); await shot('tool-open'); }
  await browser.close();
  console.log(name, tabs.join(','));
}
(async () => {
  await run('390x844', { scheme: 'light' });
  await run('360x740', { scheme: 'light', viewport: { width: 360, height: 740 } });
  if (process.argv[4] === 'all') {
    await run('320x640-dark', { viewport: { width: 320, height: 640 } });
    await run('1440x900', { scheme: 'light', viewport: { width: 1440, height: 900 }, mobile: false, touch: false });
  }
})().catch((e) => { console.error(e); process.exit(1); });
