// Quick actions review screenshots: node tests/quick-shots.js outDir
// Editor home on three phone sizes in light and dark, plus desktop. Mocked servers.
const H = require('./harness');
const path = require('path'), fs = require('fs');
const out = process.argv[2] || path.join(__dirname, 'out', 'quick');
fs.mkdirSync(out, { recursive: true });
async function run(scheme, w, h, mobile = true) {
  const { browser, p } = await H.launch({ start: 'editor', scheme, viewport: { width: w, height: h }, mobile, touch: mobile });
  await p.goto('https://app.test/'); await p.waitForFunction(() => typeof go === 'function' && !!screen, null, { timeout: 15000 });
  await p.evaluate(() => go('editor')); await p.waitForFunction(() => screen === 'editorHome');
  await p.waitForTimeout(1500);
  await p.screenshot({ path: path.join(out, `editor-home-${scheme}-${w}x${h}.png`) });
  await browser.close();
}
(async () => {
  for (const s of ['dark', 'light']) for (const [w, h] of [[360, 740], [390, 844], [430, 932]]) await run(s, w, h);
  await run('dark', 1440, 900, false);
})().catch((e) => { console.error(e); process.exit(1); });
