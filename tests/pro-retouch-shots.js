// Pro Retouch's spot-fix merge (engine.js proRetouch / retouchSpots) on stand-in model results.
// node tests/pro-retouch-shots.js [outDir]. A headless-browser render, not a device capture.
// The sample portrait gets made-up flaws (red spots, dark spots, stray hairs); the "model's
// retouched sheet" is the clean portrait's sheet, so a perfect merge takes every flaw away and
// changes nothing else. Two more cases check the guards: a sheet whose face changed shape (the
// person must be skipped) and a sheet where the model added things (they must not come in).
// GLOW_TEST_RETOUCH_SHEET=/path/to/retouched.png also runs a real model sheet (made from the
// flawed sheet saved as flawed-sheet.jpg).
const H = require('./harness');
const path = require('path'), fs = require('fs');
const out = process.argv[2] || path.join(__dirname, 'out', 'pro-retouch');
fs.mkdirSync(out, { recursive: true });
const real = process.env.GLOW_TEST_RETOUCH_SHEET, realSrc = process.env.GLOW_TEST_RETOUCH_SRC;
(async () => {
  const { browser, p, state } = await H.launch({ start: 'editor' });
  await p.goto('https://app.test/'); await p.waitForTimeout(500);
  const toUrl = (f) => f && 'data:image/' + (f.endsWith('.png') ? 'png' : 'jpeg') + ';base64,' + fs.readFileSync(f).toString('base64');
  const res = await p.evaluate(async ({ realSheet, realPhoto }) => {
    const url = (c, q = 0.95) => c.toDataURL('image/jpeg', q);
    const o = await loadImg(realPhoto || '/samples/demo-v2/original.png'), W = o.naturalWidth, Hh = o.naturalHeight;
    const clean = newCanvas(W, Hh); clean.getContext('2d').drawImage(o, 0, 0);
    const cleanUrl = url(clean);
    const [P0] = (await findFaces(cleanUrl + '|t', clean)).map((f) => f.map(([x, y]) => [x * W, y * Hh]));
    const faceW = dist(P0[234], P0[454]);
    // Flaws on the skin: spots on the cheeks, forehead and chin, and stray hairs across the forehead.
    const flawed = newCanvas(W, Hh), fx = flawed.getContext('2d'); fx.drawImage(o, 0, 0);
    const spots = [[50, 0.2, 0.05], [280, -0.15, 0.07], [117, 0.05, -0.04], [346, -0.08, 0.03], [151, 0.12, 0.02], [9, -0.1, 0.01], [199, 0.06, 0.02], [205, 0, 0.05], [425, 0.03, -0.02]];
    let rnd = 7; const r = () => ((rnd = (rnd * 16807) % 2147483647) / 2147483647);
    for (const [i, dx, dy] of spots) {
      const c = [P0[i][0] + dx * faceW, P0[i][1] + dy * faceW], rad = faceW * (0.012 + 0.012 * r());
      const g = fx.createRadialGradient(c[0], c[1], 0, c[0], c[1], rad);
      const red = r() > 0.4; g.addColorStop(0, red ? 'rgba(170,40,40,0.75)' : 'rgba(70,40,30,0.7)'); g.addColorStop(1, 'rgba(170,40,40,0)');
      fx.fillStyle = g; fx.beginPath(); fx.arc(c[0], c[1], rad, 0, 7); fx.fill();
    }
    fx.strokeStyle = 'rgba(40,25,18,0.8)'; fx.lineWidth = Math.max(1, faceW / 260);
    for (let k = 0; k < 4; k++) {
      const a = P0[10], x0 = a[0] - faceW * 0.25 + k * faceW * 0.13, y0 = a[1] - faceW * 0.05;
      fx.beginPath(); fx.moveTo(x0, y0); fx.bezierCurveTo(x0 + faceW * 0.05, y0 + faceW * 0.08, x0 - faceW * 0.04, y0 + faceW * 0.14, x0 + faceW * 0.06, y0 + faceW * 0.22); fx.stroke();
    }
    const flawedUrl = url(flawed);
    // The sheet the phone sends (built from the flawed photo), and stand-in model answers.
    const sheet = await faceSheet(flawedUrl, null, true);
    // The clean photo cut into the very same squares (a model answers on the sheet it was sent).
    const variant = async (f) => {
      const c = newCanvas(sheet.w, Math.round(sheet.w / sheet.cols * Math.ceil(sheet.cells.length / sheet.cols))), x = c.getContext('2d');
      x.imageSmoothingQuality = 'high';
      sheet.cells.forEach((cl, i) => { const side = cl.side * W; x.drawImage(clean, cl.cx * W - side / 2, cl.cy * Hh - side / 2, side, side, (i % sheet.cols) * sheet.cell, Math.floor(i / sheet.cols) * sheet.cell, sheet.cell, sheet.cell); });
      f && f(x, c); return c.toDataURL('image/jpeg', 0.9);
    };
    const C = sheet.cell, cases = { clean: await variant() };
    // The model reshaped the face (the eyes and jaw moved): the person must be skipped.
    cases.reshaped = await variant((x, c) => { const t = newCanvas(c.width, c.height); t.getContext('2d').drawImage(c, 0, 0); x.clearRect(0, 0, c.width, c.height); x.drawImage(t, 0, 0, C, C, -C * 0.03, -C * 0.05, C * 1.06, C * 1.08); });
    // The model added things (a dark mark on the cheek, darker lips): none of it may come in.
    cases.added = await variant((x) => {
      const sx = (pt) => [(pt[0] - (sheet.cells[0].cx * W - sheet.cells[0].side * W / 2)) / (sheet.cells[0].side * W) * C, (pt[1] - (sheet.cells[0].cy * Hh - sheet.cells[0].side * W / 2)) / (sheet.cells[0].side * W) * C];
      const k = C / (sheet.cells[0].side * W), m = sx(P0[187]);
      x.fillStyle = 'rgba(30,20,20,0.85)'; x.beginPath(); x.arc(m[0], m[1], faceW * 0.02 * k, 0, 7); x.fill();
      x.fillStyle = 'rgba(120,10,40,0.6)'; x.beginPath(); FACE.lipsOut.map((i) => sx(P0[i])).forEach(([a, b], i) => (i ? x.lineTo(a, b) : x.moveTo(a, b))); x.fill();
    });
    if (realSheet) cases.real = realSheet;
    // How much of each flaw is left: mean difference from the clean photo inside the flaws, and
    // the change outside them (should stay near zero).
    const px = async (u) => { const im = await loadImg(u), c = newCanvas(W, Hh), x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(im, 0, 0, W, Hh); return x.getImageData(0, 0, W, Hh).data; };
    const Cd = await px(cleanUrl), Fd = await px(flawedUrl);
    const score = (Od) => {
      let fin = 0, fn = 0, fout = 0, on = 0;
      for (let i = 0; i < Cd.length; i += 4) {
        const flaw = Math.abs(Fd[i] - Cd[i]) + Math.abs(Fd[i + 1] - Cd[i + 1]) > 12;
        const d = (Math.abs(Od[i] - Cd[i]) + Math.abs(Od[i + 1] - Cd[i + 1]) + Math.abs(Od[i + 2] - Cd[i + 2])) / 3;
        if (flaw) { fin += d; fn++; } else { const dd = (Math.abs(Od[i] - Fd[i]) + Math.abs(Od[i + 1] - Fd[i + 1]) + Math.abs(Od[i + 2] - Fd[i + 2])) / 3; fout += dd; on++; }
      }
      return { flawLeft: +(fin / fn).toFixed(2), changedElsewhere: +(fout / on).toFixed(3) };
    };
    const result = { before: score(Fd), sheet: sheet.data, flawed: flawedUrl, cases: {} };
    for (const [k, rt] of Object.entries(cases)) {
      const t0 = performance.now(), r2 = await proRetouch(flawedUrl, sheet, rt);
      result.cases[k] = { out: r2.data, rt, people: r2.people, skipped: r2.skipped, why: r2.why, ms: Math.round(performance.now() - t0), ...score(await px(r2.data)) };
    }
    return result;
  }, { realSheet: toUrl(real), realPhoto: toUrl(realSrc) });
  fs.writeFileSync(path.join(out, 'flawed.jpg'), Buffer.from(res.flawed.split(',')[1], 'base64'));
  fs.writeFileSync(path.join(out, 'flawed-sheet.jpg'), Buffer.from(res.sheet.split(',')[1], 'base64'));
  console.log('before', JSON.stringify(res.before));
  for (const [k, r] of Object.entries(res.cases)) {
    fs.writeFileSync(path.join(out, `${k}-out.jpg`), Buffer.from(r.out.split(',')[1], 'base64'));
    console.log(k, JSON.stringify({ people: r.people, skipped: r.skipped, why: r.why, ms: r.ms, flawLeft: r.flawLeft, changedElsewhere: r.changedElsewhere }));
  }
  if (state.errs.length) console.log('errors', state.errs);
  await browser.close();
})();
