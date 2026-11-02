// Enhance Result on phones, as the phone app shows it (status bar + gesture bar insets), for
// before/after review: node tests/enhance-result-shots.js outDir tag
const H = require('./harness');
const path = require('path'), fs = require('fs');
const out = process.argv[2] || path.join(__dirname, 'out', 'enh-result');
const tag = process.argv[3] || 'shot';
fs.mkdirSync(out, { recursive: true });
const SIZES = (process.env.SIZES || '411x891:39:24,390x844:47:34,360x780:32:24').split(',').map((s) => { const [wh, t, b] = s.split(':'); const [w, h] = wh.split('x').map(Number); return { w, h, top: +t, bottom: +b }; });
const PHOTOS = { tall: path.join(__dirname, 'fixtures/tall-916.jpg'), portrait: path.join(__dirname, '../public/samples/demo-v2/original.png') };
(async () => {
  const rows = [];
  for (const sz of SIZES) for (const [pn, photo] of Object.entries(PHOTOS)) {
    const { browser, p } = await H.launch({ start: 'enhance', camera: false, viewport: { width: sz.w, height: sz.h }, files: { '/__ai.jpg': photo } });
    await p.goto('https://app.test/'); await p.waitForFunction(() => screen === 'enhanceHome');
    await p.evaluate((sz) => { document.getElementById('splash')?.remove(); document.documentElement.style.setProperty('--safe-area-inset-top', sz.top + 'px'); document.documentElement.style.setProperty('--safe-area-inset-bottom', sz.bottom + 'px');
      for (const [id, css] of [['__sb', `top:0;height:${sz.top}px`], ['__gb', `bottom:0;height:${sz.bottom}px`]]) { const d = document.createElement('div'); d.id = id; d.style.cssText = `position:fixed;left:0;right:0;${css};background:#000;z-index:9999;pointer-events:none`; document.body.appendChild(d); } }, sz);
    const fc = p.waitForEvent('filechooser'); await p.click('#enhPick'); await (await fc).setFiles(photo);
    await p.waitForSelector('#enhSheet[open]'); await p.click('#enhGo');
    await p.waitForFunction(() => screen === 'enhanceResult' && $('enhAfter').naturalWidth > 0, null, { timeout: 60000 }); await p.waitForTimeout(1500);
    const m = () => p.evaluate(() => { const g = (s) => document.querySelector(s).getBoundingClientRect(); const f = g('#enhFrame'), top = g('#enhanceResult .enh-top'), dock = g('#enhDock'), tg = g('#enhToggles');
      const kids = [...document.querySelectorAll('#enhToggles > *')].filter((e) => e.offsetParent); const tb = kids.length ? Math.min(...kids.map((k) => k.getBoundingClientRect().top)) : tg.top;
      return { frameW: Math.round(f.width), frameH: Math.round(f.height), pct: Math.round(f.width * f.height / (innerWidth * innerHeight) * 100), gapAbove: Math.round(tb - f.bottom), dockH: Math.round(dock.height), sideGap: Math.round(f.left) }; });
    const name = `${sz.w}x${sz.h}-${pn}`;
    rows.push({ name, state: 'result', ...(await m()) }); await p.screenshot({ path: path.join(out, `${tag}-${name}-1-result.png`) });
    const t = await p.$('#enhToggles button:not(.on) >> nth=0'); if (t) { await t.click(); await p.waitForTimeout(500); await t.click().catch(() => {}); await p.waitForTimeout(600); }
    rows.push({ name, state: 'levels', ...(await m()) }); await p.screenshot({ path: path.join(out, `${tag}-${name}-2-levels.png`) });
    await browser.close();
  }
  console.table(rows);
  fs.writeFileSync(path.join(out, `${tag}-measure.json`), JSON.stringify(rows, null, 1));
})().catch((e) => { console.error(e); process.exit(1); });
