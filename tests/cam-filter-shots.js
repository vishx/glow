// Camera Adjust and filter screenshots: node tests/cam-filter-shots.js outDir [width height]
const H = require('./harness');
const path = require('path'), fs = require('fs');
const out = process.argv[2] || '/tmp/cam-shots', W = +process.argv[3] || 412, Hh = +process.argv[4] || 892;
fs.mkdirSync(out, { recursive: true });
(async () => {
  const { browser, p, state } = await H.launch({ start: 'camera', viewport: { width: W, height: Hh }, args: H.faceVideo ? ['--use-file-for-fake-video-capture=' + H.faceVideo] : [] });
  await p.goto('https://app.test/');
  await p.waitForFunction(() => cam.gl && !$('camLooks').hidden, null, { timeout: 30000 });
  await p.waitForTimeout(1500);
  const shot = (n) => p.screenshot({ path: path.join(out, `${W}x${Hh}-${n}.png`) });
  await shot('1-looks');
  await p.click('#camLooks .look.adjust'); await p.waitForTimeout(500); await shot('2-adjust');
  await p.evaluate(() => { const r = $('sSmooth'); r.value = 60; r.dispatchEvent(new Event('input')); }); await p.waitForTimeout(300); await shot('3-smooth60');
  await p.evaluate(() => document.querySelector('#adjChips [data-set="filter"]').click()); await p.waitForTimeout(300);
  await p.evaluate(() => document.querySelectorAll('#camFilters .look')[3].click()); await p.waitForTimeout(500); await shot('4-filter');
  await p.evaluate(() => document.querySelector('#adjChips [data-set="lips"]').click()); await p.waitForTimeout(300); await shot('5-lips');
  await p.click('#adjDone'); await p.waitForTimeout(300); await p.click('#camHide'); await p.waitForTimeout(300); await shot('5b-hidden'); await p.click('#camHide'); await p.waitForTimeout(300); await p.click('#shutter');
  await p.waitForFunction(() => !$('reviewControls').hidden, null, { timeout: 20000 }); await p.waitForTimeout(600); await shot('6-review');
  console.log(state.errs.join('\n') || 'no errors');
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
