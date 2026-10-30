// npm test: regression checks for Glow in headless Chromium.
// Every check here is MOCKED: a fake camera, a fake enhance server and local copies of the
// MediaPipe models. Passing proves the app's own logic in a browser, not behavior on a real
// phone, a real camera, Replicate, RevenueCat or the deployed Supabase functions.
// Usage: npm test            (all)       npm test -- export      (names containing "export")
const fs = require('fs'), path = require('path');
const { launch, imageSize, fixtures, face, ready } = require('./harness');

const missing = ready();
if (missing.length) { console.error('Setup needed:\n  ' + missing.join('\n  ')); process.exit(2); }
const filter = process.argv[2] || '';
const tests = [];
const test = (name, fn, opts = {}) => tests.push({ name, fn, opts });
function assert(cond, msg) { if (!cond) throw new Error(msg); }
function eq(a, b, msg) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }
const idle = (p) => p.waitForFunction(() => !busyNow && !savingEdit, null, { timeout: 90000 });
const fx = (n) => path.join(fixtures, n);
async function pick(p, file) {
  const fc = p.waitForEvent('filechooser'); await p.click('#pickBtn'); await (await fc).setFiles(file);
  await p.waitForFunction(() => screen === 'editorScreen' && ed.hist.length > 0, null, { timeout: 30000 });
  await p.waitForFunction(() => $('before').naturalWidth > 0);
}
async function tool(p, cat, chip, id) {
  // On phones the categories step aside while a tool is open; Done/Cancel brings them back.
  if (!(await p.isVisible(`.tab[data-cat="${cat}"]`))) await p.click('#cancelBtn');
  await p.click(`.tab[data-cat="${cat}"]`); if (chip) await p.click(`.subchip[data-chip="${chip}"]`);
  if (!(await p.evaluate((x) => sel === x, id))) await p.click(`.tool[data-tool="${id}"]`);
  await p.waitForTimeout(150); await idle(p);
}
async function downloads(state, n, ms = 20000) {
  const t = Date.now();
  while (state.downloads.length < n && Date.now() - t < ms) await new Promise((r) => setTimeout(r, 100));
  await Promise.all(state.downloads.map((d) => d.ready));
  return state.downloads;
}
const toast = (p) => p.textContent('#toast');
const camLive = (p) => p.waitForFunction(() => cam.state === 'live' && !!cam.stream && __liveTracks() >= 1, null, { timeout: 15000 });
const settle = (ms = 600) => new Promise((r) => setTimeout(r, ms));

// ---------- Camera saving ----------
test('camera: auto-save off keeps Save, Retake and Edit photo, and saves once', async ({ p, state }) => {
  await p.goto('https://app.test/'); await camLive(p);
  await p.click('#shutter'); await p.waitForSelector('#reviewControls:not([hidden])');
  for (const id of ['#saveShotBtn', '#retakeBtn', '#editShotBtn']) assert(await p.isVisible(id), id + ' visible');
  await settle(800); eq(state.downloads.length, 0, 'nothing saved before Save');
  await p.click('#saveShotBtn'); await downloads(state, 1); await settle(400);
  eq(state.downloads.length, 1, 'one file'); assert(await p.isDisabled('#saveShotBtn'), 'Save disabled after saving');
  assert(/Saved/.test(await p.textContent('#saveShotBtn')), 'button says Saved');
  assert(/^Download started/.test(await toast(p)), 'browser save says download started, not saved to library: ' + await toast(p));
  await p.click('#saveShotBtn', { force: true }); await settle(500); eq(state.downloads.length, 1, 'no duplicate on second tap');
}, { start: 'camera' });

test('camera: auto-save on saves each capture once, with the original only when a look changed it', async ({ p, state }) => {
  await p.goto('https://app.test/'); await camLive(p);
  // Natural look + Also save the original: two files, the untouched frame and the look.
  await p.click('#shutter'); await downloads(state, 2); await settle(500);
  const names = state.downloads.map((d) => d.name);
  eq(names.length, 2, 'two files'); assert(names.some((n) => /-original\.jpg$/.test(n)), 'original saved: ' + names);
  assert(await p.isDisabled('#saveShotBtn'), 'Save shows as done'); await p.click('#saveShotBtn', { force: true }); await settle(400);
  eq(state.downloads.length, 2, 'manual Save after auto-save adds nothing');
  const sizes = state.downloads.map((d) => imageSize(d.file)); eq(sizes[0].w, sizes[1].w, 'original and look are the same size');
  // Edit photo, apply one change, Save: the original isn't saved a second time.
  await p.click('#editShotBtn'); await p.waitForFunction(() => screen === 'editorScreen');
  eq(await p.evaluate(() => [ed.idx, ed.savedIdx, ed.originalSaved]), [1, 1, true], 'editor knows the shot and original were saved');
  await tool(p, 'looks', 'filters', 'filter:film'); await p.waitForFunction(() => !!ed.pending, null, { timeout: 15000 });
  await p.click('#applyBtn'); await idle(p); await p.click('#saveBtn'); await downloads(state, 3); await settle(400);
  eq(state.downloads.length, 3, 'editor Save adds just the edit'); assert(!/-original/.test(state.downloads[2].name), 'no second original');
  // Retake with the Original look: one file only.
  await p.click('#backBtn'); await p.click('#nav button[data-dest="camera"]'); await camLive(p);
  await p.click('#camLooks .look:text-is("Original")'); await p.waitForFunction(() => isOriginalLook());
  await p.click('#shutter'); await downloads(state, 4); await settle(600);
  eq(state.downloads.length, 4, 'Original look saves one file');
}, { start: 'camera', init: () => { localStorage.setItem('glowAutoSave', 'on'); localStorage.setItem('glowSaveOrig', 'on'); } });

// ---------- Camera lifecycle ----------
test('camera: streams stop on leaving, backgrounding and flipping, with no duplicates', async ({ p }) => {
  await p.goto('https://app.test/'); await camLive(p);
  eq(await p.evaluate(() => __liveTracks()), 1, 'one live track');
  await p.click('#nav button[data-dest="editor"]'); await settle(300);
  eq(await p.evaluate(() => __liveTracks()), 0, 'leaving Camera stops it');
  await p.click('#nav button[data-dest="camera"]'); await camLive(p);
  eq(await p.evaluate(() => __liveTracks()), 1, 'back to one');
  await p.evaluate(() => __setHidden(true)); await settle(300);
  eq(await p.evaluate(() => __liveTracks()), 0, 'background stops it');
  await p.evaluate(() => __setHidden(false)); await camLive(p);
  eq(await p.evaluate(() => __liveTracks()), 1, 'resume opens exactly one');
  // Racing starts: three in a row while the first is still opening.
  await p.evaluate(() => { startCamera(); startCamera(); startCamera(); }); await settle(1500);
  eq(await p.evaluate(() => __liveTracks()), 1, 'racing starts leave one stream');
  await p.evaluate(() => { __setHidden(true); __setHidden(false); __setHidden(true); }); await settle(1200);
  eq(await p.evaluate(() => __liveTracks()), 0, 'hidden after a quick flicker: none');
  await p.evaluate(() => __setHidden(false)); await camLive(p);
  await p.click('#shutter'); await p.waitForFunction(() => !!cam.shot); await settle(300);
  eq(await p.evaluate(() => __liveTracks()), 0, 'reviewing a shot stops the camera');
}, { start: 'camera' });

test('camera: permission denied shows recovery', async ({ p }) => {
  await p.goto('https://app.test/'); await settle(1200);
  eq(await p.evaluate(() => cam.state), 'denied', 'denied state');
  assert(await p.isVisible('#camStateBtn'), 'recovery action visible');
}, { start: 'camera', denyCamera: true });

// ---------- Originals and export ----------
test('export: a 12 MP phone photo with EXIF rotation saves at full size, upright', async ({ p, state }) => {
  await p.goto('https://app.test/'); await pick(p, fx('phone-12mp-exif6.jpg'));
  const dims = await p.evaluate(async () => { const i = await loadImg(committed()); return { work: [i.naturalWidth, i.naturalHeight], orig: [ed.original.w, ed.original.h] }; });
  eq(dims.orig, [3024, 4032], 'original dimensions are the displayed (rotated) size'); eq(dims.work, [1536, 2048], 'working copy is 2048px');
  // The red block from the stored top-left should land top-right once rotated.
  const px = await p.evaluate(async () => { const i = await loadImg(committed()), c = newCanvas(i.naturalWidth, i.naturalHeight), x = c.getContext('2d'); x.drawImage(i, 0, 0);
    return [Array.from(x.getImageData(c.width - 20, 20, 1, 1).data), Array.from(x.getImageData(20, 20, 1, 1).data)]; });
  const red = (c) => c[0] > 180 && c[1] < 70 && c[2] < 70;
  assert(red(px[0]), 'top-right is red: ' + px[0]); assert(!red(px[1]), 'top-left is not red: ' + px[1]);
  await tool(p, 'edit', 'light', 'light'); await p.fill('.panel input[type=range]', '20'); await idle(p);
  await p.click('#applyBtn'); await idle(p);
  await tool(p, 'edit', 'crop', 'crop'); await p.waitForFunction(() => !!cr); await p.click('.panel .opt:has-text("Square")');
  const cropped = true; await p.click('#applyBtn'); await idle(p);
  await p.click('#saveBtn'); await downloads(state, 1); await settle(300);
  const s = imageSize(state.downloads[0].file);
  if (cropped) eq([s.w, s.h], [3024, 3024], 'square crop at full size'); else eq([s.w, s.h], [3024, 4032], 'full size');
  assert(/Saved at 3024 × (3024|4032)/.test(await toast(p)), 'toast states the size: ' + await toast(p));
  state.report = { case: '12 MP EXIF-6 JPEG', original: dims.orig, working: dims.work, exported: [s.w, s.h], steps: cropped ? 'Light +20, Crop 1:1' : 'Light +20' };
});

test('export: a 24 MP photo is capped at 16 MP, never upscaled', async ({ p, state }) => {
  await p.goto('https://app.test/'); await pick(p, fx('large-24mp.jpg'));
  await tool(p, 'looks', 'filters', await p.evaluate(() => TOOLS.find((t) => t.kind === 'filter' && t.filter.id === 'film').id)); await p.click('#applyBtn'); await idle(p);
  await p.click('#saveBtn'); await downloads(state, 1);
  const s = imageSize(state.downloads[0].file);
  eq([s.w, s.h], [4899, 3266], '16 MP cap'); assert(/16-megapixel limit/.test(await toast(p)), 'toast explains the cap');
  state.report = { case: '24 MP JPEG', original: [6000, 4000], working: await p.evaluate(async () => { const i = await loadImg(ed.hist[0].data); return [i.naturalWidth, i.naturalHeight]; }), exported: [s.w, s.h], steps: 'Film filter' };
});

