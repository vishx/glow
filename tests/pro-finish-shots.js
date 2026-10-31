// Pro Edit's face-true finish (engine.js proFinish) on stand-in AI results, side by side.
// node tests/pro-finish-shots.js [outDir]. A headless-browser render, not a device capture; the
// "AI results" here are the sample's prepared Nano Banana Pro edit and simulated changes to it.
const H = require('./harness');
const path = require('path'), fs = require('fs');
const out = process.argv[2] || path.join(__dirname, 'out', 'pro-finish');
fs.mkdirSync(out, { recursive: true });
const extra = process.env.GLOW_TEST_PRO_PHOTO;   // optional real photo: graded + shrunk as a stand-in AI result
(async () => {
  const { browser, p, state } = await H.launch({ start: 'editor' });
  await p.goto('https://app.test/'); await p.waitForTimeout(500);
  const photo = extra ? 'data:image/jpeg;base64,' + fs.readFileSync(extra).toString('base64') : null;
  const res = await p.evaluate(async (photo) => {
    const url = (c, q = 0.95) => c.toDataURL('image/jpeg', q);
    const draw = (img, w, h, f) => { const c = newCanvas(w, h), x = c.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(img, 0, 0, w, h); if (f) f(x, w, h); return c; };
    const o = await loadImg('/samples/demo-v2/original.png'), ai = await loadImg('/samples/demo-v2/pro.jpg');
    const W = o.naturalWidth, Hh = o.naturalHeight;
    const cases = {};
    // A: the real prepared Pro edit at the same size.
    cases.same = [url(draw(o, W, Hh)), url(draw(ai, W, Hh))];
    // B: the same edit at 0.55x (a model answering at about 1 MP for a 3 MP photo).
    cases.small = [url(draw(o, W, Hh)), url(draw(ai, Math.round(W * 0.55), Math.round(Hh * 0.55)))];
    // C: the model redrew the face bigger and lower (a drifted face).
    cases.drift = [url(draw(o, W, Hh)), url(draw(ai, W, Hh, (x, w, h) => { x.drawImage(ai, 380, 230, 330, 420, 365, 225, 360, 460); }))];
    // D: the original had clutter on the wall that the model cleaned up.
    cases.clutter = [url(draw(o, W, Hh, (x) => { x.fillStyle = '#3a2a22'; x.fillRect(880, 140, 120, 90); x.fillStyle = '#d9c7b5'; x.fillRect(60, 900, 40, 160); })), url(draw(ai, W, Hh))];
    if (photo) {
      const ph = await loadImg(photo), k = Math.min(1, 2048 / Math.max(ph.naturalWidth, ph.naturalHeight));
      const pw = Math.round(ph.naturalWidth * k), phh = Math.round(ph.naturalHeight * k);
      const graded = draw(ph, Math.round(pw * 0.5), Math.round(phh * 0.5), (x, w, h) => { x.globalCompositeOperation = 'soft-light'; x.fillStyle = 'rgba(255,190,120,0.55)'; x.fillRect(0, 0, w, h); });
      cases.photo = [url(draw(ph, pw, phh)), url(graded)];
    }
    const result = {};
    for (const [k, [src, a]] of Object.entries(cases)) {
      const t0 = performance.now(), r = await proFinish(src, a);
      result[k] = { src, ai: a, out: r.data, faces: r.faces, moved: r.moved, ms: Math.round(performance.now() - t0) };
    }
    return result;
  }, photo);
  for (const [k, r] of Object.entries(res)) {
    for (const n of ['src', 'ai', 'out']) fs.writeFileSync(path.join(out, `${k}-${n}.jpg`), Buffer.from(r[n].split(',')[1], 'base64'));
    console.log(k, 'faces', r.faces, 'moved', r.moved, r.ms + 'ms');
  }
  if (state.errs.length) console.log('errors', state.errs);
  await browser.close();
})();
