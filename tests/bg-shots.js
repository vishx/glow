// Background review: renders the on-device background tools on the sample portrait and saves
// the whole photo plus a hair-edge close-up of each, for checking by eye.
// node tests/bg-shots.js [outDir]. A headless-browser render, not a device capture.
const H = require('./harness');
const path = require('path'), fs = require('fs');
const out = process.argv[2] || path.join(__dirname, 'out', 'bg');
fs.mkdirSync(out, { recursive: true });
(async () => {
  const { browser, p } = await H.launch({ start: 'editor' });
  await p.goto('https://app.test/'); await p.waitForTimeout(500);
  p.on('console', (m) => console.log('page:', m.text()));
  const shots = await p.evaluate(async () => {
    const src = '/samples/demo-v2/original.png', res = {};
    const orig = await loadImg(src), c0 = canvasFor(orig); c0.getContext('2d').drawImage(orig, 0, 0, c0.width, c0.height);
    const base = c0.toDataURL('image/png');
    // A made-up scene for "Your photo": warm sky over a dark sea, so tint and light wrap show.
    const s = newCanvas(1200, 900), sx = s.getContext('2d'), g = sx.createLinearGradient(0, 0, 0, 900);
    g.addColorStop(0, '#f6b26b'); g.addColorStop(0.55, '#e06666'); g.addColorStop(0.56, '#1c3d5a'); g.addColorStop(1, '#0b2236');
    sx.fillStyle = g; sx.fillRect(0, 0, 1200, 900);
    const scene = s.toDataURL('image/jpeg', 0.9);
    const views = async (name, data, checker) => {
      const img = await loadImg(data), W = img.naturalWidth, H = img.naturalHeight;
      const full = newCanvas(500, Math.round(500 * H / W)), fx = full.getContext('2d');
      const paint = (x, w, h) => { if (!checker) return; for (let y = 0; y < h; y += 16) for (let i = 0; i < w; i += 16) { x.fillStyle = ((i + y) / 16) % 2 ? '#ccc' : '#fff'; x.fillRect(i, y, 16, 16); } };
      paint(fx, full.width, full.height); fx.drawImage(img, 0, 0, full.width, full.height);
      res[name] = full.toDataURL('image/jpeg', 0.9);
      const z = newCanvas(600, 400), zx = z.getContext('2d'); paint(zx, 600, 400);
      zx.drawImage(img, W * 0.22, H * 0.0, W * 0.3, W * 0.2, 0, 0, 600, 400);   // top-left of the hair
      res[name + '-hair'] = z.toDataURL('image/jpeg', 0.92);
    };
    const t0 = performance.now();
    await views('cutout', await cutout(base), true);
    res._ms = String(Math.round(performance.now() - t0));
    await views('blur', await backdrop(base, 'blur'));
    for (const id of ['bgwhite', 'bgblush', 'bgsky']) await views(id, await backdrop(base, BG_FILLS[id]));
    await views('photo', await backdrop(base, scene, { match: true }));
    await views('photo-soft', await backdrop(base, scene, { match: true, blur: true }));
    await views('scenemask', await sceneMask(base));
    return res;
  });
  for (const [k, v] of Object.entries(shots)) {
    if (!v.startsWith('data:')) { console.log(k, v); continue; }
    fs.writeFileSync(path.join(out, k + '.jpg'), Buffer.from(v.split(',')[1], 'base64'));
  }
  await browser.close();
})();
