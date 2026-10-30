// Face reshape review: renders Eye size, Face shape and Nose at 0/25/50/75/100 on the sample
// portrait and on variants of it (mirrored, tilted, wider, narrower, small in frame), next to
// the previous warps at 100, and measures each displacement field for folds.
// node tests/retouch.js [outDir]. A headless-browser render, not a device capture.
const H = require('./harness');
const path = require('path'), fs = require('fs');
const out = process.argv[2] || path.join(__dirname, 'out', 'retouch');
fs.mkdirSync(out, { recursive: true });
(async () => {
  const { browser, p, state } = await H.launch({ start: 'editor' });
  await p.goto('https://app.test/'); await p.waitForTimeout(500);
  await p.evaluate(async () => {
    const toData = (c) => c.toDataURL('image/png');
    const img = await loadImg('/samples/demo/original.png'), W = img.naturalWidth, H = img.naturalHeight;
    const variant = (w, h, draw) => { const c = newCanvas(w, h), x = c.getContext('2d'); x.fillStyle = '#7a7f86'; x.fillRect(0, 0, w, h); draw(x); return toData(c); };
    const V = {
      sample: variant(W, H, (x) => x.drawImage(img, 0, 0)),
      mirrored: variant(W, H, (x) => { x.translate(W, 0); x.scale(-1, 1); x.drawImage(img, 0, 0); }),
      tilted: variant(W, H, (x) => { x.translate(W / 2, H / 2); x.rotate(0.21); x.scale(1.15, 1.15); x.drawImage(img, -W / 2, -H / 2); }),
      wide: variant(Math.round(W * 1.2), H, (x) => x.drawImage(img, 0, 0, W * 1.2, H)),
      narrow: variant(Math.round(W * 0.85), H, (x) => x.drawImage(img, 0, 0, W * 0.85, H)),
      small: variant(W * 2, H * 2, (x) => x.drawImage(img, W * 0.6, H * 0.4)),
      cutoff: variant(W, Math.round(H * 0.32), (x) => x.drawImage(img, 0, -H * 0.18)),
    };
    // The previous warps, for the before/after comparison.
    const OLD = {
      fbigeyes(ctx, P, a) { [[33, 133, 468], [362, 263, 473]].forEach(([i, j, c]) => bulge(ctx, P[c], dist(P[i], P[j]) * 1.1, a * 0.28)); },
      fslim(ctx, P, a) { const fw = dist(P[234], P[454]), fc = mean(FACE.oval.map((i) => P[i])); for (const i of FACE.jaw) push(ctx, P[i], fw * 0.2, [(fc[0] - P[i][0]) * 0.07 * a, (fc[1] - P[i][1]) * 0.02 * a]); },
      fnose(ctx, P, a) { const fw = dist(P[234], P[454]); for (const i of [129, 358, 49, 279]) push(ctx, P[i], fw * 0.09, [(P[1][0] - P[i][0]) * 0.35 * a, 0]); },
    };
    async function oldEdit(src, tool, a) {
      const im = await loadImg(src), c = canvasFor(im), ctx = c.getContext('2d', { willReadFrequently: true }); ctx.drawImage(im, 0, 0, c.width, c.height);
      for (const f of await findFaces(src, c)) OLD[tool](ctx, f.map(([x, y]) => [x * c.width, y * c.height]), a);
      return toData(c);
    }
    // Smallest Jacobian determinant of the read-from map (1 = untouched; <= 0 would fold).
    function fold(src, w, h, P, tool) {
      const ctx = newCanvas(w, h).getContext('2d'), f = RESHAPE_FIELDS[tool](ctx, P, RESHAPE_MAX[tool]);
      const g = (x, y) => f.at(x, y) || [0, 0]; let min = Infinity, maxD = 0;
      for (let y = f.box.y0; y < f.box.y0 + f.box.h; y += 2) for (let x = f.box.x0; x < f.box.x0 + f.box.w; x += 2) {
        const a = g(x, y), bx = g(x + 1, y), by = g(x, y + 1);
        const det = (1 + bx[0] - a[0]) * (1 + by[1] - a[1]) - (bx[1] - a[1]) * (by[0] - a[0]);
        min = Math.min(min, det); maxD = Math.max(maxD, Math.hypot(a[0], a[1]));
        // the field must vanish at its box edge, so nothing outside moves
      }
      let edge = 0; const b = f.box;
      for (let x = b.x0; x < b.x0 + b.w; x += 3) edge = Math.max(edge, Math.hypot(...g(x, b.y0)), Math.hypot(...g(x, b.y0 + b.h - 1)));
      for (let y = b.y0; y < b.y0 + b.h; y += 3) edge = Math.max(edge, Math.hypot(...g(b.x0, y)), Math.hypot(...g(b.x0 + b.w - 1, y)));
      return { minDet: +min.toFixed(3), maxShiftPx: +maxD.toFixed(1), edgeShiftPx: +edge.toFixed(3) };
    }
    window.__rt = { V, oldEdit, fold, toData };
  });
  const res = { outp: {}, metrics: {}, errors: {} };
  for (const name of ['sample', 'mirrored', 'tilted', 'wide', 'narrow', 'small', 'cutoff']) {
    const r = await p.evaluate(async (name) => {
    const { V, oldEdit, fold, toData } = window.__rt, src = V[name];
    const tools = ['fslim', 'fnose', 'fbigeyes'], amts = [0, 0.25, 0.5, 0.75, 1], outp = {}, metrics = {}, errors = {};
    {
      const status = await reshapeStatus(src);
      metrics[name] = { status: status || 'ok' };
      if (status) { try { await faceEdit(src, 'fslim', 1); errors[name] = 'no error thrown'; } catch (e) { errors[name] = { unavailable: !!e.unavailable, msg: e.message }; } return { metrics, errors, outp }; }
      const im = await loadImg(src), c = canvasFor(im); c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
      const P = (await findFaces(src, c))[0].map(([x, y]) => [x * c.width, y * c.height]);
      const b = { x: Math.min(...FACE.oval.map((i) => P[i][0])), y: Math.min(...FACE.oval.map((i) => P[i][1])), x1: Math.max(...FACE.oval.map((i) => P[i][0])), y1: Math.max(...FACE.oval.map((i) => P[i][1])) };
      const pad = (b.x1 - b.x) * 0.35; outp[name] = { box: [b.x - pad, b.y - pad * 0.6, b.x1 - b.x + pad * 2, b.y1 - b.y + pad * 1.6], src, imgs: {} };
      metrics[name].zeroIdentical = (await faceEdit(src, 'fslim', 0)) === src;
      for (const t of tools) {
        metrics[name][t] = fold(src, c.width, c.height, P, t);
        for (const a of amts) outp[name].imgs[`${t}-${a * 100}`] = a ? await faceEdit(src, t, a) : src;
        outp[name].imgs[`${t}-old100`] = await oldEdit(src, t, 1);
      }
      let all = src; for (const t of tools) all = await faceEdit(all, t, 1);
      outp[name].imgs['combo-100'] = all;
      let allOld = src; for (const t of tools) allOld = await oldEdit(allOld, t, 1);
      outp[name].imgs['combo-old100'] = allOld;
      // Pixels outside each field's box must be untouched (PNG in, PNG out).
      const diffOutside = async (a, bSrc, box) => {
        const [ia, ib] = await Promise.all([loadImg(a), loadImg(bSrc)]), w = ia.naturalWidth, h = ia.naturalHeight;
        const ca = newCanvas(w, h).getContext('2d'), cb = newCanvas(w, h).getContext('2d'); ca.drawImage(ia, 0, 0); cb.drawImage(ib, 0, 0);
        const da = ca.getImageData(0, 0, w, h).data, db = cb.getImageData(0, 0, w, h).data; let n = 0;
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { if (x >= box.x0 && x < box.x0 + box.w && y >= box.y0 && y < box.y0 + box.h) continue; const i = (y * w + x) * 4; if (da[i] !== db[i] || da[i + 1] !== db[i + 1] || da[i + 2] !== db[i + 2]) n++; }
        return n;
      };
      for (const t of tools) metrics[name][t].changedOutsideBox = await diffOutside(outp[name].imgs[`${t}-100`], src, RESHAPE_FIELDS[t](c.getContext('2d'), P, RESHAPE_MAX[t]).box);
    }
    window.__cur = outp[name];
    return { outp: { [name]: { box: outp[name].box } }, metrics, errors };
    }, name);
    Object.assign(res.metrics, r.metrics); Object.assign(res.errors, r.errors);
    if (!r.outp[name]) continue;
    const o = null;
    const sheet = await p.evaluate(async () => {
      const o = window.__cur;
      const [bx, by, bw, bh] = o.box, cell = 300, ch = Math.round(cell * bh / bw), rows = [['fslim', 'Face shape'], ['fnose', 'Nose'], ['fbigeyes', 'Eye size'], ['combo', 'All three']];
      const cols = ['0', '25', '50', '75', '100', 'old100'], c = newCanvas(cols.length * cell + 120, rows.length * (ch + 8) + 30), x = c.getContext('2d');
      x.fillStyle = '#111'; x.fillRect(0, 0, c.width, c.height); x.fillStyle = '#fff'; x.font = '15px sans-serif';
      cols.forEach((k, i) => x.fillText(k === 'old100' ? 'Previous, 100' : `New, ${k}`, 120 + i * cell + 8, 20));
      for (const [r, [t, label]] of rows.entries()) {
        x.fillStyle = '#fff'; x.fillText(label, 8, 30 + r * (ch + 8) + ch / 2);
        for (const [i, k] of cols.entries()) {
          const key = t === 'combo' ? (k === '100' ? 'combo-100' : k === 'old100' ? 'combo-old100' : k === '0' ? null : 'skip') : `${t}-${k}`;
          if (key === 'skip') continue;
          const im = await loadImg(key ? o.imgs[key] : o.src); x.drawImage(im, bx, by, bw, bh, 120 + i * cell, 30 + r * (ch + 8), cell - 4, ch);
        }
      }
      return c.toDataURL('image/jpeg', 0.88);
    });
    fs.writeFileSync(path.join(out, `retouch-${name}.jpg`), Buffer.from(sheet.split(',')[1], 'base64'));
    // full-size before/after at 100 for each tool
    for (const t of ['fslim', 'fnose', 'fbigeyes']) {
      const pair = await p.evaluate(async (t) => {
        const o = window.__cur, [bx, by, bw, bh] = o.box, cw = 520, chh = Math.round(cw * bh / bw), c = newCanvas(cw * 2 + 12, chh + 36), x = c.getContext('2d');
        x.fillStyle = '#111'; x.fillRect(0, 0, c.width, c.height); x.fillStyle = '#fff'; x.font = '18px sans-serif';
        x.fillText('Before: previous warp at 100', 8, 24); x.fillText('After: new warp at 100', cw + 20, 24);
        x.drawImage(await loadImg(o.imgs[`${t}-old100`]), bx, by, bw, bh, 0, 36, cw, chh); x.drawImage(await loadImg(o.imgs[`${t}-100`]), bx, by, bw, bh, cw + 12, 36, cw, chh);
        return c.toDataURL('image/jpeg', 0.9);
      }, t);
      if (name === 'sample') fs.writeFileSync(path.join(out, `before-after-${t}.jpg`), Buffer.from(pair.split(',')[1], 'base64'));
    }
  }
  fs.writeFileSync(path.join(out, 'metrics.json'), JSON.stringify({ metrics: res.metrics, unavailable: res.errors }, null, 2));
  console.log(JSON.stringify({ metrics: res.metrics, unavailable: res.errors }, null, 1));
  if (state.errs.length) console.log('page errors', state.errs);
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