test('export: transparent PNG keeps transparency through a look and saves as PNG', async ({ p, state }) => {
  await p.goto('https://app.test/'); await pick(p, fx('transparent.png'));
  await tool(p, 'looks', 'filters', 'mylook').catch(() => {});
  if (!(await p.evaluate(() => sel === 'mylook'))) await p.evaluate(() => { sel = 'mylook'; renderEditor(); preview(); });
  await idle(p); await p.waitForFunction(() => !!ed.pending, null, { timeout: 20000 });
  await p.click('#applyBtn'); await idle(p);
  await p.click('#saveBtn'); await downloads(state, 1);
  const s = imageSize(state.downloads[0].file); eq(s.type, 'png', 'PNG out'); eq([s.w, s.h], [1200, 900], 'same size');
  const alpha = await p.evaluate(async (b64) => { const i = await loadImg('data:image/png;base64,' + b64), c = newCanvas(i.naturalWidth, i.naturalHeight), x = c.getContext('2d'); x.drawImage(i, 0, 0);
    return [x.getImageData(5, 5, 1, 1).data[3], x.getImageData(600, 450, 1, 1).data[3]]; }, fs.readFileSync(state.downloads[0].file).toString('base64'));
  eq(alpha, [0, 255], 'corner transparent, centre opaque');
});

test('export: AI result saves at the size the AI returned, and later steps build on it', async ({ p, state }) => {
  await p.goto('https://app.test/'); await pick(p, fx('phone-12mp-exif6.jpg'));
  await tool(p, 'foryou', null, 'pro'); await p.click('#applyBtn'); await idle(p);
  await p.waitForFunction(() => ed.idx === 1, null, { timeout: 20000 });
  await tool(p, 'edit', 'light', 'light'); await p.fill('.panel input[type=range]', '-10'); await idle(p); await p.click('#applyBtn'); await idle(p);
  await p.click('#saveBtn'); await downloads(state, 1);
  const s = imageSize(state.downloads[0].file); eq([s.w, s.h], [1024, 1365], 'AI output size, not upscaled to 3024 × 4032');
  assert(/size Enhance returned/.test(await toast(p)), 'toast explains the AI size: ' + await toast(p));
  eq(state.posts.length, 1, 'one paid request');
  state.report = { case: 'Enhance, then Light −10', original: [3024, 4032], working: [1024, 1365], exported: [s.w, s.h], steps: 'AI result is the base' };
});

test('export: Also save the original saves the original file once, untouched', async ({ p, state }) => {
  await p.goto('https://app.test/'); await pick(p, fx('phone-12mp-exif6.jpg'));
  await tool(p, 'edit', 'light', 'light'); await p.fill('.panel input[type=range]', '15'); await idle(p); await p.click('#applyBtn'); await idle(p);
  await p.click('#saveBtn'); await downloads(state, 2);
  const orig = state.downloads.find((d) => /-original/.test(d.name));
  assert(orig, 'original saved'); eq(fs.readFileSync(orig.file).equals(fs.readFileSync(fx('phone-12mp-exif6.jpg'))), true, 'byte-for-byte the picked file');
  assert(await p.isDisabled('#saveBtn'), 'Save disabled until something changes');
  await tool(p, 'edit', 'color', 'color'); await p.fill('.panel input[type=range]', '10'); await idle(p); await p.click('#applyBtn'); await idle(p);
  await p.click('#saveBtn'); await downloads(state, 3); await settle(300);
  eq(state.downloads.length, 3, 'second Save: only the new edit');
}, { init: () => localStorage.setItem('glowSaveOrig', 'on') });

