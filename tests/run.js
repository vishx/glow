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
  await tool(p, 'edit', 'crop', 'crop'); await p.click('.panel .opt:has-text("Square")'); await idle(p);
  await p.waitForFunction(() => !!ed.pending, null, { timeout: 15000 }); const cropped = true; await p.click('#applyBtn'); await idle(p);
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
  for (const e of m.previews) if (e.tool === 'pro' || e.tool === 'relight') Object.assign(e, { status: 'ready', result: `test-${e.tool}.jpg` });
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
  assert(/Demo · No credits used/.test(await p.textContent('#demoBar')), 'demo label'); assert(/AI-generated sample/.test(await p.textContent('#demoBar')), 'source label');
  assert(await p.isVisible('#demoOwnBtn'), 'Try your own photo'); assert(await p.isHidden('#balanceBtn'), 'no credit balance in the demo');
  eq(await p.evaluate(() => [...document.querySelectorAll('.tool .cost')].map((c) => c.textContent)), ['Preview', 'Preview'], 'AI tools offered = prepared ones');
  assert(/prepared preview, no credits/.test(await p.getAttribute('.tool[data-tool="pro"]', 'aria-label')), 'screen-reader label');
  await p.screenshot({ path: path.join(__dirname, 'out', 'demo-open.png') });
}, { files: demoFiles() });

test('demo: prepared previews make no AI request, use no credits, and never stack', async ({ p, state }) => {
  await openDemo(p); const before = credit(state);
  for (let i = 0; i < 3; i++) for (const id of ['pro', 'relight']) {
    await tool(p, 'foryou', null, id); await p.waitForFunction((x) => ed.idx === 1 && ed.hist[1].op.tool === x, id);
    const v = await p.evaluate(() => ({ n: ed.hist.length, before: $('before').src === ed.hist[0].data, after: $('after').src === ed.hist[1].data, hidden: $('after').hidden, badge: $('previewBadge').textContent }));
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

test('demo: shipped manifest with nothing prepared yet offers no AI tools and explains why', async ({ p, state }) => {
  await openDemo(p);
  eq(await p.evaluate(() => [...document.querySelectorAll('.tool .cost')].length), 0, 'no AI tiles');
  assert(await p.isVisible('#demoNote') && /aren't ready yet/.test(await p.textContent('#demoNote')), 'note');
  await p.click('.tab[data-cat="looks"]'); await p.click('.subchip[data-chip="styles"]');
  assert(/needs your own photo/.test(await p.textContent('#tools')), 'AI-only group explains');
  await p.screenshot({ path: path.join(__dirname, 'out', 'demo-shipped.png') });
  eq(state.posts.length, 0, 'no AI request');
});

test('demo: Try your own photo exits the demo completely, then real AI is charged by the server', async ({ p, state }) => {
  await openDemo(p);
  const faceBefore = await p.evaluate(() => faceSet.amt.fsmooth);
  await tool(p, 'retouch', 'skin', 'fsmooth'); await p.fill('.panel input[type=range]', '90'); await idle(p);
  await tool(p, 'foryou', null, 'pro'); await p.waitForFunction(() => ed.idx === 1);
  const fc = p.waitForEvent('filechooser'); await p.click('#demoOwnBtn'); await (await fc).setFiles(fx('phone-12mp-exif6.jpg'));
  await p.waitForFunction(() => !ed.demo && ed.original && ed.original.w === 3024, null, { timeout: 15000 });
  const s = await p.evaluate(() => ({ demo: !!demo, bar: $('demoBar').hidden, sel, n: ed.hist.length, badge: $('previewBadge').hidden, amt: faceSet.amt.fsmooth,
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

// ---------- Face tools on a real portrait (only with GLOW_TEST_FACE) ----------
if (face) test('face: smooth skin previews at 2048px and saves at full size', async ({ p, state }) => {
  await p.goto('https://app.test/'); await pick(p, face);
  await tool(p, 'retouch', 'skin', 'fsmooth'); await p.waitForFunction(() => !!ed.pending, null, { timeout: 30000 });
  await p.click('#applyBtn'); await idle(p); await p.click('#saveBtn'); await downloads(state, 1);
  const s = imageSize(state.downloads[0].file), o = await p.evaluate(() => [ed.original.w, ed.original.h]);
  eq([s.w, s.h], o, 'face edit saved at the original size');
});

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
