// Enhance Result levels audit: how much each level of each tool changes the photo, plus phone
// shots of the result with each tool open (frame size must not change).
// node tests/levels-audit.js photo.jpg ai.jpg [outDir]. Headless Chromium, mocked servers.
const H = require('./harness');
const path = require('path'), fs = require('fs');
const [photo, ai] = [process.argv[2], process.argv[3]];
const out = process.argv[4] || path.join(__dirname, 'out', 'levels');
fs.mkdirSync(out, { recursive: true });
(async () => {
  const { browser, p, state } = await H.launch({ start: 'enhance', camera: false, viewport: { width: 412, height: 892 }, scheme: 'dark', files: { '/__ai.jpg': ai } });
  await p.goto('https://app.test/'); await p.waitForFunction(() => screen === 'enhanceHome');
  await p.evaluate(() => document.getElementById('splash')?.remove());
  const fc = p.waitForEvent('filechooser'); await p.click('#enhPick'); await (await fc).setFiles(photo);
  await p.waitForSelector('#enhSheet[open]'); await p.click('#enhGo');
  await p.waitForFunction(() => screen === 'enhanceResult' && $('enhAfter').naturalWidth > 0, null, { timeout: 60000 });
  await p.waitForTimeout(1800);
  const frame = () => p.evaluate(() => { const r = $('enhFrame').getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height), +cz.z.toFixed(2), Math.round(enh.split)]; });
  const sizes = { result: await frame() };
  await p.screenshot({ path: path.join(out, '0-result.png') });
  // How far each level moves the photo from Disabled: mean change (0-255) on the face and elsewhere.
  const report = await p.evaluate(async () => {
    const faces = enh.faces.length, res = {};
    const px = async (src) => { const im = await loadImg(src), [W, H] = enh.size, c = newCanvas(W, H), x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(im, 0, 0, W, H); return x.getImageData(0, 0, W, H).data; };
    const [W, H] = enh.size, P = enh.faces[0].map(([x, y]) => [x * W, y * H]);
    const xs = P.map((q) => q[0]), ys = P.map((q) => q[1]), fb = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
    const diff = (a, b) => { let f = 0, nf = 0, g = 0, ng = 0; for (let y = 0; y < H; y += 2) for (let x = 0; x < W; x += 2) { const i = (y * W + x) * 4, d = (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2])) / 3; if (x > fb[0] && x < fb[2] && y > fb[1] && y < fb[3]) { f += d; nf++; } else { g += d; ng++; } } return [+(f / nf).toFixed(2), +(g / ng).toFixed(2)]; };
    const std = { face: 3, bg: 3, retouch: 0, colors: 0, blur: 0 };
    for (const [k, , , names] of ENH_TOGGLES) {
      if (k === 'blur') continue;
      const imgs = [];
      for (let i = 0; i < names.length; i++) imgs.push(await composeEnhanced({ ...std, [k]: i }));
      const d0 = await px(imgs[0]), rows = [];
      let prev = d0;
      for (let i = 0; i < imgs.length; i++) { const d = await px(imgs[i]); rows.push([names[i], diff(d0, d), diff(prev, d)]); prev = d; }
      res[k] = rows; window['__lv_' + k] = imgs;
    }
    return { faces, res };
  });
  console.log(JSON.stringify(report, null, 1));
  // Save the levels side by side (face crop) for a look.
  for (const k of ['face', 'bg', 'retouch', 'colors']) {
    const urls = await p.evaluate((k) => window['__lv_' + k], k);
    urls.forEach((u, i) => fs.writeFileSync(path.join(out, `${k}-${i}.jpg`), Buffer.from(u.split(',')[1], 'base64')));
  }
  // The UI: pinch-like zoom, then open each tool, pick a level, done.
  await p.evaluate(() => { czTo(1.7, czMid(), { centre: true }); });
  sizes.zoomed = await frame();
  for (const k of ['retouch', 'bg', 'face', 'colors']) {
    await p.click(`.enh-t[data-k="${k}"]`); await p.waitForTimeout(400);
    sizes[k + '-open'] = await frame();
    await p.click('#enhLvRow .enh-lv[data-i="2"]'); await p.waitForTimeout(1200);
    await p.screenshot({ path: path.join(out, `1-${k}-open.png`) });
    await p.click('#enhLvDone'); await p.waitForTimeout(400);
    sizes[k + '-done'] = await frame();
  }
  console.log('frame [w,h,zoom,split]', JSON.stringify(sizes));
  if (state.errs.length) console.log('errors', state.errs);
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
