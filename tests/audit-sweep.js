// Whole-app layout sweep (mocked browser): visits every main screen and sheet at phone, small phone,
// landscape and tablet sizes, in dark and light, and with Android's large system text emulated, and
// reports what doesn't fit: sideways page scroll, controls cut off by the screen edge, controls on top
// of each other, and button labels that are clipped.
// node tests/audit-sweep.js [outDir]   (AUDIT_ONLY=390x844 limits sizes; AUDIT_SHOTS=1 saves screenshots)
const H = require('./harness');
const path = require('path'), fs = require('fs');
const out = process.argv[2] || path.join(__dirname, 'out/audit');
fs.mkdirSync(out, { recursive: true });
const SAMPLE = path.join(__dirname, '../public/samples/demo-v2/original.png');
const SIZES = [
  { name: 'phone', w: 390, h: 844 }, { name: 'small', w: 320, h: 568 }, { name: 'land', w: 844, h: 390 }, { name: 'landbig', w: 932, h: 430 },
  { name: 'tablet', w: 768, h: 1024 }, { name: 'tabland', w: 1180, h: 820 }, { name: 'fold', w: 600, h: 900 },
];
const RUNS = [];
for (const s of SIZES) RUNS.push({ ...s, scheme: 'dark', zoom: 1 });
RUNS.push({ ...SIZES[0], scheme: 'light', zoom: 1 }, { ...SIZES[2], scheme: 'light', zoom: 1 });
RUNS.push({ ...SIZES[0], scheme: 'dark', zoom: 1.3 }, { name: 'phone360', w: 360, h: 740, scheme: 'dark', zoom: 1.3 }, { ...SIZES[2], scheme: 'dark', zoom: 1.3 });
const only = process.env.AUDIT_ONLY;

// Emulates Android's system font size (WebView text zoom): every font size grows by `z`.
const zoomText = (z) => { if (z === 1) return; for (const el of document.querySelectorAll('body *')) { if (el.dataset.fz) continue; const f = parseFloat(getComputedStyle(el).fontSize); el.dataset.fz = f; } for (const el of document.querySelectorAll('[data-fz]')) el.style.fontSize = (+el.dataset.fz * z) + 'px'; };

