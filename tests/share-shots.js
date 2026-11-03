// The Share sheet on phones (status bar + gesture bar insets), for review: node tests/share-shots.js outDir
const H = require('./harness');
const path = require('path'), fs = require('fs');
const out = process.argv[2] || path.join(__dirname, 'out', 'share');
fs.mkdirSync(out, { recursive: true });
const SIZES = (process.env.SIZES || '390x844:47:34,360x780:32:24,844x390:0:21').split(',').map((s) => { const [wh, t, b] = s.split(':'); const [w, h] = wh.split('x').map(Number); return { w, h, top: +t, bottom: +b }; });
const photo = path.join(__dirname, '../public/samples/demo-v2/original.png');
(async () => {
  for (const sz of SIZES) {
    const { browser, p } = await H.launch({ start: 'enhance', camera: false, viewport: { width: sz.w, height: sz.h }, files: { '/__ai.jpg': photo } });
    await p.goto('https://app.test/'); await p.waitForFunction(() => screen === 'enhanceHome');
    await p.evaluate((sz) => { document.getElementById('splash')?.remove(); document.documentElement.style.setProperty('--safe-area-inset-top', sz.top + 'px'); document.documentElement.style.setProperty('--safe-area-inset-bottom', sz.bottom + 'px');
      for (const [id, css] of [['__sb', `top:0;height:${sz.top}px`], ['__gb', `bottom:0;height:${sz.bottom}px`]]) { const d = document.createElement('div'); d.id = id; d.style.cssText = `position:fixed;left:0;right:0;${css};background:#000;z-index:9999;pointer-events:none`; document.body.appendChild(d); }
      window.__shared = []; navigator.canShare = () => true; navigator.share = async (d) => { window.__shared.push(d.files.length); }; }, sz);
    const fc = p.waitForEvent('filechooser'); await p.click('#enhPick'); await (await fc).setFiles(photo);
    await p.waitForSelector('#enhSheet[open]'); await p.click('#enhGo');
    await p.waitForFunction(() => screen === 'enhanceResult' && $('enhAfter').naturalWidth > 0, null, { timeout: 60000 }); await p.waitForTimeout(1200);
    await p.click('#enhDownload'); await p.waitForFunction(() => screen === 'enhanceShare'); await p.waitForTimeout(900);
    const n = `${sz.w}x${sz.h}`;
    await p.screenshot({ path: path.join(out, `${n}-1-saved.png`) });
    await p.click('#enhShareBtn'); await p.waitForSelector('#shareSheet[open]'); await p.waitForSelector('#shFormats button:has-text("Video")'); await p.waitForTimeout(500);
    await p.screenshot({ path: path.join(out, `${n}-2-sheet-photo.png`) });
    await p.click('#shFormats button:has-text("Before & after")'); await p.waitForFunction(() => !$('shShare').disabled); await p.waitForTimeout(400);
    await p.screenshot({ path: path.join(out, `${n}-3-sheet-pair.png`) });
    await p.click('#shFormats button:has-text("Video")'); await p.waitForTimeout(1900);
    await p.screenshot({ path: path.join(out, `${n}-4-sheet-video-making.png`) });
    await p.waitForFunction(() => !$('shShare').disabled && !$('shVideo').hidden, null, { timeout: 30000 }); await p.waitForTimeout(1500);
    await p.screenshot({ path: path.join(out, `${n}-5-sheet-video.png`) });
    await browser.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
