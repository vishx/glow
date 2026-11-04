// Enhance Result review: every level of every tool on one photo, saved full size, plus the
// level row (thumbnails) for each tool and how much each level changes face and background.
// node tests/enhance-review.js photo.jpg [ai.jpg] [outDir]. Headless Chromium, mocked servers.
const H = require('./harness');
const path = require('path'), fs = require('fs');
const photo = process.argv[2], ai = process.argv[3] || photo;
const out = process.argv[4] || path.join(__dirname, 'out', 'review');
fs.mkdirSync(out, { recursive: true });
(async () => {
  const { browser, p, state } = await H.launch({ start: 'enhance', camera: false, viewport: { width: 412, height: 892 }, scheme: 'dark', files: { '/__ai.jpg': ai } });
  await p.goto('https://app.test/'); await p.waitForFunction(() => screen === 'enhanceHome');
  await p.evaluate(() => document.getElementById('splash')?.remove());
  const fc = p.waitForEvent('filechooser'); await p.click('#enhPick'); await (await fc).setFiles(photo);
  await p.waitForSelector('#enhSheet[open]'); await p.click('#enhGo');
  await p.waitForFunction(() => screen === 'enhanceResult' && $('enhAfter').naturalWidth > 0, null, { timeout: 60000 });
  await p.waitForTimeout(2500);
  if (process.env.ONLY) await p.evaluate((o) => { window.__only = o.split(','); }, process.env.ONLY);
  const report = await p.evaluate(async () => {
    const res = { faces: enh.faces.length };
    const px = async (src) => { const im = await loadImg(src), [W, H] = enh.size, c = newCanvas(W, H), x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(im, 0, 0, W, H); return x.getImageData(0, 0, W, H).data; };
    const [W, H] = enh.size, P = enh.faces[0].map(([x, y]) => [x * W, y * H]);
    const xs = P.map((q) => q[0]), ys = P.map((q) => q[1]), fb = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
    const diff = (a, b) => { let f = 0, nf = 0, g = 0, ng = 0; for (let y = 0; y < H; y += 2) for (let x = 0; x < W; x += 2) { const i = (y * W + x) * 4, d = (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2])) / 3; if (x > fb[0] && x < fb[2] && y > fb[1] && y < fb[3]) { f += d; nf++; } else { g += d; ng++; } } return [+(f / nf).toFixed(2), +(g / ng).toFixed(2)]; };
    const std = Object.fromEntries(ENH_TOGGLES.map(([k, , , , d]) => [k, d]));
    window.__imgs = {};
    for (const [k, , , names] of ENH_TOGGLES) {
      if (k === 'face' || k === 'bg' || (window.__only && !window.__only.includes(k))) continue;
      const imgs = [];
      for (let i = 0; i < names.length; i++) imgs.push(await composeEnhanced({ ...std, [k]: i }));
      const d0 = await px(imgs[0]), rows = [];
      for (let i = 0; i < imgs.length; i++) rows.push([names[i], diff(d0, await px(imgs[i]))]);
      res[k] = rows; window.__imgs[k] = imgs;
    }
    res.faceBox = fb.map((v, i) => +(v / (i % 2 ? H : W)).toFixed(3));
    return res;
  });
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 1));
  console.log(JSON.stringify(report));
  const keys = await p.evaluate(() => Object.keys(window.__imgs));
  for (const k of keys) {
    const urls = await p.evaluate((k) => window.__imgs[k], k);
    urls.forEach((u, i) => fs.writeFileSync(path.join(out, `${k}-${i}.jpg`), Buffer.from(u.split(',')[1], 'base64')));
  }
  if (process.env.ONLY) { await browser.close(); return; }
  for (const k of keys) {
    await p.click(`.enh-t[data-k="${k}"]`); await p.waitForTimeout(k === 'blur' ? 15000 : 6000);
    await p.screenshot({ path: path.join(out, `row-${k}.png`) });
    await p.click('#enhLvBack'); await p.waitForTimeout(300);
  }
  // The working state while a slow level is being made.
  await p.click('.enh-t[data-k="blur"]'); await p.waitForTimeout(300);
  await p.evaluate(() => { enh.cache.clear(); enh.levelRun++; });
  await p.click('#enhLvRow .enh-lv[data-i="2"]'); await p.waitForTimeout(300);
  await p.screenshot({ path: path.join(out, 'working.png') });
  if (state.errs.length) console.log('errors', state.errs);
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