// Problems in the top layer (open dialog) or the visible screen.
const inspect = () => {
  const issues = [];
  const vw = innerWidth, vh = innerHeight;
  if (document.scrollingElement.scrollWidth > vw + 1) issues.push(`page scrolls sideways (${document.scrollingElement.scrollWidth}px)`);
  const dlg = [...document.querySelectorAll('dialog[open]')].pop();
  const root = dlg || document.querySelector('.screen:not([hidden])');
  if (!root) return { where: 'none', issues };
  const vis = (el) => { const cs = getComputedStyle(el); if (cs.visibility === 'hidden' || cs.display === 'none' || +cs.opacity === 0) return false; const r = el.getBoundingClientRect(); return r.width > 1 && r.height > 1 && !el.closest('[hidden]'); };
  // Clipped by a scrolling/hidden ancestor = fine if that ancestor scrolls.
  const scroller = (el) => { for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) { const cs = getComputedStyle(a); if (/(auto|scroll)/.test(cs.overflowX + cs.overflowY)) return a; } return null; };
  const ctl = [...root.querySelectorAll('button, a[href], input, select, [role=slider], [role=tab], [role=radio], [role=switch]')].filter(vis);
  const label = (el) => (el.id ? '#' + el.id : '') + (el.getAttribute('aria-label') || el.textContent || el.className || el.tagName).trim().replace(/\s+/g, ' ').slice(0, 40);
  // What of a box is really on screen: cut by every ancestor that clips (a scrolling list shows only its window).
  const clip = (el, r0) => { let r = { left: r0.left, top: r0.top, right: r0.right, bottom: r0.bottom };
    for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) { const cs = getComputedStyle(a); if (cs.overflowX === 'visible' && cs.overflowY === 'visible') continue;
      const q = a.getBoundingClientRect(); if (cs.overflowX !== 'visible') { r.left = Math.max(r.left, q.left); r.right = Math.min(r.right, q.right); } if (cs.overflowY !== 'visible') { r.top = Math.max(r.top, q.top); r.bottom = Math.min(r.bottom, q.bottom); } }
    r.width = r.right - r.left; r.height = r.bottom - r.top; return r; };
  const rects = ctl.map((el) => ({ el, r: clip(el, el.getBoundingClientRect()), sc: scroller(el) })).filter((x) => x.r.width > 1 && x.r.height > 1);
  for (const { el, r, sc } of rects) {
    if (sc) { const s = clip(sc, sc.getBoundingClientRect()); if (s.left < -1 || s.right > vw + 1 || s.top < -1 || s.bottom > vh + 1) issues.push(`scroll area offscreen: ${label(sc)} ${Math.round(s.top)}..${Math.round(s.bottom)}`); continue; }
    if (r.right > vw + 1 || r.left < -1 || r.bottom > vh + 1 || r.top < -1) issues.push(`offscreen: ${label(el)} [${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)}]`);
  }
  for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
    const a = rects[i], b = rects[j];
    if (a.el.contains(b.el) || b.el.contains(a.el) || a.el.closest('label') === b.el.closest('label') && a.el.closest('label')) continue;
    const x = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left), y = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
    if (x > 6 && y > 6 && x * y > 0.25 * Math.min(a.r.width * a.r.height, b.r.width * b.r.height)) {
      // Only if the top one really covers the other at its centre.
      const cx = Math.max(a.r.left, b.r.left) + x / 2, cy = Math.max(a.r.top, b.r.top) + y / 2, top = document.elementFromPoint(cx, cy);
      if (top && (a.el.contains(top) || b.el.contains(top))) issues.push(`overlap: ${label(a.el)} × ${label(b.el)}`);
    }
  }
  for (const el of root.querySelectorAll('button, h1, h2, .btn, label, p, b, span')) {
    if (!vis(el) || el.children.length > 2) continue;
    const cs = getComputedStyle(el);
    if ((cs.overflow === 'hidden' || cs.textOverflow === 'ellipsis' || cs.overflowX === 'hidden') && el.scrollWidth > el.clientWidth + 2 && el.textContent.trim().length > 2) issues.push(`text cut: ${label(el)} (${el.scrollWidth}>${el.clientWidth})`);
  }
  // Text spilling out of its box without overflow clipping (big text).
  for (const el of root.querySelectorAll('button, .btn')) {
    if (!vis(el)) continue;
    if (el.scrollHeight > el.clientHeight + 4 && getComputedStyle(el).overflow === 'visible' && el.clientHeight > 0) issues.push(`text spills: ${label(el)} (${el.scrollHeight}>${el.clientHeight})`);
  }
  return { where: dlg ? '#' + dlg.id : '#' + root.id, issues: [...new Set(issues)] };
};

