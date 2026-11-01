// Theme review screenshots (light and dark): node tests/theme-shots.js outDir tag
// Enhance home, editor with the sample on Retouch, the paywall and settings. Mocked servers.
const H = require('./harness');
const path = require('path'), fs = require('fs');
const out = process.argv[2] || path.join(__dirname, 'out', 'theme');
const tag = process.argv[3] || 'shot';
fs.mkdirSync(out, { recursive: true });
async function run(scheme) {
  const { browser, p } = await H.launch({ start: 'enhance', scheme, viewport: { width: 390, height: 844 } });
  const shot = (n) => p.screenshot({ path: path.join(out, `${tag}-${scheme}-${n}.png`) });
  await p.goto('https://app.test/');
  await p.waitForTimeout(2500); await shot('1-enhance');
  await p.evaluate(() => go('editor')); await p.waitForTimeout(600);
  await p.click('#sampleBtn:visible, #qaSampleBtn:visible'); await p.waitForFunction(() => screen === 'editorScreen' && $('before').naturalWidth > 0); await p.waitForTimeout(900);
  await p.click('.tab[data-cat="retouch"]').catch(() => {}); await p.waitForTimeout(400);
  await p.click('.tool[data-tool]').catch(() => {}); await p.waitForTimeout(900); await shot('2-editor');
  await p.evaluate(() => openPaywall()); await p.waitForTimeout(900); await shot('3-paywall');
  await p.evaluate(() => { $('paywall').close(); $('settings').showModal(); }); await p.waitForTimeout(700); await shot('4-settings');
  await browser.close();
}
(async () => { await run('light'); await run('dark'); })().catch((e) => { console.error(e); process.exit(1); });
