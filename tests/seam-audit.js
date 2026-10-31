// Seam audit: runs every on-device tool (each style, low and full strength, alone and stacked)
// on the sample portrait at its own size and at a 12-megapixel size, and looks for straight
// lines and patch edges the edit added. A straight seam shows as a spike in how much the change
// itself jumps from one row (or column) to the next. Saves a crop of anything flagged.
//   node tests/seam-audit.js [outDir] [soft]   ("soft" also checks the no-canvas-filter path)
// Headless Chromium, not a real phone.
const H = require('./harness');
const path = require('path'), fs = require('fs');
const out = process.argv[2] || path.join(__dirname, 'out', 'seams');
const soft = process.argv[3] === 'soft';
fs.mkdirSync(out, { recursive: true });
(async () => {
  const { browser, p } = await H.launch({ start: 'editor' });
  if (soft) await p.addInitScript(() => { globalThis.__glowSoftFilter = true; });
  await p.goto('https://app.test/'); await p.waitForTimeout(500);
  const res = await p.evaluate(async () => {
    const orig = await loadImg('/samples/demo-v2/original.png');
    const sizes = [[orig.naturalWidth, orig.naturalHeight], [3024, 4032]];
    const report = [], flagged = {};
    // How sharply the change jumps between neighbouring rows/columns, compared with its usual jump.
    const seams = async (a, b) => {
      const [A, B] = await Promise.all([loadImg(a), loadImg(b)]), w = 540, h = Math.round(540 * A.naturalHeight / A.naturalWidth);
      const px = (im) => { const c = newCanvas(w, h), x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(im, 0, 0, w, h); return x.getImageData(0, 0, w, h).data; };
      const da = px(A), db = px(B), D = new Float32Array(w * h), L = new Float32Array(w * h);
      for (let i = 0; i < w * h; i++) L[i] = lum(da[i * 4], da[i * 4 + 1], da[i * 4 + 2]);
      for (let i = 0; i < w * h; i++) D[i] = lum(db[i * 4], db[i * 4 + 1], db[i * 4 + 2]) - lum(da[i * 4], da[i * 4 + 1], da[i * 4 + 2]);
      const score = (n, m, at) => {   // n lines of length m
        const s = [];
        for (let y = 0; y < n - 1; y++) {
          // The longest straight run where the change jumps by more than 3 levels.
          let run = 0, best = 0;
          // Only where the photo itself is smooth there: an edge already in the photo may change by
          // different amounts on its two sides without being a seam.
          for (let x = 0; x < m; x++) { if (Math.abs(D[at(y + 1, x)] - D[at(y, x)]) > 3 && Math.abs(L[at(y + 1, x)] - L[at(y, x)]) < 4) { run++; best = Math.max(best, run); } else run = 0; }
          s.push(best / m);
        }
        return s;
      };
      const rows = score(h, w, (y, x) => y * w + x), cols = score(w, h, (x, y) => y * w + x);
      const mr = Math.max(...rows), mc = Math.max(...cols), changed = D.reduce((s, v) => s + (Math.abs(v) > 2 ? 1 : 0), 0) / D.length;
      return { row: +mr.toFixed(3), rowAt: rows.indexOf(mr) / h, col: +mc.toFixed(3), colAt: cols.indexOf(mc) / w, changed: +changed.toFixed(3) };
    };
    const jobs = [];
    const faceTools = Object.keys(FACE_DEFAULTS).filter((id) => !['fglam'].includes(id) && TOOL[id] && TOOL[id].kind === 'face');
    for (const id of Object.keys(FACE_DEFAULTS).filter((id) => TOOL[id] && TOOL[id].kind === 'body')) jobs.push([id, (b) => bodyEdit(b, id, 1).catch((e) => { if (/body|pose|person/i.test(e.message)) return b; throw e; })]);
    for (const id of faceTools) {
      const styles = STYLES[id] ? STYLES[id].map((s) => s[1]).filter((s) => s !== 'mine') : [null];
      for (const st of styles) jobs.push([`${id}${st ? '-' + st : ''}`, async (b) => { if (st) faceSet.style[id] = st; try { return await faceEdit(b, id, RESHAPE_TOOLS.includes(id) ? 1 : 1); } finally { Object.assign(faceSet.style, STYLE_DEFAULTS); } }]);
    }
    for (const lk of STYLES.fglam.map((s) => s[1]).filter((s) => s !== 'mine')) jobs.push([`look-${lk}`, async (b) => { faceSet.style.fglam = lk; try { return await faceEdit(b, 'fglam', 1); } finally { Object.assign(faceSet.style, STYLE_DEFAULTS); } }]);
    jobs.push(['glowup-default', (b) => { glow = glowDefaults(); return glowUp(b, glowRecipe()); }]);
    jobs.push(['glowup-everything-softglam', (b) => { glow = glowDefaults(); for (const k in glow.on) glow.on[k] = true; glow.look = 'soft'; glow.slim = true; glow.strength = 100; return glowUp(b, glowRecipe()); }]);
    jobs.push(['hair-color', (b) => hairColor(b, 0.8, '#8e3b2e')]);
    for (const k of ['light', 'contrast', 'highlights', 'shadows', 'color', 'vibrance', 'warmth', 'tint', 'detail', 'fade', 'vignette', 'grain'])
      for (const v of [-50, 50]) jobs.push([`adjust-${k}${v}`, (b) => adjust(b, k, v)]);
    for (const f of FILTERS) jobs.push([`filter-${f.id}`, (b) => applyFilter(b, f)]);
    jobs.push(['bg-blur', (b) => backdrop(b, 'blur')]);
    jobs.push(['bg-white', (b) => backdrop(b, BG_FILLS.bgwhite)]);
    jobs.push(['bg-sky', (b) => backdrop(b, BG_FILLS.bgsky)]);
    jobs.push(['stack-glow-filter-vignette', async (b) => adjust(await applyFilter(await glowUp(b, (glow = glowDefaults(), glow.look = 'night', glowRecipe())), FILTERS[2]), 'vignette', 40)]);
    for (const [W, H] of sizes) {
      IMG_MAX = Math.max(W, H);
      const c = newCanvas(W, H); c.getContext('2d').drawImage(orig, 0, 0, W, H);
      const base = c.toDataURL('image/jpeg', 0.95);
      for (const [name, fn] of jobs) {
        if (W > 2000 && !/^(f|glowup|look|stack|bg)/.test(name)) continue;   // the size-dependent ones
        try {
          const r = await fn(base); if (!r || r === base) { report.push({ name, W, skipped: 'no change' }); continue; }
          const s = await seams(base, r); report.push({ name, W, ...s });
          if (s.row > 0.12 || s.col > 0.12) {
            const im = await loadImg(r), cc = newCanvas(800, 800), x = cc.getContext('2d');
            const cy = s.row > s.col ? s.rowAt * im.naturalHeight : im.naturalHeight * 0.3, cx = s.row > s.col ? im.naturalWidth / 2 : s.colAt * im.naturalWidth, half = im.naturalWidth * 0.22;
            x.drawImage(im, cx - half, cy - half, half * 2, half * 2, 0, 0, 800, 800);
            flagged[`${name}-${W}`] = cc.toDataURL('image/jpeg', 0.9);
          }
        } catch (e) { report.push({ name, W, error: e.message }); }
        Object.assign(faceSet.style, STYLE_DEFAULTS);
      }
    }
    IMG_MAX = 2048;
    return { report, flagged };
  });
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(res.report, null, 1));
  for (const [k, v] of Object.entries(res.flagged)) fs.writeFileSync(path.join(out, k + '.jpg'), Buffer.from(v.split(',')[1], 'base64'));
  const bad = res.report.filter((r) => r.row > 0.12 || r.col > 0.12), err = res.report.filter((r) => r.error);
  console.log(`${res.report.length} renders, ${bad.length} flagged, ${err.length} errors`);
  for (const r of [...bad, ...err]) console.log(JSON.stringify(r));
  await browser.close();
  process.exit(bad.length || err.length ? 1 : 0);
})();