(async () => {
  const report = [];
  for (const run of RUNS) {
    const tag = `${run.name}-${run.w}x${run.h}-${run.scheme}${run.zoom !== 1 ? '-text' + run.zoom : ''}`;
    if (only && !tag.includes(only)) continue;
    const { browser, p, state } = await H.launch({ start: 'enhance', scheme: run.scheme, viewport: { width: run.w, height: run.h },
      init: `try{localStorage.setItem('glowTheme','${run.scheme}')}catch(e){}` });
    const errs = []; p.on('pageerror', (e) => errs.push(String(e.message || e)));
    const shot = async (name) => {
      await p.evaluate(zoomText, run.zoom); await p.waitForTimeout(250);
      const r = await p.evaluate(inspect);
      report.push({ run: tag, state: name, ...r });
      if (process.env.AUDIT_SHOTS) await p.screenshot({ path: path.join(out, `${tag}--${name}.png`) });
    };
    const step = async (name, fn) => { try { await fn(); await shot(name); } catch (e) { report.push({ run: tag, state: name, where: 'error', issues: ['could not reach: ' + String(e.message).split('\n')[0]] }); } };
    const closeTop = () => p.evaluate(() => { for (const d of document.querySelectorAll('dialog[open]')) d.close(); });
    try {
      await p.goto('https://app.test/');
      await p.waitForFunction(() => window.screen === 'enhanceHome' || (typeof screen === 'string' && screen === 'enhanceHome'), null, { timeout: 15000 });
      await p.waitForTimeout(1500);
      await step('enhance-home', async () => {});
      await step('enhance-sheet', async () => { await p.click('#enhSample'); await p.waitForSelector('#enhSheet[open]'); });
      await step('enhance-result', async () => { await p.click('#enhGo'); await p.waitForFunction(() => screen === 'enhanceResult' && $('enhAfter').naturalWidth > 0, null, { timeout: 30000 }); await p.waitForTimeout(600); });
      await step('enhance-levels', async () => { const b = await p.$('#enhToggles button'); if (b) await b.click(); await p.waitForTimeout(400); });
      await step('enhance-share', async () => { await p.evaluate(() => { const b = $('enhLvDone'); if (b && !$('enhLevels').hidden) b.click(); }); await p.click('#enhDownload'); await p.waitForFunction(() => screen === 'enhanceShare', null, { timeout: 15000 }); await p.waitForTimeout(500); });
      await step('editor-home', async () => { await p.evaluate(() => go('editor')); await p.waitForTimeout(500); });
      await step('editor-photo', async () => {
        await p.evaluate(() => { if (typeof discardSession === 'function') {} });
        const fc = p.waitForEvent('filechooser'); await p.click('#pickBtn'); await (await fc).setFiles(SAMPLE);
        await p.waitForFunction(() => screen === 'editorScreen' && $('before').naturalWidth > 0, null, { timeout: 15000 }); await p.waitForTimeout(700);
      });
      const cats = await p.$$eval('.tab[data-cat]', (b) => b.map((x) => x.dataset.cat)).catch(() => []);
      for (const c of cats) {
        await step(`editor-tab-${c}`, async () => { await p.evaluate(() => { if (sel) $('cancelBtn').click(); }); await p.click(`.tab[data-cat="${c}"]`); await p.waitForTimeout(300); });
        await step(`editor-tool-${c}`, async () => { await p.evaluate(() => { const t = [...document.querySelectorAll('#tools .tool[data-tool]')].find((x) => x.offsetParent); if (t) t.click(); }); await p.waitForTimeout(500); });
      }
      await step('editor-tryon', async () => { await p.evaluate(() => { if (sel) $('cancelBtn').click(); if (TOOL.outfit) selectTool('outfit'); }); await p.waitForTimeout(600); });
      await p.evaluate(() => { if (sel) $('cancelBtn').click(); });
      await step('settings', async () => { await p.evaluate(() => openSettings()); await p.waitForTimeout(400); });
      await step('settings-bottom', async () => { await p.evaluate(() => { const s = $('settings'); const b = s.querySelector('.sheet-body, form, div') || s; s.scrollTop = 1e5; for (const e of s.querySelectorAll('*')) if (e.scrollHeight > e.clientHeight + 4) e.scrollTop = 1e5; }); await p.waitForTimeout(200); });
      await step('doc-help', async () => { await p.evaluate(() => { const b = [...$('settings').querySelectorAll('button, a')].find((x) => /help|support/i.test(x.textContent)); if (b) b.click(); }); await p.waitForTimeout(800); });
      await closeTop();
      await step('paywall', async () => { await p.evaluate(() => openPaywall()); await p.waitForTimeout(400); });
      await closeTop();
      await step('credits', async () => { await p.evaluate(() => openCredits()); await p.waitForTimeout(300); });
      await closeTop();
      await step('packs', async () => { await p.evaluate(() => openPacks()); await p.waitForTimeout(300); });
      await closeTop();
      await step('support', async () => { await p.evaluate(() => { const d = $('supportSheet'); d.showModal(); }); await p.waitForTimeout(300); });
      await closeTop();
      await step('ask', async () => { await p.evaluate(() => { ask({ title: 'Start a new edit?', text: "Your current edit hasn't been saved.", actions: [{ label: 'Save it first', value: 's' }, { label: 'Discard it', value: 'd', kind: 'ghost' }, { label: 'Keep editing', value: '', kind: 'ghost' }] }); }); await p.waitForTimeout(300); });
      await closeTop();
      await step('batch', async () => { await p.evaluate(() => { if (typeof showScreen === 'function') showScreen('enhanceBatch'); }); await p.waitForTimeout(300); });
      await step('onboarding', async () => { await p.evaluate(() => showOnboarding()); await p.waitForTimeout(400); });
    } catch (e) { report.push({ run: tag, state: 'fatal', where: 'error', issues: [String(e.message).split('\n')[0]] }); }
    if (errs.length) report.push({ run: tag, state: 'page errors', where: '', issues: [...new Set(errs)] });
    await browser.close();
    const bad = report.filter((r) => r.run === tag && r.issues.length);
    console.log(`${tag}: ${bad.length} states with issues`);
  }
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 1));
  for (const r of report) if (r.issues.length) console.log(`\n[${r.run}] ${r.state} ${r.where}\n  - ` + r.issues.join('\n  - '));
})().catch((e) => { console.error(e); process.exit(1); });
