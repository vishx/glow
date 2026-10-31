// Glow badge on free saves, on white, black and busy pictures at three sizes: node tests/badge-shots.js outDir.
// Writes each badged picture's bottom-right corner, the first-save dialog, and one full photo. Mocked servers.
const H = require('./harness');
const path = require('path'), fs = require('fs');
const out = process.argv[2] || path.join(__dirname, 'out', 'badge');
fs.mkdirSync(out, { recursive: true });
const save = (f, d) => fs.writeFileSync(path.join(out, f), Buffer.from(d.split(',')[1], 'base64'));
(async () => {
  const { browser, p } = await H.launch({ start: 'editor', scheme: 'light', markIntro: true, viewport: { width: 390, height: 844 } });
  await p.goto('https://app.test/');
  const photo = 'data:image/jpeg;base64,' + fs.readFileSync(path.join(__dirname, '../public/samples/demo-v2/enhance.jpg')).toString('base64');
  const shots = await p.evaluate(async (photo) => {
    const img = await loadImg(photo), res = {};
    const fill = (w, h, kind) => { const c = newCanvas(w, h), x = c.getContext('2d');
      if (kind === 'white') { x.fillStyle = '#fbfbfb'; x.fillRect(0, 0, w, h); }
      else if (kind === 'black') { x.fillStyle = '#0a0a0a'; x.fillRect(0, 0, w, h); }
      else { const k = Math.max(w / img.naturalWidth, h / img.naturalHeight); x.drawImage(img, (w - img.naturalWidth * k) / 2, (h - img.naturalHeight * k) / 2, img.naturalWidth * k, img.naturalHeight * k); }
      return c.toDataURL('image/jpeg', 0.95); };
    for (const [w, h] of [[600, 400], [1080, 1350], [4032, 3024]]) for (const kind of ['white', 'black', 'photo']) {
      const m = await addMark(fill(w, h, kind), false), b = m.box, i = await loadImg(m.data);
      const cw = Math.round(b.w * 1.6 + b.h), ch = Math.round(b.h * 2.6), c = newCanvas(cw, ch);
      c.getContext('2d').drawImage(i, w - cw, h - ch, cw, ch, 0, 0, cw, ch);
      res[`${w}x${h}-${kind}`] = { crop: c.toDataURL('image/png'), box: b, line: m.line, full: kind === 'photo' && w === 1080 ? m.data : null };
    }
    return res;
  }, photo);
  for (const [k, v] of Object.entries(shots)) { save(`corner-${k}.png`, v.crop); if (v.full) save(`full-${k}.jpg`, v.full); console.log(k, JSON.stringify(v.box), v.line); }
  // The one-time dialog before the first free save, in the editor.
  const fc = p.waitForEvent('filechooser'); await p.click('#pickBtn'); await (await fc).setFiles(path.join(__dirname, '../public/samples/demo-v2/original.png'));
  await p.waitForFunction(() => screen === 'editorScreen' && $('before').naturalWidth > 0);
  const home = await p.evaluate(() => tabFor('filter:glow'));
  await p.click(`.tab[data-cat="${home[0]}"]`); await p.click('.tool[data-tool="filter:glow"]');
  await p.waitForFunction(() => !busyNow, null, { timeout: 30000 }); await p.click('#applyBtn');
  await p.waitForFunction(() => !busyNow && ed.idx > 0, null, { timeout: 30000 });
  await p.click('#saveBtn'); await p.waitForSelector('#ask[open] #askImg'); await p.waitForTimeout(400);
  await p.screenshot({ path: path.join(out, 'first-save-dialog.png') });
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
