const { launch, face } = require('./harness');
const done = (p) => p.waitForFunction(() => !busyNow, null, { timeout: 60000 });
(async () => {
  const { browser, p, state } = await launch({ init: () => { localStorage.setItem('glowOnboarded', '1'); localStorage.setItem('glowStart', 'editor'); } });
  await p.goto('https://app.test/'); await p.waitForTimeout(800);
  console.log('home?', await p.isVisible('#editorHome'), 'apply hidden', await p.isHidden('#applyBtn'));
  await p.screenshot({ path: 'shots/10_editor_home.png' });
  const fc = p.waitForEvent('filechooser'); await p.click('#pickBtn'); await (await fc).setFiles(face); await p.waitForTimeout(1200);
  console.log('editor?', await p.isVisible('#editorScreen'), 'panel hidden', await p.isHidden('#panel'), 'save disabled', await p.isDisabled('#saveBtn'));
  await p.screenshot({ path: 'shots/11_editor_loaded.png' });
  // Retouch > Skin > Smooth: preview, then Apply
  await p.click('.tab[data-cat="retouch"]'); await p.click('.subchip[data-chip="skin"]'); await p.click('.tool[data-tool="fsmooth"]');
  await p.waitForTimeout(300); await done(p); await p.waitForTimeout(300);
  console.log('pending?', await p.evaluate(() => !!ed.pending), 'cost chip', await p.textContent('#cost'), 'apply', await p.textContent('#applyBtn'));
  await p.screenshot({ path: 'shots/12_face_preview.png' });
  await p.click('#applyBtn'); await p.waitForTimeout(300);
  console.log('after apply idx', await p.evaluate(() => ed.idx), 'panel hidden', await p.isHidden('#panel'));
  // AI tool: Relight in Edit > Light
  await p.click('.tab[data-cat="edit"]'); await p.click('.subchip[data-chip="light"]'); await p.click('.tool[data-tool="relight"]'); await p.waitForTimeout(200);
  console.log('AI panel', await p.textContent('#cost'), '|', await p.textContent('#applyBtn'), '|', await p.textContent('#panelNote'));
  await p.screenshot({ path: 'shots/13_ai_panel.png' });
  await p.click('#applyBtn'); await done(p); await p.waitForTimeout(400);
  console.log('posts', state.posts, 'used', state.used, 'idx', await p.evaluate(() => ed.idx), 'balance', await p.textContent('#balanceBtn'));
  await p.screenshot({ path: 'shots/14_ai_result.png' });
  // Run again disclosure
  await p.click('.tool[data-tool="relight"]'); await p.waitForTimeout(150);
  console.log('again:', await p.textContent('#applyBtn'), '|', await p.textContent('#panelNote'));
  await p.click('#cancelBtn');
  // Undo / redo do not charge
  await p.click('#undoBtn'); await p.click('#undoBtn'); console.log('undo idx', await p.evaluate(() => ed.idx));
  await p.click('#redoBtn'); await p.click('#redoBtn'); console.log('redo idx', await p.evaluate(() => ed.idx), 'posts', state.posts.length);
  // Views toggle
  await p.click('.views button[data-view="original"]'); await p.waitForTimeout(250); await p.screenshot({ path: 'shots/15_view_original.png' });
  await p.click('.views button[data-view="split"]');
  // Keyboard on handle
  await p.focus('#handle'); await p.keyboard.press('ArrowLeft'); await p.keyboard.press('ArrowLeft');
  console.log('handle value', await p.getAttribute('#handle', 'aria-valuenow'));
  // 2-credit style with 2 left -> ok, then 0 left
  await p.click('.tab[data-cat="looks"]'); await p.click('.subchip[data-chip="styles"]'); await p.click('.tool[data-tool="anime"]'); await p.waitForTimeout(150);
  console.log('anime:', await p.textContent('#applyBtn'), '|', await p.textContent('#panelNote'));
  await p.click('#applyBtn'); await done(p); await p.waitForTimeout(300);
  console.log('used', state.used, 'balance', await p.textContent('#balanceBtn'));
  await p.click('.tool[data-tool="headshot"]'); await p.waitForTimeout(150);
  console.log('zero:', await p.textContent('#applyBtn'), '|', await p.textContent('#panelNote'));
  await p.screenshot({ path: 'shots/16_zero_credits.png' });
  await p.click('#applyBtn'); await p.waitForTimeout(400);
  console.log('paywall open', await p.evaluate(() => $('paywall').open), 'posts', state.posts.length);
  await p.screenshot({ path: 'shots/17_paywall.png' });
  await p.click('#paywall [data-close]');
  // Free tool still works at 0 credits: filter preview, then save with pending
  await p.click('.subchip[data-chip="filters"]'); await p.click('.tool[data-tool="filter:film"]'); await p.waitForTimeout(400); await done(p);
  await p.screenshot({ path: 'shots/18_filter_preview.png' });
  await p.click('#saveBtn'); await p.waitForTimeout(300);
  console.log('ask:', await p.textContent('#askTitle'));
  await p.screenshot({ path: 'shots/19_save_pending.png' });
  const dl = p.waitForEvent('download', { timeout: 5000 }).catch(() => null);
  await p.click('#askActions button:first-child'); 
  console.log('download', !!(await dl), 'idx', await p.evaluate(() => ed.idx), 'unsaved', await p.evaluate(() => unsaved()));
  await p.waitForTimeout(300);
  // Back -> home with continue card; refresh -> draft restored
  await p.click('#backBtn'); await p.waitForTimeout(300);
  console.log('resume visible', await p.isVisible('#resumeCard'), await p.textContent('#resumeMeta'));
  await p.screenshot({ path: 'shots/20_home_resume.png' });
  await p.reload(); await p.waitForTimeout(1200);
  console.log('after reload resume', await p.isVisible('#resumeCard'));
  await p.click('#resumeBtn'); await p.waitForTimeout(500); console.log('resumed idx', await p.evaluate(() => ed.idx));
  // Credits sheet
  await p.click('#balanceBtn'); await p.waitForTimeout(300); await p.screenshot({ path: 'shots/21_credits.png' });
  console.log('errs', state.errs);
  await browser.close();
})();
