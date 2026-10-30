const { launch, face } = require('./harness');
const done = (p) => p.waitForFunction(() => !busyNow, null, { timeout: 60000 });
const ob = () => { localStorage.setItem('glowOnboarded', '1'); localStorage.setItem('glowStart', 'editor'); };
async function load(p) {
  await p.goto('https://app.test/'); await p.waitForTimeout(700);
  const fc = p.waitForEvent('filechooser'); await p.click('#pickBtn'); await (await fc).setFiles(face); await p.waitForTimeout(1000);
}
(async () => {
  // 1. Small phone 320x568
  let { browser, p, state } = await launch({ viewport: { width: 320, height: 568 }, init: ob });
  await load(p);
  await p.screenshot({ path: 'shots/30_small_editor.png' });
  await p.click('.tab[data-cat="retouch"]'); await p.click('.subchip[data-chip="body"]'); await p.click('.tool[data-tool="bwaist"]'); await p.waitForTimeout(300);
  console.log('reshape: pending', await p.evaluate(() => !!ed.pending), 'apply disabled', await p.isDisabled('#applyBtn'), '|', await p.textContent('#panelNote'));
  await p.screenshot({ path: 'shots/31_small_reshape.png' });
  const sw = await p.evaluate(() => document.documentElement.scrollWidth); console.log('no h-scroll', sw <= 320);
  await p.click('#cancelBtn');
  await p.click('.tab[data-cat="edit"]'); await p.click('.subchip[data-chip="crop"]'); await p.click('.tool[data-tool="crop"]');
  await p.click('.opt:has-text("Square")'); await done(p); await p.waitForTimeout(300);
  await p.screenshot({ path: 'shots/32_small_crop.png' });
  await p.click('#applyBtn'); await p.waitForTimeout(200);
  console.log('crop dims', await p.evaluate(async () => { const i = await loadImg(committed()); return [i.naturalWidth, i.naturalHeight]; }));
  await p.click('#backBtn'); await p.waitForTimeout(200); await p.click('#nav button[data-dest=camera]'); await p.waitForTimeout(2000);
  await p.screenshot({ path: 'shots/33_small_camera.png' });
  console.log('errs', state.errs.filter(e => !e.includes('fetching the script') && !e.includes('XNNPACK')));
  await browser.close();

  // 2. Desktop light mode
  ({ browser, p, state } = await launch({ viewport: { width: 1280, height: 800 }, touch: false, mobile: false, dpr: 1, scheme: 'light', init: ob }));
  await load(p);
  await p.click('.tab[data-cat="looks"]'); await p.click('.tool[data-tool="mylook"]'); await p.waitForTimeout(500); await done(p);
  await p.screenshot({ path: 'shots/40_desktop_light.png' });
  // keyboard: tab to tabs, arrow
  await p.focus('.tab[aria-selected=true]'); await p.keyboard.press('ArrowRight'); await p.waitForTimeout(100);
  console.log('kb tab', await p.evaluate(() => cat));
  await p.keyboard.press('Tab'); await p.waitForTimeout(100); await p.screenshot({ path: 'shots/41_desktop_focus.png' });
  await p.click('#backBtn'); await p.waitForTimeout(300); await p.screenshot({ path: 'shots/42_desktop_home.png' });
  await p.click('#nav button[data-dest=camera]'); await p.waitForTimeout(2000); await p.screenshot({ path: 'shots/43_desktop_camera.png' });
  console.log('errs', state.errs.filter(e => !e.includes('fetching the script') && !e.includes('XNNPACK')));
  await browser.close();

  // 3. Camera denied + prompt
  ({ browser, p, state } = await launch({ denyCamera: true, init: () => localStorage.setItem('glowOnboarded', '1') }));
  await p.goto('https://app.test/'); await p.waitForTimeout(800);
  console.log('denied state', await p.evaluate(() => cam.state), await p.textContent('#camStateTitle'));
  await p.screenshot({ path: 'shots/50_camera_denied.png' });
  await browser.close();
  ({ browser, p, state } = await launch({ camera: false, init: () => localStorage.setItem('glowOnboarded', '1') }));
  await p.goto('https://app.test/'); await p.waitForTimeout(800);
  console.log('prompt state', await p.evaluate(() => cam.state));
  await p.screenshot({ path: 'shots/51_camera_prompt.png' });
  await browser.close();

  // 4. AI failures
  for (const fail of ['start', 'later']) {
    ({ browser, p, state } = await launch({ fail, init: ob }));
    await load(p);
    await p.click('.tab[data-cat="foryou"]'); await p.click('.tool[data-tool="pro"]'); await p.click('#applyBtn'); await done(p); await p.waitForTimeout(500);
    console.log(fail, 'toast:', await p.textContent('#toast'), '| idx', await p.evaluate(() => ed.idx), 'used', state.used, 'refunds', state.refunds);
    if (fail === 'later') await p.screenshot({ path: 'shots/52_ai_failed.png' });
    await browser.close();
  }

  // 5. Enlarged text (root 125%)
  ({ browser, p, state } = await launch({ init: () => { localStorage.setItem('glowOnboarded', '1'); localStorage.setItem('glowStart', 'editor'); document.addEventListener('DOMContentLoaded', () => { document.documentElement.style.fontSize = '125%'; }); } }));
  await load(p);
  await p.click('.tool[data-tool="relight"]'); await p.waitForTimeout(200);
  await p.screenshot({ path: 'shots/60_large_text.png' });
  console.log('no h-scroll', await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await browser.close();
})();