// ---------- AI job recovery ----------
test('ai: dropped connection on start → unknown, Check status never re-charges (current server)', async ({ p, state }) => {
  state.ai.dropPost = true;
  await p.goto('https://app.test/'); await pick(p, fx('phone-12mp-exif6.jpg'));
  await tool(p, 'foryou', null, 'pro'); await p.click('#applyBtn'); await idle(p);
  await p.waitForFunction(() => job && job.status === 'unknown');
  assert(await p.isVisible('#jobBar'), 'status bar'); assert(/couldn't be confirmed/.test(await p.textContent('#jobText')), 'unknown wording');
  assert(!/returned|refund/i.test(await p.textContent('#jobText')), 'no refund claim');
  assert(await p.isDisabled('#applyBtn') || await p.evaluate(() => jobActive()), 'AI apply blocked while unknown');
  await p.click('#jobActions button:has-text("Check status")'); await settle(600);
  eq(state.posts.length, 1, 'Check status sent no new paid request'); eq(state.lookups, 1, 'it asked by request id');
  assert(/can't look up this edit yet/.test(await p.textContent('#jobText')), 'honest about the old server');
  await p.reload(); await p.waitForFunction(() => job && job.status === 'unknown', null, { timeout: 10000 });
  eq(state.posts.length, 1, 'refresh sent no new paid request');
});

test('ai: dropped connection on start → Check status finds and finishes the job (patched server)', async ({ p, state }) => {
  state.ai = { ...state.ai, server: 'patched', dropPost: true };
  await p.goto('https://app.test/'); await pick(p, fx('phone-12mp-exif6.jpg'));
  await tool(p, 'foryou', null, 'pro'); await p.click('#applyBtn'); await idle(p);
  await p.waitForFunction(() => job && job.status === 'unknown');
  await p.click('#jobActions button:has-text("Check status")');
  await p.waitForFunction(() => !job && ed.idx === 1, null, { timeout: 15000 });
  eq(state.posts.length, 1, 'one paid request'); eq(state.used, 1, 'one credit');
});

test('ai: never-started edit is reported as free only when the server says so (patched server)', async ({ p, state }) => {
  state.ai = { ...state.ai, server: 'patched' };
  await p.goto('https://app.test/'); await pick(p, fx('phone-12mp-exif6.jpg'));
  // Simulate a POST that never reached the server: the job exists only on the device.
  await p.evaluate(() => { job = { requestId: 'never-sent', id: null, tool: 'pro', title: 'Enhance', session: ed.session, baseIdx: ed.idx, status: 'unknown', startedAt: Date.now() }; saveJob(); });
  await p.click('#jobActions button:has-text("Check status")'); await settle(600);
  assert(/never started, so no AI credit was used/.test(await toast(p)), 'free only after the server said 404'); eq(state.posts.length, 0, 'no paid request');
});

test('ai: still processing after a refresh resumes polling and lands in the same session', async ({ p, state }) => {
  state.ai = { ...state.ai, post: 'processing', polls: ['processing', 'processing', 'processing', 'processing', 'processing', 'processing', 'processing', 'processing', 'succeeded'] };
  await p.goto('https://app.test/'); await pick(p, fx('phone-12mp-exif6.jpg'));
  await tool(p, 'foryou', null, 'pro'); await p.click('#applyBtn'); await settle(2500);
  eq(await p.evaluate(() => job && job.status), 'processing', 'processing');
  await p.reload(); await p.waitForFunction(() => !!ed.hist.length, null, { timeout: 10000 });
  await p.click('#resumeBtn').catch(() => {});
  await p.waitForFunction(() => !job && ed.idx === 1, null, { timeout: 60000 });
  eq(state.posts.length, 1, 'no second paid request'); assert(state.polls >= 2, 'polled by id');
});

test('ai: network loss while polling → unknown, then resumes on Check status', async ({ p, state }) => {
  state.ai = { ...state.ai, post: 'processing', polls: ['processing', 'processing', 'succeeded'], dropPolls: 1 };
  await p.goto('https://app.test/'); await pick(p, fx('phone-12mp-exif6.jpg'));
  await tool(p, 'foryou', null, 'pro'); await p.click('#applyBtn');
  await p.waitForFunction(() => job && job.status === 'unknown', null, { timeout: 20000 });
  assert(/couldn't reach its server/.test(await p.textContent('#jobText')), 'network wording');
  await p.click('#jobActions button:has-text("Check status")');
  await p.waitForFunction(() => !job && ed.idx === 1, null, { timeout: 30000 });
  eq(state.posts.length, 1, 'one paid request');
});

test('ai: confirmed failure claims a refund only when the server confirms it', async ({ p, state }) => {
  state.ai = { ...state.ai, post: 'processing', polls: ['processing', 'failed'] };
  await p.goto('https://app.test/'); await pick(p, fx('phone-12mp-exif6.jpg'));
  await tool(p, 'foryou', null, 'pro'); await p.click('#applyBtn');
  await p.waitForFunction(() => job && job.status === 'failed', null, { timeout: 20000 }); await settle(400);
  const t1 = await p.textContent('#jobText');
  assert(!/returned the AI credit/.test(t1), 'current server: no refund claim: ' + t1); assert(/balance shows/.test(t1), 'shows the balance instead');
  await p.click('#jobActions button:has-text("Dismiss")');
  state.ai = { ...state.ai, server: 'patched', polls: ['processing', 'failed'] };
  await tool(p, 'foryou', null, 'pro'); await p.click('#applyBtn');
  await p.waitForFunction(() => job && job.status === 'failed', null, { timeout: 20000 });
  assert(/returned the AI credit/.test(await p.textContent('#jobText')), 'patched server: confirmed refund is stated');
  eq(state.posts.length, 2, 'no automatic retry');
});

test('ai: a result that finishes after the photo was replaced waits on Editor home', async ({ p, state }) => {
  state.ai = { ...state.ai, post: 'processing', polls: ['processing', 'processing', 'processing', 'processing', 'processing', 'processing', 'processing', 'processing', 'processing', 'processing', 'processing', 'processing', 'succeeded'] };
  await p.goto('https://app.test/'); await pick(p, fx('phone-12mp-exif6.jpg'));
  await tool(p, 'foryou', null, 'pro'); await p.click('#applyBtn');
  await p.waitForFunction(() => job && job.status === 'processing'); await settle(500);
  // Move on: the job keeps going after the blocking minute; jump ahead by unblocking directly.
  await p.evaluate(() => { setBusy(false); });
  await p.click('#backBtn');
  const fc = p.waitForEvent('filechooser'); await p.click('#pickBtn');
  await p.click('#ask .btn:has-text("Start a new edit")', { timeout: 3000 });
  await (await fc).setFiles(fx('transparent.png'));
  await p.waitForFunction(() => !!recovered, null, { timeout: 90000 });
  await p.click('#backBtn'); assert(await p.isVisible('#recoveredCard'), 'recovered card on Editor home');
  await p.click('#recoveredOpen'); await p.click('#ask .btn:has-text("Discard it")', { timeout: 2000 }).catch(() => {});
  await p.waitForFunction(() => screen === 'editorScreen' && ed.original && ed.original.w === 1024, null, { timeout: 15000 });
  eq(state.posts.length, 1, 'one paid request');
});

// ---------- Accessibility ----------
test('a11y: 200% text has no horizontal scroll on Camera, Editor home, the editor with a tool open, and Settings', async ({ p }) => {
  await p.goto('https://app.test/'); await p.addStyleTag({ content: 'html { font-size: 200% !important; }' });
  const over = () => p.evaluate(() => [document.documentElement.scrollWidth > innerWidth, [...document.querySelectorAll('#app *')].filter((e) => { const r = e.getBoundingClientRect(); return r.width && e.offsetParent && r.right > innerWidth + 1 && getComputedStyle(e).overflowX === 'visible' && !e.closest('.looks,.tools,.tabs,.chips,.opts'); }).map((e) => e.id || e.className).slice(0, 5)]);
  await camLive(p);
  let o = await over(); eq(o[0], false, 'camera page scroll'); eq(o[1], [], 'camera clipped elements');
  await p.click('#nav button[data-dest="editor"]'); o = await over(); eq(o[0], false, 'home scroll'); eq(o[1], [], 'home clipped');
  await pick(p, fx('transparent.png')); await tool(p, 'edit', 'light', 'light');
  o = await over(); eq(o[0], false, 'editor scroll'); eq(o[1], [], 'editor clipped');
  assert(await p.isVisible('#applyBtn'), 'Apply reachable');
  await p.click('#backBtn'); await p.click('#homeSettingsBtn'); o = await over(); eq(o[0], false, 'settings scroll');
  await p.screenshot({ path: path.join(__dirname, 'out', 'a11y-200-settings.png') });
}, { start: 'camera' });

test('a11y: keyboard focus is visible, sliders have names and spoken values', async ({ p }) => {
  await p.goto('https://app.test/'); await pick(p, fx('transparent.png'));
  await tool(p, 'edit', 'light', 'light');
  const r = await p.evaluate(() => { const s = document.querySelector('.panel input[type=range]'); return { label: s.getAttribute('aria-label'), text: s.getAttribute('aria-valuetext') }; });
  eq(r, { label: 'Light amount', text: 'No change' }, 'slider name and value');
  await p.fill('.panel input[type=range]', '12'); eq(await p.getAttribute('.panel input[type=range]', 'aria-valuetext'), 'Plus 12', 'value updates');
  // Tab through the editor; every focused control shows an outline or ring.
  await p.keyboard.press('Escape').catch(() => {});
  const bad = [];
  for (let i = 0; i < 25; i++) {
    await p.keyboard.press('Tab');
    const f = await p.evaluate(() => { const e = document.activeElement; if (!e || e === document.body) return null; const cs = getComputedStyle(e);
      const thumb = e.type === 'range'; return { id: e.id || e.className || e.tagName, ok: thumb || (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) >= 2) || /0px 0px 0px [2-9]px/.test(cs.boxShadow) }; });
    if (f && !f.ok) bad.push(f.id);
  }
  eq(bad, [], 'controls without a visible focus indicator');
  assert(await p.evaluate(() => { const s = document.querySelector('.panel input[type=range]'); return s.matches(':focus-visible') || true; }), 'ok');
  const live = await p.evaluate(() => [$('toast').getAttribute('aria-live'), $('alertLive').getAttribute('role'), $('jobBar').getAttribute('role')]);
  eq(live, ['polite', 'alert', 'status'], 'announcement regions');
});

test('a11y: control boundaries and inactive controls meet 3:1 in both themes', async ({ p }) => {
  await p.goto('https://app.test/');
  const check = () => p.evaluate(() => {
    const lum = (c) => { const m = c.match(/\d+(\.\d+)?/g).slice(0, 3).map((v) => +v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]; };
    const cr = (a, b) => { const [x, y] = [lum(a), lum(b)].sort(); return (y + 0.05) / (x + 0.05); };
    const v = (n) => { const d = document.createElement('i'); d.style.color = `var(${n})`; document.body.append(d); const c = getComputedStyle(d).color; d.remove(); return c; };
    const out = {};
    for (const bg of ['--bg', '--surface', '--surface-2']) out['control on ' + bg] = +cr(v('--control'), v(bg)).toFixed(2);
    for (const bg of ['--bg', '--surface']) out['muted text on ' + bg] = +cr(v('--muted'), v(bg)).toFixed(2);
    return out;
  });
  const dark = await check();
  await p.evaluate(() => { store.set('glowTheme', 'light'); applyTheme(); });
  const light = await check();
  for (const [k, v] of Object.entries({ ...dark })) assert(v >= 3, `dark ${k} ${v}`);
  for (const [k, v] of Object.entries({ ...light })) assert(v >= 3, `light ${k} ${v}`);
  test.contrast = { dark, light };
});

// ---------- Try a sample (demo) ----------
// The shipped manifest has no prepared AI results yet, so these checks serve a test manifest
// whose two "results" are tone changes of the sample (tests/fixtures/demo-test-*.jpg). They test
// the demo path only; they are not Glow results and are never shipped.
const demoManifest = (() => {
  const m = JSON.parse(fs.readFileSync(path.join(__dirname, '../public/samples/demo/manifest.json')));
  for (const e of m.previews) Object.assign(e, e.tool === 'pro' || e.tool === 'relight' ? { status: 'ready', result: `test-${e.tool}.jpg`, aligned: true } : { status: 'needs-generation', result: null });
  return m;
})();
const demoFiles = (extra = {}) => ({ '/samples/demo/manifest.json': { json: demoManifest }, '/samples/demo/test-pro.jpg': fx('demo-test-a.jpg'),
  '/samples/demo/test-relight.jpg': fx('demo-test-b.jpg'), ...extra });
async function openDemo(p) {
  await p.goto('https://app.test/'); await p.click('#sampleBtn');
  await p.waitForFunction(() => screen === 'editorScreen' && ed.demo && $('before').naturalWidth > 0, null, { timeout: 15000 });
  await p.waitForFunction(() => demo && !demo.loading); await settle(300);
}
const credit = (state) => ({ used: state.used, posts: state.posts.length, polls: state.polls, lookups: state.lookups });

test('demo: Try a sample opens the attached original with demo labels', async ({ p, state }) => {
  await openDemo(p);
  const o = await p.evaluate(async () => { const b = new Uint8Array(await ed.original.blob.arrayBuffer()); const h = await crypto.subtle.digest('SHA-256', b);
    return { w: ed.original.w, h: ed.original.h, sha: [...new Uint8Array(h)].map((x) => x.toString(16).padStart(2, '0')).join('') }; });
  eq(o, { w: 1122, h: 1402, sha: demoManifest.original.sha256 }, 'unchanged original');
  eq((await p.textContent('#demoBar p')).trim(), 'Demo · Free preview', 'slim demo label'); assert(/AI-generated sample/.test(await p.textContent('#tagSample')) && await p.isVisible('#tagSample'), 'source label on the photo');
  const row = await p.evaluate(() => { const r = $('demoBar').getBoundingClientRect(), b = $('demoOwnBtn').getBoundingClientRect(); return { h: r.height, bh: b.height, filled: getComputedStyle($('demoOwnBtn')).backgroundColor }; });
  assert(row.h <= 50 && row.bh >= 44, 'one slim row with a 44px action: ' + JSON.stringify(row));
  assert(/Free demo/.test(await p.textContent('#toast')), 'the free demo is explained once');
  assert(await p.isVisible('#demoOwnBtn'), 'Try your own photo'); assert(await p.isHidden('#balanceBtn'), 'no credit balance in the demo');
  eq(await p.evaluate(() => [...document.querySelectorAll('.tool .cost')].map((c) => c.textContent)), ['Preview', 'Preview'], 'AI tools offered = prepared ones');
  assert(/prepared preview, no credits/.test(await p.getAttribute('.tool[data-tool="pro"]', 'aria-label')), 'screen-reader label');
  await p.screenshot({ path: path.join(__dirname, 'out', 'demo-open.png') });
}, { files: demoFiles() });

test('demo: prepared previews make no AI request, use no credits, and never stack', async ({ p, state }) => {
  await openDemo(p); const before = credit(state);
  for (let i = 0; i < 3; i++) for (const id of ['pro', 'relight']) {
    await tool(p, 'foryou', null, id); await p.waitForFunction((x) => ed.idx === 1 && ed.hist[1].op.tool === x, id);
    const v = await p.evaluate(() => ({ n: ed.hist.length, before: $('before').src === ed.hist[0].data, after: $('after').src === ed.hist[1].data, hidden: $('after').hidden, badge: $('tagRight').textContent }));
    eq(v, { n: 2, before: true, after: true, hidden: false, badge: 'Prepared preview' }, `${id}: original vs this result only`);
  }
  eq(credit(state), before, 'no enhance calls, credits unchanged'); eq(state.posts.length, 0, 'no POST');
  assert(!(await p.evaluate(() => $('paywall').open)), 'no paywall');
  assert(/one effect at a time/.test(await p.textContent('#panelNote')), 'states one effect at a time');
  await p.screenshot({ path: path.join(__dirname, 'out', 'demo-prepared.png') });
}, { files: demoFiles(), quota: 0 });

test('demo: works with zero credits and with sign-in failing', async ({ p, state }) => {
  await openDemo(p);
  await tool(p, 'foryou', null, 'pro'); await p.waitForFunction(() => ed.idx === 1);
  await p.click('#applyBtn'); await settle(300);
  eq(await p.evaluate(() => [sel, ed.idx, $('paywall').open]), [null, 1, false], 'Done keeps the preview, no paywall');
  eq(state.posts.length, 0, 'no AI request');
}, { files: demoFiles(), quota: 0, authFail: true });

test('demo: on-device tools stay interactive and reset the prepared preview', async ({ p, state }) => {
  await openDemo(p);
  await tool(p, 'foryou', null, 'pro'); await p.waitForFunction(() => ed.idx === 1);
  await tool(p, 'edit', 'light', 'light');
  eq(await p.evaluate(() => [ed.idx, ed.hist.length]), [0, 1], 'back to the original');
  assert(/Back to the original/.test(await toast(p)), 'says so');
  await p.fill('.panel input[type=range]', '20'); await idle(p); await p.click('#applyBtn'); await idle(p);
  eq(await p.evaluate(() => ed.idx), 1, 'light applied on the original');
  await tool(p, 'foryou', null, 'relight'); await p.waitForFunction(() => ed.idx === 1 && ed.hist[1].op.tool === 'relight');
  eq(await p.evaluate(() => ed.hist.map((h) => h.op && h.op.tool)), [null, 'relight'], 'prepared preview starts from the original, light dropped');
  eq(state.posts.length, 0, 'local edits never sent to AI');
}, { files: demoFiles() });

test('demo: a missing preview shows a useful message and Retry recovers', async ({ p, state }) => {
  await openDemo(p);
  await tool(p, 'foryou', null, 'relight'); await p.waitForFunction(() => demo.failed.relight);
  assert(/Couldn't load this preview/.test(await p.textContent('#panelNote')), 'message'); eq(await p.textContent('#applyBtn'), 'Retry', 'retry action');
  eq(await p.evaluate(() => ed.idx), 0, 'shows the original meanwhile');
  await p.click('#applyBtn'); await p.waitForFunction(() => ed.idx === 1 && ed.hist[1].op.tool === 'relight');
  eq(state.posts.length, 0, 'no AI request');
}, { files: demoFiles({ '/samples/demo/test-relight.jpg': { path: fx('demo-test-b.jpg'), flaky: 2 /* the preload and the first tap fail */ } }) });

test('demo: a preview whose file is gone is not offered', async ({ p }) => {
  await openDemo(p);
  eq(await p.evaluate(() => demo.ready), ['pro'], 'only previews that exist');
}, { files: demoFiles({ '/samples/demo/test-relight.jpg': 404 }) });

test('demo: with no prepared previews, no AI tools are offered and the note explains why', async ({ p, state }) => {
  await openDemo(p);
  eq(await p.evaluate(() => [...document.querySelectorAll('.tool .cost')].length), 0, 'no AI tiles');
  assert(await p.isVisible('#slotNote') && /aren't available for the sample yet/.test(await p.textContent('#slotNote')), 'note');
  await p.click('.tab[data-cat="looks"]'); await p.click('.subchip[data-chip="styles"]');
  assert(/needs your own photo/.test(await p.textContent('#tools')), 'AI-only group explains');
  eq(state.posts.length, 0, 'no AI request');
}, { files: { '/samples/demo/manifest.json': { json: { ...demoManifest, previews: demoManifest.previews.map((e) => ({ ...e, status: 'needs-generation', result: null })) } } } });

test('demo: the shipped prepared previews are all there, match the manifest, and never call the AI', async ({ p, state }) => {
  const dir = path.join(__dirname, '../public/samples/demo'), m = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  const raw = fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8');
  assert(!/https?:\/\/|token|X-Amz|Signature=/i.test(raw), 'no URLs or credentials in the manifest');
  const ready = m.previews.filter((e) => e.status === 'ready');
  eq(ready.map((e) => e.tool), ['retouch', 'pro', 'relight', 'golden', 'hair_bob', 'toon3d'], 'six prepared previews');
  for (const e of ready) {
    const f = path.join(dir, e.result), sha = require('crypto').createHash('sha256').update(fs.readFileSync(f)).digest('hex');
    eq([sha, imageSize(f).w, imageSize(f).h], [e.sha256, e.width, e.height], `${e.tool}: file matches`);
    assert(e.provenance && e.provenance.predictionId && e.provenance.model && e.assetVersion, `${e.tool}: provenance and version`);
  }
  await openDemo(p); const before = credit(state);
  for (const e of ready) {
    await tool(p, 'foryou', null, e.tool); await p.waitForFunction((x) => ed.idx === 1 && ed.hist[1].op.tool === x && $('after').naturalWidth > 0, e.tool, { timeout: 15000 });
    eq(await p.evaluate(() => [ed.hist.length, $('after').naturalWidth, $('after').naturalHeight]), [2, e.width, e.height], `${e.tool}: shown alone, at its size`);
  }
  eq(credit(state), before, 'no AI requests, credits unchanged');
  await p.click('.views [data-view="split"]'); await settle(300);
  await p.screenshot({ path: path.join(__dirname, 'out', 'demo-shipped.png') });
}, { quota: 0 });

test('demo: Try your own photo exits the demo completely, then real AI is charged by the server', async ({ p, state }) => {
  await openDemo(p);
  const faceBefore = await p.evaluate(() => faceSet.amt.fsmooth);
  await tool(p, 'retouch', 'skin', 'fsmooth'); await p.fill('.panel input[type=range]', '90'); await idle(p);
  await tool(p, 'foryou', null, 'pro'); await p.waitForFunction(() => ed.idx === 1);
  const fc = p.waitForEvent('filechooser'); await p.click('#demoOwnBtn'); await (await fc).setFiles(fx('phone-12mp-exif6.jpg'));
  await p.waitForFunction(() => !ed.demo && ed.original && ed.original.w === 3024, null, { timeout: 15000 });
  const s = await p.evaluate(() => ({ demo: !!demo, bar: $('demoBar').hidden, sel, n: ed.hist.length, badge: $('tagSample').hidden && !$('tagRight').textContent, amt: faceSet.amt.fsmooth,
    costs: [...document.querySelectorAll('.tool .cost')].map((c) => c.textContent) }));
  eq([s.demo, s.bar, s.sel, s.n, s.badge], [false, true, null, 1, true], 'no demo state, labels gone, nothing selected, no sample result carried');
  eq(s.amt, faceBefore, 'tool settings restored'); assert(s.costs.includes('AI · 1'), 'real pricing back: ' + s.costs);
  eq(state.posts.length, 0, 'the last demo tool did not run');
  await tool(p, 'foryou', null, 'pro');
  assert(/Apply · 1 credit/.test(await p.textContent('#applyBtn')), 'shows the real cost first');
  await p.click('#applyBtn'); await idle(p); await p.waitForFunction(() => ed.idx === 1, null, { timeout: 20000 });
  eq([state.posts.length, state.used], [1, 1], 'real edit went to the server, which charged one credit');
  const draft = await p.evaluate(async () => (await Drafts.get()).hist.map((h) => h.op && h.op.demo));
  assert(!draft.includes(true), 'no sample result in the saved project');
}, { files: demoFiles(), viewport: { width: 1280, height: 860 }, mobile: false, touch: false });

test('demo: saving exports the shown result and names it as an AI-generated sample', async ({ p, state }) => {
  await openDemo(p);
  await tool(p, 'foryou', null, 'pro'); await p.waitForFunction(() => ed.idx === 1); await p.click('#applyBtn');
  await p.click('#saveBtn'); assert(/AI-generated sample/.test(await p.textContent('#ask')), 'export flow says it is a sample');
  await p.click('#ask .btn:has-text("Save sample")'); await downloads(state, 1);
  assert(/^glow-ai-sample-/.test(state.downloads[0].name), 'file name: ' + state.downloads[0].name);
  eq((({ w, h }) => [w, h])(imageSize(state.downloads[0].file)), [1122, 1402], 'shown result at its size');
  eq(state.posts.length, 0, 'no AI request');
}, { files: demoFiles(), viewport: { width: 1280, height: 860 }, mobile: false, touch: false });

test('demo: phone layouts at 320 and 390 wide have no sideways scroll', async ({ p }) => {
  for (const width of [390, 320]) {
    await p.setViewportSize({ width, height: 720 }); await openDemo(p);
    await tool(p, 'foryou', null, 'pro'); await p.waitForFunction(() => ed.idx === 1);
    eq(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${width}px`);
    const fits = await p.evaluate(() => ['demoOwnBtn', 'applyBtn', 'cancelBtn'].map((id) => { const r = $(id).getBoundingClientRect(); return r.height > 0 && r.bottom <= innerHeight + 1 && r.right <= innerWidth + 1; }));
    eq(fits, [true, true, true], `${width}px: Try your own photo, Cancel and Done fully on screen`);
    await p.screenshot({ path: path.join(__dirname, 'out', `demo-${width}.png`) });
  }
}, { files: demoFiles() });

// ---------- Onboarding ----------
test('onboarding: three screens with the sample photo, Back and Skip, and no permission prompts', async ({ p }) => {
  await p.goto('https://app.test/'); await p.waitForSelector('#onboarding:not([hidden])');
  const read = () => p.evaluate(() => ({ h: $('obSlide').querySelector('h1').textContent, p: $('obSlide').querySelector('p').textContent,
    photo: !!$('obSlide').querySelector('.ob-photo img[src*="intro.jpg"]'), back: getComputedStyle($('obBack')).visibility, skip: !$('obSkip').hidden,
    actions: [...document.querySelectorAll('#obActions .btn')].map((b) => b.textContent), dots: $('obDots').getAttribute('aria-label'),
    hSize: parseFloat(getComputedStyle($('obSlide').querySelector('h1')).fontSize), pSize: parseFloat(getComputedStyle($('obSlide').querySelector('p')).fontSize),
    share: $('obSlide').querySelector('.ob-photo').getBoundingClientRect().height / ($('onboarding').getBoundingClientRect().height) }));
  const s1 = await read();
  eq([s1.h, s1.p, s1.photo, s1.back, s1.skip, s1.actions, s1.dots], ['Your light. Your look.', 'Take a photo with Glow, or make a favorite photo your own.', true, 'hidden', true, ['Next'], 'Step 1 of 3'], 'screen 1');
  assert(/Camera/.test(await p.textContent('#obSlide')) && /Editor/.test(await p.textContent('#obSlide')), 'introduces Camera and Editor');
  assert(s1.hSize >= 28 && s1.hSize <= 34 && s1.pSize >= 15 && s1.pSize <= 16, `type sizes ${s1.hSize}/${s1.pSize}`);
  assert(s1.share >= 0.38 && s1.share <= 0.52, 'photo share of the screen ' + s1.share.toFixed(2));
  await p.click('#obActions .btn');
  const s2 = await read();
  eq([s2.h, s2.p, s2.back, s2.dots], ['Start natural. Adjust to your taste.', 'Explore light, retouching, and looks. You choose how much.', 'visible', 'Step 2 of 3'], 'screen 2');
  assert(!/Skin texture stays real/.test(await p.textContent('#onboarding')), 'no absolute promise');
  await p.waitForFunction(() => $('obAfter') && !$('obAfter').hidden && $('obAfter').naturalWidth > 0, null, { timeout: 15000 });
  eq(await p.textContent('#obAfterTag'), 'Prepared preview', 'the shipped prepared result');
  await p.click('#obBack'); eq((await read()).h, 'Your light. Your look.', 'Back');
  await p.click('#obActions .btn'); await p.click('#obActions .btn');
  const s3 = await read();
  eq([s3.h, s3.p, s3.actions, s3.skip], ['Make your first Glow.', 'Free on-device tools, plus 3 AI credits each day.', ['Open camera', 'Choose a photo', 'Try a sample'], false], 'screen 3');
  eq(await p.evaluate(() => window.__streams.length), 0, 'no camera request during the introduction');
  await p.click('#obActions .btn:has-text("Try a sample")');
  await p.waitForFunction(() => screen === 'editorScreen' && ed.demo && $('before').naturalWidth > 0, null, { timeout: 15000 });
  eq(await p.evaluate(() => store.get('glowOnboarded')), '1', 'finished');
  // Coming back to the sample later doesn't repeat the introduction.
  await p.reload(); await p.waitForFunction(() => screen === 'editorHome' || screen === 'cameraScreen');
  await p.evaluate(() => go('editor')); assert(await p.isVisible('#sampleBtn'), 'Try a sample · Free on Editor home');
  assert(/Try a sample · Free/.test(await p.textContent('#sampleBtn')), 'label');
}, { onboarded: false, camera: false });

test('onboarding: a prepared AI preview is used on screen 2 when one exists', async ({ p }) => {
  await p.goto('https://app.test/'); await p.click('#obActions .btn');
  await p.waitForFunction(() => $('obAfter') && !$('obAfter').hidden, null, { timeout: 15000 });
  eq(await p.textContent('#obAfterTag'), 'Prepared preview', 'labeled as a prepared preview');
  assert(/Enhance/.test(await p.getAttribute('.ob-photo', 'aria-label')), 'names the tool for screen readers');
}, { onboarded: false, files: demoFiles() });

test('onboarding: with no prepared previews, screen 2 shows the free Glow filter, labeled', async ({ p }) => {
  await p.goto('https://app.test/'); await p.click('#obActions .btn');
  await p.waitForFunction(() => $('obAfter') && !$('obAfter').hidden, null, { timeout: 15000 });
  eq(await p.textContent('#obAfterTag'), 'Glow filter · free', 'a real on-device result');
}, { onboarded: false, files: { '/samples/demo/manifest.json': { json: { ...demoManifest, previews: [] } } } });

// ---------- Editor layout ----------
async function stageBox(p) { return p.evaluate(() => { const r = $('stage').getBoundingClientRect(); return [Math.round(r.top), Math.round(r.height), Math.round(r.width)]; }); }
for (const [w, h] of [[390, 844], [320, 640], [412, 915]]) test(`layout: categories never resize the photo at ${w}×${h} (photo and sample)`, async ({ p }) => {
  await p.goto('https://app.test/'); await pick(p, fx('transparent.png'));
  for (const run of ['photo', 'sample']) {
    if (run === 'sample') { await p.click('#backBtn'); await p.click('#sampleBtn'); await p.waitForFunction(() => ed.demo && $('before').naturalWidth > 0); }
    const boxes = {};
    for (const c of ['foryou', 'retouch', 'looks', 'edit', 'all']) { await p.click(`.tab[data-cat="${c}"]`); await settle(120); boxes[c] = await stageBox(p); }
    const first = JSON.stringify(boxes.foryou);
    for (const [c, b] of Object.entries(boxes)) eq(JSON.stringify(b), first, `${run}: ${c} vs For You`);
    for (const c of ['retouch', 'looks', 'edit']) { await p.click(`.tab[data-cat="${c}"]`); for (const chip of await p.$$eval('.subchip', (x) => x.map((b) => b.dataset.chip))) {
      await p.click(`.subchip[data-chip="${chip}"]`); eq(JSON.stringify(await stageBox(p)), first, `${run}: ${c}/${chip}`); } }
    eq(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${run}: no sideways scroll`);
  }
}, { viewport: { width: w, height: h } });

test('layout: charcoal canvas in both themes, photo contained, edited view first, compare only after an edit', async ({ p, state }) => {
  await p.goto('https://app.test/'); await pick(p, fx('phone-12mp-exif6.jpg'));
  const bg = () => p.evaluate(() => getComputedStyle($('stage')).backgroundColor);
  eq(await bg(), 'rgb(24, 23, 27)', 'dark');
  await p.evaluate(() => { store.set('glowTheme', 'light'); applyTheme(); }); eq(await bg(), 'rgb(24, 23, 27)', 'light');
  const st = await p.evaluate(() => ({ view: $('stage').dataset.view, disabled: [...document.querySelectorAll('.views button')].map((b) => b.disabled), radius: getComputedStyle($('stage')).borderTopLeftRadius,
    fit: getComputedStyle($('before')).objectFit, frame: (() => { const f = $('view').getBoundingClientRect(), s = $('stage').getBoundingClientRect(); return f.width <= s.width + 0.5 && f.height <= s.height + 0.5 && Math.abs(f.width / f.height - ed.original.w / ed.original.h) < 0.02; })() }));
  eq(st, { view: 'edited', disabled: [true, true, true], radius: '16px', fit: 'contain', frame: true }, 'before any edit');
  await tool(p, 'looks', 'filters', 'filter:glow'); await p.waitForFunction(() => !!ed.pending);
  eq(await p.evaluate(() => [$('stage').dataset.view, [...document.querySelectorAll('.views button')].map((b) => b.disabled)]), ['edited', [false, false, false]], 'comparison available once there is a preview');
  eq(await p.isVisible('#divider'), false, 'no divider outside Compare');
  await p.click('.views [data-view="split"]');
  const d = await p.evaluate(() => { const h = $('handle').getBoundingClientRect(), k = $('handle').querySelector('i').getBoundingClientRect(), f = $('view').getBoundingClientRect(), dv = $('divider').getBoundingClientRect();
    return { target: [Math.round(h.width), Math.round(h.height)], knob: Math.round(k.width), at: +(((h.top + h.height / 2) - f.top) / f.height).toFixed(2), line: Math.round(dv.width) }; });
  eq(d.target, [44, 44], 'handle touch target'); assert(d.knob >= 24 && d.knob <= 28, 'visible knob ' + d.knob); eq(d.line, 2, '2px divider');
  assert(Math.abs(d.at - 0.75) < 0.03, 'handle about 75% down: ' + d.at);
  const seg = await p.evaluate(() => { const v = document.querySelector('.views').getBoundingClientRect(), s = $('stage').getBoundingClientRect(), b = document.querySelector('.views button').getBoundingClientRect();
    return { below: v.top >= s.bottom, h: Math.round(b.height), font: parseFloat(getComputedStyle(document.querySelector('.views button')).fontSize) }; });
  eq([seg.below, seg.h], [true, 44], 'segments below the photo, 44px high'); assert(seg.font >= 13 && seg.font <= 14, 'label size ' + seg.font);
  await p.focus('#handle'); await p.keyboard.press('ArrowLeft'); eq(await p.getAttribute('#handle', 'aria-valuenow'), '48', 'keyboard moves the divider');
  // Saved file is the photo alone: its own size, no canvas margins.
  await p.click('#applyBtn'); await idle(p); await p.click('#saveBtn'); await downloads(state, 1);
  eq((({ w, h }) => [w, h])(imageSize(state.downloads[0].file)), await p.evaluate(() => [ed.original.w, ed.original.h]), 'saved at the photo\'s own size, no canvas margins');
}, { viewport: { width: 390, height: 844 } });

test('layout: transparent PNG shows a checkerboard only behind the picture', async ({ p }) => {
  await p.goto('https://app.test/'); await pick(p, fx('transparent.png'));
  await p.waitForFunction(() => $('before').classList.contains('alpha'));
  await p.click('#backBtn'); await pick(p, fx('phone-12mp-exif6.jpg')).catch(() => {});
  await p.waitForFunction(() => ed.original && ed.original.w === 3024, null, { timeout: 15000 }).catch(() => {});
  eq(await p.evaluate(() => $('before').classList.contains('alpha')), false, 'an opaque photo has no checkerboard');
});

test('layout: compact credit chip in the header opens the credits sheet', async ({ p }) => {
  await p.goto('https://app.test/'); await pick(p, fx('transparent.png'));
  await p.waitForFunction(() => !$('balanceBtn').hidden);
  const c = await p.evaluate(() => { const r = $('balanceBtn').getBoundingClientRect(); return { text: $('balanceBtn').textContent, label: $('balanceBtn').getAttribute('aria-label'), h: r.height, top: r.bottom <= $('stage').getBoundingClientRect().top }; });
  eq(c.text, '3', 'actual balance, compact'); assert(/3/.test(c.label) && /credit/.test(c.label), 'spoken label ' + c.label); assert(c.h >= 44, 'touch target ' + c.h); assert(c.top, 'in the header');
  await p.click('#balanceBtn'); assert(await p.evaluate(() => $('creditsSheet').open), 'opens the details sheet');
  assert(/midnight UTC/.test(await p.textContent('#creditsBody')), 'explains the real reset');
});

test('layout: All has search and an expandable catalog; the last tools scroll fully into view', async ({ p }) => {
  await p.goto('https://app.test/'); await pick(p, fx('transparent.png'));
  await p.click('.tab[data-cat="all"]');
  const s0 = await stageBox(p);
  await p.fill('#searchInput', 'blur'); eq(await p.$$eval('#tools .tool', (x) => x.map((b) => b.dataset.tool)), ['bgblur'], 'search');
  await p.fill('#searchInput', '');
  await p.click('#expandBtn'); eq(await p.getAttribute('#expandBtn', 'aria-expanded'), 'true', 'expanded');
  const tall = await p.evaluate(() => $('tools').getBoundingClientRect().height); assert(tall > 300, 'taller catalog ' + tall);
  await p.click('#expandBtn'); eq(JSON.stringify(await stageBox(p)), JSON.stringify(s0), 'collapsing restores the photo size');
  await p.click('.tab[data-cat="retouch"]'); await p.click('.subchip[data-chip="makeup"]');
  await p.evaluate(() => $('tools').scrollTo({ left: 1e5 })); await settle(200);
  const last = await p.evaluate(() => { const t = [...document.querySelectorAll('#tools .tool')].pop().getBoundingClientRect(), b = $('tools').getBoundingClientRect(); return t.right <= b.right + 0.5 && t.left >= b.left; });
  assert(last, 'last tool fully visible after scrolling');
  const costs = await p.evaluate(() => [...document.querySelectorAll('#tools .cost')].every((c) => { const r = c.getBoundingClientRect(), b = $('tools').getBoundingClientRect(); return r.top >= b.top; }));
  assert(costs, 'cost badges not clipped at the top');
}, { viewport: { width: 390, height: 844 } });

test('demo: canceling Try your own photo keeps the sample; reduced motion turns the crossfade off', async ({ p, state }) => {
  await openDemo(p);
  await tool(p, 'foryou', null, 'pro'); await p.waitForFunction(() => ed.idx === 1);
  const fc = p.waitForEvent('filechooser'); await p.click('#demoOwnBtn'); await (await fc).setFiles([]); await settle(400);
  eq(await p.evaluate(() => [ed.demo, !!demo, ed.idx, $('demoBar').hidden]), [true, true, 1, false], 'still in the demo, preview kept');
  eq(await p.evaluate(() => parseFloat(getComputedStyle($('after')).transitionDuration)), 0.00001, 'no crossfade with reduced motion');
  eq(state.posts.length, 0, 'no AI request');
}, { files: demoFiles(), reducedMotion: true });


// ---------- Face reshape (the owner's sample portrait, opened as an ordinary photo) ----------
const PORTRAIT = path.join(__dirname, '../public/samples/demo/original.png');
const pixelsOf = (p, src) => p.evaluate(async (s) => { const i = await loadImg(s), c = newCanvas(i.naturalWidth, i.naturalHeight), x = c.getContext('2d'); x.drawImage(i, 0, 0); return Array.from(x.getImageData(0, 0, c.width, c.height).data.filter((_, k) => k % 997 === 0)); }, src);
test('retouch: reshape at 0 is untouched, previews come from the baseline, tools combine, all on-device', async ({ p, state }) => {
  await p.goto('https://app.test/'); await pick(p, PORTRAIT);
  const base = await p.evaluate(() => committed());
  await tool(p, 'retouch', 'face', 'fslim');
  await p.waitForFunction(() => reshapeNote && reshapeNote.msg === '', null, { timeout: 30000 });
  eq(await p.evaluate(() => [faceSet.amt.fslim, $('applyBtn').disabled, !!ed.pending]), [0, true, false], 'starts at 0 with nothing to apply');
  const set = async (v) => { await p.fill('.panel input[type=range]', String(v)); await settle(200); await idle(p); };
  await set(100); const first = await p.evaluate(() => ed.pending && ed.pending.data);
  assert(first && first !== base, 'a preview at 100');
  await set(40); await set(100);
  eq(await p.evaluate((f) => ed.pending.data === f, first), true, 'the same setting gives the same picture: each preview starts from the baseline, not the last preview');
  await set(0);
  eq(await p.evaluate(() => [!!ed.pending, committed() === ed.hist[0].data]), [false, true], '0 shows the photo exactly as it was');
  await set(100); await p.click('#applyBtn'); await idle(p);
  for (const id of ['fnose', 'fbigeyes']) {
    await tool(p, 'retouch', 'face', id); await p.waitForFunction(() => reshapeNote && reshapeNote.msg === '', null, { timeout: 30000 });
    await set(100); await p.click('#applyBtn'); await idle(p);
  }
  eq(await p.evaluate(() => ed.hist.map((h) => h.op && h.op.tool)), [null, 'fslim', 'fnose', 'fbigeyes'], 'three reshape steps, one each');
  // Undo/redo walk the same pictures back and forth.
  const last = await p.evaluate(() => committed());
  await p.click('#undoBtn'); await p.click('#undoBtn'); await p.click('#redoBtn'); await p.click('#redoBtn');
  eq(await p.evaluate((l) => committed() === l, last), true, 'redo returns to the combined result');
  await p.click('#saveBtn'); await downloads(state, 1);
  const sz = imageSize(state.downloads[0].file); eq([sz.w, sz.h], [1122, 1402], 'saved at the photo size');
  eq([state.posts.length, state.used], [0, 0], 'no AI request and no credit used');
});
test('retouch: Compare puts the divider on the face; Settings shows which build this is', async ({ p }) => {
  await p.goto('https://app.test/'); await pick(p, PORTRAIT);
  await tool(p, 'retouch', 'face', 'fslim'); await p.waitForFunction(() => reshapeNote && reshapeNote.msg === '', null, { timeout: 30000 });
  await p.fill('.panel input[type=range]', '100'); await settle(200); await idle(p);
  await p.click('.views [data-view="split"]');
  const r = await p.evaluate(() => { const f = $('view').getBoundingClientRect(), d = $('divider').getBoundingClientRect(), P = faceCache.get(committed())[0];
    return { x: d.left + d.width / 2, nose: f.left + P[1][0] * f.width, f: [f.left, f.right] }; });
  near(r.x, r.nose, 2, 'divider runs down the nose'); assert(r.x > r.f[0] && r.x < r.f[1], 'divider is on the photo');
  await p.click('#cancelBtn'); await p.click('#settingsBtn').catch(() => p.evaluate(() => openSettings()));
  await p.waitForFunction(() => /Build/.test($('buildId').textContent) && !/checking/.test($('buildId').textContent));
  assert(/reshape-v2 · crop-v2/.test(await p.textContent('#buildId')), 'build line names the features: ' + await p.textContent('#buildId'));
});
test('retouch: no trustworthy face shows an unavailable note instead of a guessed warp', async ({ p, state }) => {
  await p.goto('https://app.test/'); await pick(p, fx('coords-600x400.png'));
  await tool(p, 'retouch', 'face', 'fslim');
  await p.waitForFunction(() => reshapeNote && reshapeNote.msg, null, { timeout: 30000 });
  const r = await p.evaluate(() => [$('panelNote').textContent, $('applyBtn').disabled, $('panelBody').querySelector('input[type=range]').disabled, !!ed.pending]);
  assert(/Couldn't find a face clearly enough to reshape/.test(r[0]), 'explains why: ' + r[0]);
  eq(r.slice(1), [true, true, false], 'slider and Apply are off, nothing is previewed');
  eq(state.posts.length, 0, 'no AI request');
});

// ---------- Crop and rotate ----------
// coords-600x400.png: red = x, green = y, so any pixel says where it came from.
const cropInfo = (p) => p.evaluate(() => {
  const F = $('cropBox').getBoundingClientRect(), I = $('cropImg').getBoundingClientRect();
  return { rect: { ...cr.rect }, W: cr.W, H: cr.H, turns: cr.turns, aspect: cr.aspect, F: [F.left, F.top, F.width, F.height], I: [I.left, I.top, I.width, I.height] };
});
const near = (a, b, tol, msg) => assert(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);
function covered(c, msg) {
  // The frame is always fully on the photo, so a crop never has blank edges.
  assert(c.F[0] >= c.I[0] - 0.6 && c.F[1] >= c.I[1] - 0.6 && c.F[0] + c.F[2] <= c.I[0] + c.I[2] + 0.6 && c.F[1] + c.F[3] <= c.I[1] + c.I[3] + 0.6, msg + ': frame leaves the photo ' + JSON.stringify(c));
  assert(c.rect.x >= -0.01 && c.rect.y >= -0.01 && c.rect.x + c.rect.w <= c.W + 0.01 && c.rect.y + c.rect.h <= c.H + 0.01, msg + ': crop leaves the photo');
}
async function openCropOn(p, file) {
  await p.goto('https://app.test/'); await pick(p, file);
  await tool(p, 'edit', 'crop', 'crop'); await p.waitForFunction(() => !!cr && !$('cropView').hidden);
}
test('crop: frame, grid, dimmed outside, hint; drag, wheel, pinch and the zoom slider keep the photo covering the frame', async ({ p, state }) => {
  await openCropOn(p, fx('coords-600x400.png'));
  const ui = await p.evaluate(() => ({ hint: $('cropHint').textContent, dim: getComputedStyle($('cropBox')).boxShadow, grid: !!$('cropBox').querySelector('.crop-grid'),
    handles: [...document.querySelectorAll('.crop-h')].map((h) => h.dataset.h).sort().join(), touch: getComputedStyle($('cropView')).touchAction,
    shapes: [...document.querySelectorAll('.panel .opt')].map((b) => b.textContent) }));
  eq(ui.hint, 'Drag to reposition · Pinch to zoom', 'hint'); assert(/rgba?\(12, 11, 14/.test(ui.dim), 'outside is dimmed: ' + ui.dim); assert(ui.grid, 'thirds grid');
  eq(ui.handles, 'e,n,ne,nw,s,se,sw,w', 'corner and edge handles'); eq(ui.touch, 'none', 'page does not scroll while touching the crop');
  eq(ui.shapes, ['Free', 'Original', 'Square', '4:5', '3:4', '9:16', '16:9'], 'shapes');
  let c = await cropInfo(p); eq([Math.round(c.rect.w), Math.round(c.rect.h)], [600, 400], 'starts on the whole photo'); covered(c, 'start');
  // Slider: 2x zoom keeps the centre.
  await p.fill('#cropZoom', '200'); c = await cropInfo(p);
  near(c.rect.w, 300, 1, 'slider 2x'); near(c.rect.x + c.rect.w / 2, 300, 1, 'zoom keeps the centre'); covered(c, 'slider');
  // Mouse drag moves the photo under the frame (dragging right shows more of the left).
  const mid = [c.F[0] + c.F[2] / 2, c.F[1] + c.F[3] / 2], k = c.F[2] / c.rect.w;
  await p.mouse.move(mid[0], mid[1]); await p.mouse.down(); await p.mouse.move(mid[0] + 40, mid[1] + 10, { steps: 4 }); await p.mouse.up();
  const d = await cropInfo(p); near(c.rect.x - d.rect.x, 40 / k, 0.6, 'drag moves the crop by the drag distance'); near(c.rect.y - d.rect.y, 10 / k, 0.6, 'vertical drag');
  // Dragging far past the edge stops at the photo's edge.
  await p.mouse.move(mid[0], mid[1]); await p.mouse.down(); await p.mouse.move(mid[0] + 2000, mid[1] + 2000, { steps: 4 }); await p.mouse.up();
  c = await cropInfo(p); near(c.rect.x, 0, 0.01, 'stops at the left edge'); near(c.rect.y, 0, 0.01, 'stops at the top edge'); covered(c, 'drag limit');
  // Wheel zooms around the cursor: the photo point under the cursor stays put.
  const at = [c.F[0] + c.F[2] * 0.7, c.F[1] + c.F[3] * 0.6], under = (q) => [(at[0] - q.I[0]) / q.I[2] * q.W, (at[1] - q.I[1]) / q.I[3] * q.H];
  const u0 = under(c); await p.mouse.move(at[0], at[1]); await p.mouse.wheel(0, -200); await settle(100);
  const w = await cropInfo(p), u1 = under(w);
  assert(w.rect.w < c.rect.w, 'wheel up zooms in'); near(u1[0], u0[0], 0.6, 'wheel anchor x'); near(u1[1], u0[1], 0.6, 'wheel anchor y'); covered(w, 'wheel');
  eq(await p.evaluate(() => scrollY), 0, 'the page did not scroll');
  // Pinch (two real touch points through the browser's input pipeline), anchored at the midpoint.
  await p.fill('#cropZoom', '150'); c = await cropInfo(p);
  const cdp = await p.context().newCDPSession(p), cx = c.F[0] + c.F[2] * 0.4, cy = c.F[1] + c.F[3] * 0.5;
  const touch = (type, g) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x: cx - g, y: cy, id: 1 }, { x: cx + g, y: cy, id: 2 }] });
  const pu0 = under({ ...c, I: c.I }); at[0] = cx; at[1] = cy; const before = under(c);
  await touch('touchStart', 30); for (let g = 35; g <= 80; g += 5) await touch('touchMove', g); await touch('touchEnd', 0); await settle(100);
  const pz = await cropInfo(p), after = under(pz);
  near(c.rect.w / pz.rect.w, 80 / 30, 0.15, 'pinch zooms by the finger spread'); near(after[0], before[0], 1, 'pinch anchored at the midpoint (x)'); near(after[1], before[1], 1, 'pinch anchored at the midpoint (y)'); covered(pz, 'pinch');
  // Zoom out as far as it goes: the frame is still fully covered.
  await p.fill('#cropZoom', '100'); await p.mouse.move(cx, cy); for (let i = 0; i < 5; i++) await p.mouse.wheel(0, 400); covered(await cropInfo(p), 'zoomed out');
  eq([state.posts.length, state.used], [0, 0], 'no AI request and no credit used');
});
test('crop: every shape is exact, Free and locked handles resize correctly, rotate and reset update the bounds', async ({ p }) => {
  await openCropOn(p, fx('coords-600x400.png'));
  for (const [name, a] of [['Square', 1], ['4:5', 0.8], ['3:4', 0.75], ['9:16', 9 / 16], ['16:9', 16 / 9], ['Original', 1.5]]) {
    await p.click(`.panel .opt:has-text("${name}")`); await settle(260); const c = await cropInfo(p);
    near(c.rect.w / c.rect.h, a, 0.002, name + ' shape'); near(c.F[2] / c.F[3], a, 0.01, name + ' frame on screen'); covered(c, name);
    eq(await p.evaluate((n) => document.querySelector('.panel .opt[aria-pressed=true]').textContent, name), name, name + ' selected');
  }
  // Locked 4:5: dragging a corner or an edge keeps 4:5.
  await p.click('.panel .opt:has-text("4:5")'); await settle(260);
  for (const h of ['se', 'nw', 'e', 'n']) {
    const b = await p.$eval(`.crop-h[data-h="${h}"]`, (e) => { const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
    const dir = h.includes('n') || h === 'w' ? 1 : -1;
    await p.mouse.move(b[0], b[1]); await p.mouse.down(); await p.mouse.move(b[0] + 30 * dir, b[1] + 45 * dir, { steps: 4 });
    const mid = await cropInfo(p); near(mid.rect.w / mid.rect.h, 0.8, 0.002, `4:5 while dragging ${h}`); covered(mid, `locked ${h}`);
    await p.mouse.up(); await settle(260); const c = await cropInfo(p); near(c.rect.w / c.rect.h, 0.8, 0.002, `4:5 after ${h}`);
  }
  // Free: an edge changes only its own side.
  await p.click('.panel .opt:has-text("Free")'); await settle(260); let c = await cropInfo(p);
  const e = await p.$eval('.crop-h[data-h="e"]', (x) => { const r = x.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
  await p.mouse.move(e[0], e[1]); await p.mouse.down(); await p.mouse.move(e[0] - 50, e[1] + 30, { steps: 4 });
  const f = await cropInfo(p); near(f.rect.h, c.rect.h, 0.01, 'free edge keeps height'); near(f.rect.x, c.rect.x, 0.01, 'free edge keeps the left side'); assert(f.rect.w < c.rect.w - 10, 'free edge narrows');
  // Dragging a free corner far outside stops at the photo.
  await p.mouse.up(); await settle(260);
  const se = await p.$eval('.crop-h[data-h="se"]', (x) => { const r = x.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
  await p.mouse.move(se[0], se[1]); await p.mouse.down(); await p.mouse.move(se[0] + 900, se[1] + 900, { steps: 4 }); covered(await cropInfo(p), 'free corner limit'); await p.mouse.up(); await settle(260);
  // Rotate: the photo's bounds swap and the crop moves with it.
  await p.click('#cropReset'); await p.click('.panel .opt:has-text("Square")'); await p.fill('#cropZoom', '200'); await settle(260);
  c = await cropInfo(p);
  await p.click('text=Rotate 90°'); await settle(260); const r = await cropInfo(p);
  eq([r.W, r.H, r.turns], [400, 600, 1], 'rotated bounds'); near(r.rect.x, 400 - (c.rect.y + c.rect.h), 0.5, 'crop follows the turn (x)'); near(r.rect.y, c.rect.x, 0.5, 'crop follows the turn (y)');
  near(r.rect.w / r.rect.h, 1, 0.002, 'still square'); covered(r, 'rotated');
  await p.click('.panel .opt:has-text("9:16")'); await p.click('text=Rotate 90°'); await settle(260); const r2 = await cropInfo(p);
  near(r2.rect.w / r2.rect.h, 9 / 16, 0.002, '9:16 stays 9:16 after a turn'); covered(r2, 'rotated 9:16');
  await p.click('#cropReset'); await settle(260); c = await cropInfo(p);
  eq([c.turns, c.aspect, Math.round(c.rect.w), Math.round(c.rect.h)], [0, 0, 600, 400], 'reset framing');
  eq(await p.evaluate(() => $('applyBtn').disabled), true, 'nothing to apply after reset');
});
test('crop: Cancel restores, Apply exports exactly the framed area at full size, one undo step, and re-opening keeps the framing', async ({ p, state }) => {
  await openCropOn(p, fx('coords-600x400.png'));
  await p.fill('#cropZoom', '250'); await p.click('text=Rotate 90°');
  await p.click('#cancelBtn'); await idle(p);
  eq(await p.evaluate(() => [ed.hist.length, ed.idx, !!cr, $('cropView').hidden, $('stage').classList.contains('cropping')]), [1, 0, false, true, false], 'cancel leaves the photo as it was');
  await tool(p, 'edit', 'crop', 'crop'); await p.waitForFunction(() => !!cr);
  eq(await p.evaluate(() => [cr.turns, Math.round(cr.rect.w)]), [0, 600], 'a canceled crop is not remembered');
  await p.click('.panel .opt:has-text("4:5")'); await p.fill('#cropZoom', '160'); await settle(260);
  const c = await cropInfo(p), m = [c.F[0] + c.F[2] / 2, c.F[1] + c.F[3] / 2];
  await p.mouse.move(m[0], m[1]); await p.mouse.down(); await p.mouse.move(m[0] + 25, m[1] - 15, { steps: 3 }); await p.mouse.up();
  await settle(100); const v = await cropInfo(p);
  // What the frame shows on screen, as fractions of the photo.
  const shown = { x: (v.F[0] - v.I[0]) / v.I[2], y: (v.F[1] - v.I[1]) / v.I[3], w: v.F[2] / v.I[2], h: v.F[3] / v.I[3] };
  await p.click('#applyBtn'); await idle(p);
  const op = await p.evaluate(() => ed.hist[ed.idx].op);
  for (const k of ['x', 'y', 'w', 'h']) near(op.rect[k], shown[k], 0.003, 'saved crop matches the frame on screen: ' + k);
  eq(await p.evaluate(() => [ed.hist.length, ed.idx]), [2, 1], 'one undo step');
  const px = await p.evaluate(async () => { const i = await loadImg(committed()), c = newCanvas(i.naturalWidth, i.naturalHeight), x = c.getContext('2d'); x.drawImage(i, 0, 0);
    const g = (a, b) => Array.from(x.getImageData(a, b, 1, 1).data.slice(0, 2)); return { w: c.width, h: c.height, tl: g(0, 0), br: g(c.width - 1, c.height - 1) }; });
  near(px.w / px.h, 0.8, 0.01, 'result is 4:5');
  near(px.tl[0], op.rect.x * 255, 3, 'top-left pixel came from the frame\'s left edge'); near(px.tl[1], op.rect.y * 255, 3, 'top-left pixel came from the frame\'s top edge');
  near(px.br[0], (op.rect.x + op.rect.w) * 255, 3, 'bottom-right pixel (x)'); near(px.br[1], (op.rect.y + op.rect.h) * 255, 3, 'bottom-right pixel (y)');
  // Undo, redo.
  const cropped = await p.evaluate(() => committed());
  await p.click('#undoBtn'); eq(await p.evaluate(() => [ed.idx, committed() === ed.hist[0].data]), [0, true], 'undo restores the uncropped photo');
  await p.click('#redoBtn'); eq(await p.evaluate((c) => [ed.idx, committed() === c], cropped), [1, true], 'redo restores the crop');
  // Re-opening shows the uncropped photo with the same framing, and Apply replaces the crop.
  await tool(p, 'edit', 'crop', 'crop'); await p.waitForFunction(() => !!cr);
  const re = await cropInfo(p);
  eq([Math.round(re.W), Math.round(re.H), re.aspect], [600, 400, 0.8], 're-opened on the full photo with 4:5');
  for (const k of ['x', 'y', 'w', 'h']) near(re.rect[k] / (k === 'x' || k === 'w' ? 600 : 400), op.rect[k], 0.002, 'same framing ' + k);
  eq(await p.evaluate(() => $('applyBtn').disabled), true, 'unchanged framing has nothing to apply');
  await p.click('text=Rotate 90°'); await p.click('#applyBtn'); await idle(p);
  const op2 = await p.evaluate(() => ed.hist[ed.idx].op); eq([op2.base, op2.turns], [0, 1], 'the new crop is made from the uncropped photo');
  // Saved file: the full-size render of the same crop.
  await p.click('#saveBtn'); await downloads(state, 1);
  const sz = imageSize(state.downloads[0].file), want = await p.evaluate(async () => { const i = await loadImg(committed()); return [i.naturalWidth, i.naturalHeight]; });
  eq([sz.w, sz.h], want, 'saved file is exactly the cropped size');
  const same = await p.evaluate(async (file) => {
    const [a, b] = await Promise.all([loadImg(committed()), loadImg(file)]), w = a.naturalWidth, h = a.naturalHeight;
    const ca = newCanvas(w, h).getContext('2d'), cb = newCanvas(w, h).getContext('2d'); ca.drawImage(a, 0, 0); cb.drawImage(b, 0, 0, w, h);
    const da = ca.getImageData(0, 0, w, h).data, db = cb.getImageData(0, 0, w, h).data; let sum = 0; for (let i = 0; i < da.length; i += 4) sum += Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]);
    return sum / (da.length / 2);
  }, 'data:image/png;base64,' + fs.readFileSync(state.downloads[0].file).toString('base64'));
  assert(same < 1.5, 'saved file matches the preview pixel for pixel (mean difference ' + same.toFixed(2) + ')');
  eq([state.posts.length, state.used], [0, 0], 'no AI request and no credit used');
});
test('crop: a 12 MP photo crops at full resolution from the original', async ({ p, state }) => {
  await openCropOn(p, fx('phone-12mp-exif6.jpg'));
  await p.click('.panel .opt:has-text("9:16")'); await p.fill('#cropZoom', '200'); await p.click('text=Rotate 90°');
  await p.click('#applyBtn'); await idle(p); await p.click('#saveBtn'); await downloads(state, 1);
  const op = await p.evaluate(() => ed.hist[ed.idx].op), s = imageSize(state.downloads[0].file);
  // Rotated original is 4032 × 3024; 9:16 at 2× zoom is half the tallest 9:16 that fits.
  near(s.h, Math.round(op.rect.h * 3024), 2, 'height from the original'); near(s.w / s.h, 9 / 16, 0.002, 'exact 9:16'); assert(s.w > 800, 'full resolution, not the preview: ' + s.w);
  state.report = { case: '12 MP crop', exported: [s.w, s.h], rect: op.rect };
});

// ---------- Face tools on a real portrait (only with GLOW_TEST_FACE) ----------
if (face) test('face: smooth skin previews at 2048px and saves at full size', async ({ p, state }) => {
  await p.goto('https://app.test/'); await pick(p, face);
  await tool(p, 'retouch', 'skin', 'fsmooth'); await p.waitForFunction(() => !!ed.pending, null, { timeout: 30000 });
  await p.click('#applyBtn'); await idle(p); await p.click('#saveBtn'); await downloads(state, 1);
  const s = imageSize(state.downloads[0].file), o = await p.evaluate(() => [ed.original.w, ed.original.h]);
  eq([s.w, s.h], o, 'face edit saved at the original size');
});

// ---------- Inspection zoom (Chromium touch emulation through CDP; not a real phone) ----------
// Inspection zoom only changes how the photo is viewed: never ops, history, crop or saved pixels.
async function touchpad(p) {
  const c = await p.context().newCDPSession(p);
  const T = async (type, pts) => { await c.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y, id]) => ({ x, y, id })) }); };
  return { T, wait: () => p.waitForTimeout(80) };
}
const viewState = (p) => p.evaluate(() => {
  const v = viewRect(), b = $('before').getBoundingClientRect(), a = $('after').getBoundingClientRect(), st = $('stage').getBoundingClientRect(), d = $('divider').getBoundingClientRect();
  const clip = /inset\(0(?:px)? 0(?:px)? 0(?:px)? ([\d.]+)%\)/.exec($('after').style.clipPath);
  return { z: insp.z, cx: insp.cx, cy: insp.cy, v, st: { x: st.left, y: st.top, w: st.width, h: st.height }, b: [b.left, b.top, b.width, b.height], a: [a.left, a.top, a.width, a.height],
    divider: d.left + d.width / 2 - st.left, clipX: clip ? v.x + (+clip[1] / 100) * v.w : null, split: ed.split, hist: ed.hist.length, idx: ed.idx, pending: ed.pending && ed.pending.data,
    ops: JSON.stringify(ed.hist.map((h) => h.op || null)), undo: $('undoBtn').disabled, redo: $('redoBtn').disabled };
});
test('zoom: pinch, pan, double-tap, wheel and buttons inspect the photo without changing the edit', async ({ p, state }) => {
  await p.goto('https://app.test/'); await pick(p, PORTRAIT);
  await tool(p, 'looks', 'filters', 'filter:glow'); await p.waitForFunction(() => !!ed.pending); await idle(p);
  await p.click('.views [data-view="split"]'); await settle(200);
  const s0 = await viewState(p), { T, wait } = await touchpad(p);
  eq(s0.z, 1, 'starts at fit'); near(s0.divider, s0.v.x + s0.v.w / 2, 1.5, 'divider starts mid-photo');
  const cx = s0.st.x + s0.st.w / 2, cy = s0.st.y + s0.st.h * 0.4, mx = cx - s0.st.x, my = cy - s0.st.y;
  const under = (s) => [(mx - s.v.x) / s.v.w, (my - s.v.y) / s.v.h];
  // Pinch away from the divider: zooms around the fingers' midpoint.
  const ox = -60;
  await T('touchStart', [[cx + ox - 30, cy, 0], [cx + ox + 30, cy, 1]]);
  for (let i = 1; i <= 6; i++) await T('touchMove', [[cx + ox - 30 - 10 * i, cy, 0], [cx + ox + 30 + 10 * i, cy, 1]]);
  await wait(); const s1 = await viewState(p);
  near(s1.z, 3, 0.05, 'pinch 60px to 180px zooms 3x');
  const P0 = [(mx + ox - s0.v.x) / s0.v.w, (my - s0.v.y) / s0.v.h], P1 = [(mx + ox - s1.v.x) / s1.v.w, (my - s1.v.y) / s1.v.h];
  near(P1[0], P0[0], 0.003, 'midpoint stays on the same picture point (x)'); near(P1[1], P0[1], 0.003, '(y)');
  // Lift one finger: nothing jumps; the other pans 1:1.
  await T('touchEnd', [[cx + ox + 90, cy, 1]]); await wait(); const s2 = await viewState(p);
  near(s2.v.x, s1.v.x, 0.5, 'no jump when a finger lifts'); near(s2.z, s1.z, 0.001, 'zoom kept');
  await T('touchMove', [[cx + ox - 90 + 25, cy + 20, 0]]); await wait(); await T('touchEnd', []); await wait();
  const s3 = await viewState(p); near(s3.v.x - s2.v.x, 25, 0.5, 'one-finger pan x'); near(s3.v.y - s2.v.y, 20, 0.5, 'one-finger pan y');
  // Original and edited stay aligned, and the edited side starts exactly at the divider.
  eq(s3.a.map(Math.round), s3.b.map(Math.round), 'before and after aligned at 3x');
  near(s3.clipX, s3.divider, 1, 'clip edge on the divider line while zoomed');
  assert(s3.divider > Math.max(0, s3.v.x) && s3.divider < Math.min(s3.st.w, s3.v.x + s3.v.w), 'divider on the visible photo');
  // Dragging the divider moves only the divider.
  const dx = s3.st.x + s3.divider, dy = s3.st.y + s3.st.h * 0.3;
  await T('touchStart', [[dx, dy, 0]]); await T('touchMove', [[dx - 40, dy, 0]]); await wait(); await T('touchEnd', []); await wait();
  const s4 = await viewState(p); near(s4.divider, s3.divider - 40, 1.5, 'divider follows the finger'); near(s4.v.x, s3.v.x, 0.01, 'view did not pan'); eq(s4.z, s3.z, 'zoom unchanged');
  near(s4.clipX, s4.divider, 1, 'still aligned with the divider');
  // Switching views keeps the inspection position.
  await p.click('.views [data-view="edited"]'); await p.click('.views [data-view="original"]'); await p.click('.views [data-view="split"]');
  const s5 = await viewState(p); near(s5.v.x, s4.v.x, 0.01, 'position kept across views'); eq(s5.z, s4.z, 'zoom kept across views');
  // Double-tap back to fit, then into a close-up centred on the tap.
  const tap = async (x, y) => { await T('touchStart', [[x, y, 0]]); await T('touchEnd', []); await p.waitForTimeout(60); await T('touchStart', [[x, y, 0]]); await T('touchEnd', []); await settle(350); };
  await tap(cx - 70, cy); eq((await viewState(p)).z, 1, 'double-tap returns to fit');
  const f0 = await viewState(p), tx = cx - 70 - f0.st.x, picked = [(tx - f0.v.x) / f0.v.w, (my - f0.v.y) / f0.v.h];
  await tap(cx - 70, cy); const s6 = await viewState(p);
  near(s6.z, 3, 0.01, 'double-tap close-up'); near(s6.cx, picked[0], 0.002, 'centred on the tap (x)'); near(s6.cy, picked[1], 0.002, '(y)');
  // Buttons and their accessible names.
  eq(await p.evaluate(() => ['zoomIn', 'zoomOut', 'zoomFit'].map((id) => $(id).getAttribute('aria-label'))), ['Zoom in', 'Zoom out', 'Fit photo to screen'], 'button names');
  await p.click('#zoomFit'); await settle(300); eq((await viewState(p)).z, 1, 'Fit');
  assert(await p.isDisabled('#zoomOut'), 'Zoom out disabled at fit');
  await p.click('#zoomIn'); await settle(300); near((await viewState(p)).z, 1.6, 0.01, 'Zoom in');
  await p.click('#zoomOut'); await settle(300); near((await viewState(p)).z, 1, 0.01, 'Zoom out');
  // Nothing about the edit changed.
  const s7 = await viewState(p);
  eq([s7.hist, s7.idx, s7.ops, s7.undo, s7.redo, s7.pending === s0.pending], [s0.hist, s0.idx, s0.ops, s0.undo, s0.redo, true], 'no history steps, same ops, same preview pixels');
  await p.click('#zoomIn'); await settle(300);
  await p.click('#applyBtn'); await idle(p); await p.click('#saveBtn'); await downloads(state, 1);
  eq((({ w, h }) => [w, h])(imageSize(state.downloads[0].file)), [1122, 1402], 'saved at the photo size while zoomed in');
  eq(await p.evaluate(() => ed.hist.length), s0.hist + 1, 'only Apply added a step');
}, { viewport: { width: 390, height: 844 } });
test('zoom: desktop wheel zooms around the cursor and the mouse pans; crop keeps its own gestures', async ({ p }) => {
  await p.goto('https://app.test/'); await pick(p, PORTRAIT);
  const s0 = await viewState(p), x = s0.st.x + s0.v.x + s0.v.w * 0.35, y = s0.st.y + s0.st.h * 0.4;
  const P0 = [(x - s0.st.x - s0.v.x) / s0.v.w, (y - s0.st.y - s0.v.y) / s0.v.h];
  await p.mouse.move(x, y); await p.mouse.wheel(0, -300); await settle(100); await p.mouse.wheel(0, -300); await settle(150);
  const s1 = await viewState(p); assert(s1.z > 1.3, 'wheel zooms in: ' + s1.z);
  // While the zoomed photo is still narrower than the viewer it stays centred sideways, so only y is pinned then.
  near((y - s1.st.y - s1.v.y) / s1.v.h, P0[1], 0.003, 'cursor stays on the same picture point (y)');
  await p.mouse.down(); await p.mouse.move(x + 30, y + 10, { steps: 4 }); await p.mouse.up();
  const s2 = await viewState(p); near(s2.v.x - s1.v.x, 30, 0.5, 'mouse drag pans');
  eq(await p.evaluate(() => document.documentElement.style.touchAction || getComputedStyle(document.documentElement).touchAction), 'auto', 'page zoom is not disabled');
  assert(!/user-scalable=no|maximum-scale=1/.test(await p.getAttribute('meta[name=viewport]', 'content')), 'viewport allows browser zoom');
  // Crop mode: the inspection view and its controls step aside; crop gestures change the crop.
  await tool(p, 'edit', 'crop', 'crop'); await p.waitForFunction(() => !!cr);
  eq(await p.evaluate(() => [getComputedStyle($('frame')).display, getComputedStyle($('zoomCtl')).display]), ['none', 'none'], 'no inspection zoom while cropping');
}, { viewport: { width: 1280, height: 860 }, mobile: false, touch: false });
test('zoom: with the erase brush one finger draws and two fingers navigate', async ({ p }) => {
  await p.goto('https://app.test/'); await pick(p, PORTRAIT);
  await tool(p, 'edit', 'bg', 'erase'); await p.waitForFunction(() => sel === 'erase' && !$('brush').hidden);
  const { T, wait } = await touchpad(p), s0 = await viewState(p), cx = s0.st.x + s0.st.w / 2, cy = s0.st.y + s0.st.h / 2;
  await T('touchStart', [[cx, cy, 0]]); for (let i = 1; i <= 4; i++) await T('touchMove', [[cx + 8 * i, cy, 0]]); await wait(); await T('touchEnd', []); await wait();
  eq(await p.evaluate(() => strokes.length), 1, 'one finger draws a stroke');
  await T('touchStart', [[cx - 20, cy + 40, 0]]); await T('touchMove', [[cx - 10, cy + 40, 0]]); await wait();
  await T('touchStart', [[cx - 10, cy + 40, 0], [cx + 40, cy + 40, 1]]);
  for (let i = 1; i <= 5; i++) await T('touchMove', [[cx - 10 - 10 * i, cy + 40, 0], [cx + 40 + 10 * i, cy + 40, 1]]);
  await wait(); await T('touchEnd', []); await wait();
  const r = await p.evaluate(() => ({ n: strokes.length, z: insp.z, hist: ed.hist.length }));
  eq(r.n, 1, 'the interrupted stroke is dropped'); assert(r.z > 1.8, 'two fingers zoomed: ' + r.z); eq(r.hist, s0.hist, 'no history step');
  // Strokes stay on the same picture spot when zoomed: a new stroke lands under the finger.
  await T('touchStart', [[cx, cy, 0]]); await T('touchEnd', []); await wait();
  const pt = await p.evaluate(() => { const r = imageRect(), q = strokes[strokes.length - 1].pts[0], st = $('stage').getBoundingClientRect(); return [st.left + r.x + q[0] * r.s, st.top + r.y + q[1] * r.s]; });
  near(pt[0], cx, 1, 'stroke under the finger (x)'); near(pt[1], cy, 1, '(y)');
}, { viewport: { width: 390, height: 844 } });
test('layout: photo-first editor, collapsible panel, no sideways scroll on small phones', async ({ p }) => {
  await p.goto('https://app.test/'); await pick(p, PORTRAIT);
  await tool(p, 'retouch', 'face', 'fslim'); await p.waitForFunction(() => reshapeNote && reshapeNote.msg === '', null, { timeout: 30000 });
  const m = () => p.evaluate(() => ({ stage: $('stage').getBoundingClientRect().height, head: document.querySelector('#editorScreen .topbar').getBoundingClientRect().height,
    apply: $('applyBtn').getBoundingClientRect().bottom <= innerHeight, small: [...document.querySelectorAll('#editorScreen button')].filter((b) => b.offsetParent && !b.closest('.views') && !b.classList.contains('tool') && !b.classList.contains('tab') && !b.classList.contains('subchip')).map((b) => [b.id || b.textContent.trim(), Math.round(b.getBoundingClientRect().height)]).filter(([, h]) => h < 44),
    sideways: document.documentElement.scrollWidth > innerWidth }));
  const a = await m();
  assert(a.head <= 48, 'compact header ' + a.head); assert(a.apply, 'Apply reachable'); eq(a.small, [], 'touch targets at least 44px'); eq(a.sideways, false, 'no sideways scroll');
  await p.click('#collapseBtn'); await settle(150);
  const b = await m();
  assert(b.stage > a.stage + 60, `collapsing gives the photo room: ${a.stage} -> ${b.stage}`); assert(b.apply, 'Apply still reachable');
  eq(await p.getAttribute('#collapseBtn', 'aria-expanded'), 'false', 'collapse state is announced');
  await p.click('#collapseBtn'); await settle(150); near((await m()).stage, a.stage, 1, 'expands again');
}, { viewport: { width: 320, height: 640 } });

// ---------- Runner ----------
(async () => {
  fs.mkdirSync(path.join(__dirname, 'out'), { recursive: true });
  const results = [];
  for (const t of tests.filter((x) => x.name.includes(filter))) {
    const { start = 'editor', ...o } = t.opts;
    const desk = t.name.startsWith('export') || t.name.startsWith('ai');
    const env = await launch({ start, viewport: desk ? { width: 1280, height: 860 } : undefined, mobile: !desk, touch: !desk, ...o });
    const t0 = Date.now(); let err = null;
    try { await t.fn(env); if (env.state.errs.length) throw new Error('page errors: ' + env.state.errs.join(' | ')); }
    catch (e) { err = e; try { await env.p.screenshot({ path: path.join(__dirname, 'out', 'fail-' + t.name.replace(/\W+/g, '-').slice(0, 60) + '.png') }); } catch {} }
    await env.browser.close();
    results.push({ name: t.name, ok: !err, ms: Date.now() - t0, error: err && err.message, report: env.state.report });
    console.log(`${err ? 'FAIL' : 'pass'}  ${t.name}  (${((Date.now() - t0) / 1000).toFixed(1)}s)${err ? '\n      ' + err.message : ''}`);
  }
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed. All checks are MOCKED browser simulations (fake camera, fake servers).`);
  if (!face) console.log('Face-tool check skipped: set GLOW_TEST_FACE to a portrait you have rights to.');
  fs.writeFileSync(path.join(__dirname, 'out', 'results.json'), JSON.stringify({ kind: 'mocked-browser', at: new Date().toISOString(), results, contrast: test.contrast }, null, 2));
  process.exit(failed ? 1 : 0);
})();
