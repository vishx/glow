// Editor layout on phones, as the phone app shows it (status bar + gesture bar insets), for
// before/after review: node tests/premium-layout-shots.js outDir tag
// Opens the sample, then several tools, and measures the photo, overlaps and clipped panels.
const H = require('./harness');
const path = require('path'), fs = require('fs');
const out = process.argv[2] || path.join(__dirname, 'out', 'premium');
const tag = process.argv[3] || 'shot';
fs.mkdirSync(out, { recursive: true });
const SIZES = (process.env.SIZES || '411x891:39:24,390x844:47:34,360x780:32:24').split(',').map((s) => { const [wh, t, b] = s.split(':'); const [w, h] = wh.split('x').map(Number); return { w, h, top: +t, bottom: +b }; });
const TOOLS = (process.env.TOOLS || 'glowup,exposure,fsmooth,filters,bgcolor,outfit,erase,crop').split(',');
async function measure(p) {
  return p.evaluate(() => {
    const r = (el) => el && getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden' && el.offsetParent !== null ? el.getBoundingClientRect() : null;
    const st = $('stage').getBoundingClientRect(), b = $('before'), a = $('after'), m = !a.hidden && a.naturalWidth ? a : b;
    const s = Math.min(st.width / m.naturalWidth, st.height / m.naturalHeight);
    const pw = m.naturalWidth * s, ph = m.naturalHeight * s;
    const photo = { left: st.left + (st.width - pw) / 2, top: st.top + (st.height - ph) / 2, right: st.left + (st.width + pw) / 2, bottom: st.top + (st.height + ph) / 2 };
    const hit = (x, y) => x && y && x.left < y.right - 1 && x.right > y.left + 1 && x.top < y.bottom - 1 && x.bottom > y.top + 1;
    const things = { viewbar: r(document.querySelector('.viewbar')), badge: r($('demoNote')), expand: r($('expandView')), area: r($('areaBar')), topbar: r(document.querySelector('#editorScreen .topbar')) };
    const clashes = [];
    const names = Object.keys(things);
    for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) if (hit(things[names[i]], things[names[j]]) && !([names[i], names[j]].includes('topbar') && [names[i], names[j]].includes('viewbar'))) clashes.push(names[i] + '/' + names[j]);
    if (hit(things.viewbar, photo)) clashes.push('viewbar/photo');
    const body = $('panelBody'), panel = $('panel');
    let clipped = 0;
    if (panel && !panel.hidden) {
      const act = panel.querySelector('.panel-actions'), ar = act && act.getBoundingClientRect();
      for (const el of body.querySelectorAll('button, input, label')) { const q = el.getBoundingClientRect(); if (!q.height) continue; const bb = body.getBoundingClientRect();
        if (q.top < bb.bottom && q.bottom > bb.bottom + 1 && getComputedStyle(body).overflowY === 'visible') clipped++;
        if (ar && q.bottom > ar.top + 1 && q.top < ar.top && q.bottom <= bb.bottom + 1) clipped++; }
    }
    return { photoH: Math.round(ph), photoW: Math.round(pw), pct: Math.round(pw * ph / (innerWidth * innerHeight) * 100), stageTop: Math.round(st.top), stageH: Math.round(st.height), clashes: clashes.join(' ') || '-', clipped, scroll: document.scrollingElement.scrollHeight > innerHeight + 1 };
  });
}
async function openTool(p, t) {
  if (t === 'filters') { await p.click('.tab[data-cat="looks"]'); await p.waitForTimeout(150); const c = await p.$('.subchip[data-chip="filters"]'); if (c) await c.click(); await p.waitForTimeout(250);
    const f = await p.$('#tools .tool[data-tool]:not([data-tool="outfit"]):visible'); if (f) await f.click(); await p.waitForTimeout(600); return true; }
  for (const cat of await p.$$eval('.tab[data-cat]', (b) => b.map((x) => x.dataset.cat))) {
    await p.click(`.tab[data-cat="${cat}"]`); await p.waitForTimeout(120);
    const chips = await p.$$eval('#subchips .subchip', (b) => b.map((x) => x.dataset.chip));
    for (const ch of [null, ...chips]) {
      if (ch) { await p.click(`.subchip[data-chip="${ch}"]`); await p.waitForTimeout(100); }
      if (await p.isVisible(`#tools .tool[data-tool="${t}"]`)) { await p.click(`#tools .tool[data-tool="${t}"]`); await p.waitForTimeout(800); return true; }
    }
  }
  console.log('not found', t); return false;
}
(async () => {
  const rows = [];
  for (const sz of SIZES) {
    const { browser, p } = await H.launch({ start: 'editor', viewport: { width: sz.w, height: sz.h }, dpr: 2 });
    await p.addInitScript((sz) => { document.documentElement.style.setProperty('--safe-area-inset-top', sz.top + 'px'); document.documentElement.style.setProperty('--safe-area-inset-bottom', sz.bottom + 'px'); }, sz);
    await p.goto('https://app.test/');
    await p.evaluate((sz) => { document.documentElement.style.setProperty('--safe-area-inset-top', sz.top + 'px'); document.documentElement.style.setProperty('--safe-area-inset-bottom', sz.bottom + 'px'); }, sz);
    if (process.env.OWN) { const fc = p.waitForEvent('filechooser'); await p.click('#pickBtn'); await (await fc).setFiles(path.join(__dirname, '../public/samples/demo-v2/original.png')); }
    else await p.click('#sampleBtn:visible, #qaSampleBtn:visible'); await p.waitForFunction(() => screen === 'editorScreen' && $('before').naturalWidth > 0); await p.waitForTimeout(900);
    const name = `${sz.w}x${sz.h}`;
    // Fake status bar and gesture bar so the shots look like the phone.
    const bars = () => p.evaluate((sz) => { for (const [id, css] of [['__sb', `top:0;height:${sz.top}px`], ['__gb', `bottom:0;height:${sz.bottom}px`]]) { let d = document.getElementById(id); if (!d) { d = document.createElement('div'); d.id = id; document.body.appendChild(d); }
      d.style.cssText = `position:fixed;left:0;right:0;${css};background:#000;z-index:9999;pointer-events:none`; } }, sz);
    await bars();
    rows.push({ size: name, tool: '(browse)', ...(await measure(p)) });
    await p.screenshot({ path: path.join(out, `${tag}-${name}-00-browse.png`) });
    let n = 1;
    for (const t of TOOLS) {
      if (await p.evaluate(() => !!sel)) { await p.evaluate(() => $('cancelBtn').click()); await p.waitForTimeout(250); }
      await openTool(p, t); await bars();
      rows.push({ size: name, tool: t, ...(await measure(p)) });
      await p.screenshot({ path: path.join(out, `${tag}-${name}-${String(n++).padStart(2, '0')}-${t}.png`) });
      if (process.env.SHEET && await p.isVisible('#dockGrip')) { await p.click('#dockGrip'); await p.waitForTimeout(400);
        rows.push({ size: name, tool: t + ' (lifted)', ...(await measure(p)) });
        await p.screenshot({ path: path.join(out, `${tag}-${name}-${String(n++).padStart(2, '0')}-${t}-lifted.png`) });
        await p.click('#dockGrip'); await p.waitForTimeout(300); }
    }
    await browser.close();
  }
  console.table(rows);
  fs.writeFileSync(path.join(out, `${tag}-measure.json`), JSON.stringify(rows, null, 1));
})().catch((e) => { console.error(e); process.exit(1); });
