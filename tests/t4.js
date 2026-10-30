const { launch, face } = require('./harness');
const done = (p) => p.waitForFunction(() => !busyNow, null, { timeout: 90000 });
(async () => {
  const { browser, p, state } = await launch({ quota: 40, plan: 'pro', init: () => { localStorage.setItem('glowOnboarded', '1'); localStorage.setItem('glowStart', 'editor'); } });
  await p.goto('https://app.test/'); await p.waitForTimeout(700);
  const fc = p.waitForEvent('filechooser'); await p.click('#pickBtn'); await (await fc).setFiles(face); await p.waitForTimeout(1000);
  const results = {};
  for (const id of ['fauto','fteeth','flips','fglam','hcolor','bgblur','bgremove','bgsky','filter:mono','mylook']) {
    await p.evaluate((id) => selectTool(id), id); await p.waitForTimeout(300); await done(p); await p.waitForTimeout(100);
    results[id] = await p.evaluate(() => !!ed.pending);
    await p.evaluate(() => selectTool(null));
  }
  for (const id of ['light','color','warmth','detail']) {
    await p.evaluate((id) => { selectTool(id); toolAmt[id] = 30; return preview(); }, id); await done(p);
    results[id] = await p.evaluate(() => !!ed.pending); await p.evaluate(() => selectTool(null));
  }
  await p.evaluate(() => { selectTool('bwaist'); faceSet.amt.bwaist = 40; }); await p.evaluate(() => preview()); await done(p);
  results.bwaist = await p.evaluate(() => ed.pending ? 'pending' : 'none (no body in photo is expected)');
  await p.evaluate(() => selectTool(null));
  console.log(results, 'toast', await p.textContent('#toast'));
  // Erase with brush
  await p.evaluate(() => selectTool('erase')); await p.waitForTimeout(300);
  const box = await p.locator('#stage').boundingBox();
  await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await p.mouse.down(); await p.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2 + 20, { steps: 5 }); await p.mouse.up();
  await p.screenshot({ path: 'shots/22_erase.png' });
  console.log('erase apply', await p.textContent('#applyBtn'), await p.isEnabled('#applyBtn'));
  await p.click('#applyBtn'); await done(p);
  console.log('posts', state.posts, 'idx', await p.evaluate(() => ed.idx), 'balance', await p.textContent('#balanceBtn'));
  console.log('errs', state.errs.filter(e => !e.includes('fetching the script') && !e.includes('XNNPACK')));
  await browser.close();
})();
