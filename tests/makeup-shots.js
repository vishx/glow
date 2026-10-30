// Makeup and retouch review: renders every face tool and style on the sample portrait and saves
// a face crop of each, for checking by eye. node tests/makeup-shots.js [outDir] [tool,tool...].
// A headless-browser render, not a device capture.
const H = require('./harness');
const path = require('path'), fs = require('fs');
const out = process.argv[2] || path.join(__dirname, 'out', 'makeup');
const only = process.argv[3] ? process.argv[3].split(',') : null;
fs.mkdirSync(out, { recursive: true });
(async () => {
  const { browser, p } = await H.launch({ start: 'editor' });
  await p.goto('https://app.test/'); await p.waitForTimeout(500);
  const shots = await p.evaluate(async (only) => {
    const src = '/samples/demo-v2/original.png', res = {};
    const crop = async (data, eyes) => {   // the face (or just the eyes), 600 px wide
      const img = await loadImg(data), c = newCanvas(600, 640), x = c.getContext('2d');
      const W = img.naturalWidth, H = img.naturalHeight, sw = W * (eyes ? 0.4 : 0.46); x.drawImage(img, W * (eyes ? 0.3 : 0.27), H * (eyes ? 0.17 : 0.06), sw, sw * 640 / 600 * (eyes ? 0.5 : 1), 0, 0, 600, eyes ? 320 : 640);
      return c.toDataURL('image/jpeg', 0.9);
    };
    const orig = await loadImg(src), c0 = canvasFor(orig); c0.getContext('2d').drawImage(orig, 0, 0, c0.width, c0.height);
    const base = c0.toDataURL('image/png');
    res.original = await crop(base);
    const tools = ['fsmooth', 'fblemish', 'feyes', 'ftone', 'fskin', 'fundereye', 'fteeth', 'flips', 'fblush', 'flashes', 'fliner', 'fshadow', 'fbrows', 'feyecolor', 'fcontour', 'fhighlight', 'fbronzer', 'fglam', 'fauto'];
    for (const id of tools) {
      if (only && !only.includes(id)) continue;
      const styles = STYLES[id] ? STYLES[id].map((s) => s[1]).filter((s) => s !== 'mine') : [null];
      const shades = id === 'feyecolor' ? SHADES.feyecolor.slice(0, 4) : [null];
      for (const st of styles) for (const sh of shades) for (const a of [0.5, 1]) {
        if (st) faceSet.style[id] = st; if (sh) faceSet.shade[id] = sh;
        try { res[`${id}${st ? '-' + st : ''}${sh ? '-' + sh.slice(1) : ''}-${a * 100}`] = await crop(await faceEdit(base, id, a), ['feyes', 'flashes', 'fliner', 'fshadow', 'feyecolor', 'fbrows'].includes(id)); }
        catch (e) { res[`${id}-${st}-ERR`] = String(e.message); }
      }
      Object.assign(faceSet.style, STYLE_DEFAULTS); faceSet.shade = Object.fromEntries(Object.entries(SHADES).map(([k, v]) => [k, v[0]]));
    }
    return res;
  }, only);
  for (const [k, v] of Object.entries(shots)) {
    if (!v.startsWith('data:')) { console.log('ERROR', k, v); continue; }
    fs.writeFileSync(path.join(out, k + '.jpg'), Buffer.from(v.split(',')[1], 'base64'));
  }
  console.log(Object.keys(shots).length, 'images in', out);
  await browser.close();
})();
