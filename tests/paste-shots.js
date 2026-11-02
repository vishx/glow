// Phone screenshots of Try on > Your photo > Paste (412×915, headless Chromium, mocked Android clipboard):
// node tests/paste-shots.js outDir
const H = require('./harness');
const path = require('path'), fs = require('fs');
const out = process.argv[2] || path.join(__dirname, 'out', 'paste');
fs.mkdirSync(out, { recursive: true });
const PORTRAIT = path.join(__dirname, '../public/samples/demo-v2/original.png');
const mock = (empty) => `(() => {
  window.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'android', PluginHeaders: [{ name: 'GlowImage', methods: [{ name: 'pasteImage', rtype: 'promise' }] }],
    Plugins: { GlowImage: { pasteImage: async () => {
      if (window.__empty) return { empty: true };
      const c = document.createElement('canvas'); c.width = 600; c.height = 800; const x = c.getContext('2d');
      x.fillStyle = '#e9e4dc'; x.fillRect(0, 0, 600, 800); x.fillStyle = '#1f2a44'; x.fillRect(150, 120, 300, 560); x.fillStyle = '#fff'; x.fillRect(270, 120, 60, 200);
      return { data: c.toDataURL('image/jpeg', 0.9) };
    } } } };
})()`;
(async () => {
  const { browser, p } = await H.launch({ start: 'editor', viewport: { width: 412, height: 915 }, init: mock() });
  const shot = (n) => p.screenshot({ path: path.join(out, n + '.png') });
  await p.goto('https://app.test/');
  const fc = p.waitForEvent('filechooser'); await p.click('#pickBtn'); await (await fc).setFiles(PORTRAIT);
  await p.waitForFunction(() => screen === 'editorScreen' && $('before').naturalWidth > 0); await p.waitForTimeout(600);
  await p.click('.tab[data-cat="looks"]'); await p.waitForTimeout(300);
  await p.click('.tool[data-tool="outfit"]'); await p.waitForTimeout(400);
  await p.click('.try-seg .opt:has-text("Your photo")'); await p.waitForTimeout(300);
  await p.evaluate(() => { window.__empty = true; }); await p.click('.try-add[aria-label^="Paste"]'); await p.waitForTimeout(500); await shot('1-nothing-copied');
  await p.evaluate(() => { window.__empty = false; say(''); }); await p.click('.try-add[aria-label^="Paste"]');
  await p.waitForFunction(() => !!outfitData); await p.waitForTimeout(500); await shot('2-pasted');
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
