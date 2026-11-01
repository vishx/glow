// Measures how much of a phone screen the photo gets in the editor, for every tool (mocked browser):
// node tests/layout-measure.js [width] [height] [shotsDir]
const H = require('./harness');
const path = require('path'), fs = require('fs');
const W = +process.argv[2] || 390, Hh = +process.argv[3] || 844, out = process.argv[4];
if (out) fs.mkdirSync(out, { recursive: true });
const PORTRAIT = process.env.PORTRAIT || path.join(__dirname, '../public/samples/demo-v2/original.png');
(async () => {
  const { browser, p } = await H.launch({ start: 'editor', scheme: 'light', viewport: { width: W, height: Hh } });
  await p.goto('https://app.test/');
  const fc = p.waitForEvent('filechooser'); await p.click('#pickBtn'); await (await fc).setFiles(PORTRAIT);
  await p.waitForFunction(() => screen === 'editorScreen' && $('before').naturalWidth > 0); await p.waitForTimeout(600);
  const m = () => p.evaluate(() => {
    const s = $('stage').getBoundingClientRect(), img = $('before').getBoundingClientRect(), vb = document.querySelector('.viewbar').getBoundingClientRect();
    const ov = vb.bottom > img.top && vb.top < img.bottom && getComputedStyle(document.querySelector('.viewbar')).display !== 'none' ? Math.round(Math.min(vb.bottom, img.bottom) - Math.max(vb.top, img.top)) : 0;
    return { stage: Math.round(s.height), photo: Math.round(img.height), pct: Math.round(img.width * img.height / (innerWidth * innerHeight) * 100), cover: ov, scroll: document.scrollingElement.scrollHeight > innerHeight + 1 };
  });
  const rows = [];
  rows.push({ tool: '(browse)', ...(await m()) });
  if (out) await p.screenshot({ path: path.join(out, '00-browse.png') });
  const cats = await p.$$eval('.tab[data-cat]', (b) => b.map((x) => x.dataset.cat));
  let n = 1;
  for (const c of cats) {
    await p.click(`.tab[data-cat="${c}"]`); await p.waitForTimeout(150);
    const tools = await p.$$eval('#tools .tool[data-tool]', (b) => [...new Set(b.map((x) => x.dataset.tool))]);
    for (const t of tools) {
      if (await p.evaluate(() => !!sel)) { await p.evaluate(() => $('cancelBtn').click()); await p.waitForTimeout(150); }
      if (!(await p.$(`#tools .tool[data-tool="${t}"]`)) || !(await p.isVisible(`#tools .tool[data-tool="${t}"]`))) { await p.click(`.tab[data-cat="${c}"]`); await p.waitForTimeout(100); }
      await p.evaluate((t) => document.querySelector(`#tools .tool[data-tool="${t}"]`).click(), t); await p.waitForTimeout(400);
      if (!(await p.evaluate(() => !!sel))) continue;
      rows.push({ tool: `${c}/${t}`, ...(await m()) });
      if (out) await p.screenshot({ path: path.join(out, `${String(n++).padStart(2, '0')}-${c}-${t}.png`) });
    }
    if (await p.evaluate(() => !!sel)) { await p.evaluate(() => $('cancelBtn').click()); await p.waitForTimeout(150); }
  }
  console.table(rows);
  const ed = rows.slice(1);
  console.log(JSON.stringify({ W, H: Hh, minPhoto: Math.min(...ed.map((r) => r.photo)), maxPhoto: Math.max(...ed.map((r) => r.photo)), distinct: [...new Set(ed.map((r) => r.photo))], covered: ed.filter((r) => r.cover).length, scroll: ed.filter((r) => r.scroll).length }));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
