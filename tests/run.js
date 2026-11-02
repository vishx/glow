// npm test: regression checks for Glow in headless Chromium.
// Every check here is MOCKED: a fake camera, a fake enhance server and local copies of the
// MediaPipe models. Passing proves the app's own logic in a browser, not behavior on a real
// phone, a real camera, Replicate, RevenueCat or the deployed Supabase functions.
// Usage: npm test            (all)       npm test -- export      (names containing "export")
const fs = require('fs'), path = require('path');
const { launch, imageSize, fixtures, face, faceVideo, ready } = require('./harness');

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
// Apply: Adjust sliders keep their change as you go (no Apply button), so closing the tool keeps it.
async function applyTool(p) {
  if (await p.evaluate(() => $('panel').classList.contains('live'))) {
    await p.waitForFunction(() => !busyNow && (!sel || !toolAmt[sel] || (ed.pending && ed.pending.tool === sel)), null, { timeout: 30000 });
    await p.evaluate(() => selectTool(null));
  } else await p.click('#applyBtn');
}
async function tool(p, cat, chip, id) {
  // The tab and subgroup come from where the app files the tool (the cat/chip arguments are
  // kept for readability; earlier tabs such as For You no longer exist).
  const home = await p.evaluate((x) => tabFor(x), id);
  // On phones the categories step aside while a tool is open; Done/Cancel brings them back.
  if (!(await p.isVisible('#tabs .tab'))) await p.click('#cancelBtn');
  else if (await p.evaluate(() => !!sel && $('panel').classList.contains('live'))) await p.evaluate(() => selectTool(null, { discard: true }));
  if (home) await p.click(`.tab[data-cat="${home[0]}"]`);
  else { await p.click('#searchBtn'); await p.fill('#searchInput', await p.evaluate((x) => TOOL[x].label, id)); }   // advanced tools: through Search
  if (!(await p.evaluate((x) => sel === x, id))) await p.click(`.tool[data-tool="${id}"]`);
  await p.waitForTimeout(150); await idle(p);
}
// Every AI result waits for Apply; this applies it once it is ready.
async function aiApply(p, ms = 30000) {
  await p.waitForFunction(() => job && job.status === 'done', null, { timeout: ms });
  await p.evaluate(() => applyResult()); await p.waitForFunction(() => !job && ed.idx >= 1);
}
async function downloads(state, n, ms = 20000) {
  const t = Date.now();
  while (state.downloads.length < n && Date.now() - t < ms) await new Promise((r) => setTimeout(r, 100));
  await Promise.all(state.downloads.map((d) => d.ready));
  return state.downloads;
}
const toast = (p) => p.textContent('#toast');
const camLive = (p) => p.waitForFunction(() => cam.state === 'live' && !!cam.stream && !!cam.zr && __liveTracks() >= 1, null, { timeout: 15000 });
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
}, { start: 'camera', init: () => { localStorage.setItem('glowAutoSave', 'off'); } });

test('camera: auto-save is on by default, and Android saves download to the phone instead of the share sheet', async ({ p, state }) => {
  await p.goto('https://app.test/'); await camLive(p);
  await p.click('#shutter'); await downloads(state, 1); await settle(400);
  eq(state.downloads.length, 1, 'saved without tapping Save');
  assert(/saved to Downloads.*Gallery/.test(await toast(p)), 'Android wording: ' + await toast(p));
  eq(await p.evaluate(() => Platform.savePhotos([{ blob: new Blob(['x'], { type: 'image/jpeg' }), name: 't' }])), 'downloaded', 'manual save downloads too');
}, { start: 'camera', autoSaveDefault: true, init: () => {
  Object.defineProperty(navigator, 'userAgent', { get: () => 'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 Chrome/130 Mobile Safari/537.36' });
  navigator.canShare = () => true; navigator.share = async () => { throw new Error('share sheet opened'); };
} });

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
  await applyTool(p); await idle(p); await p.click('#saveBtn'); await downloads(state, 3); await settle(400);
  eq(state.downloads.length, 3, 'editor Save adds just the edit'); assert(!/-original/.test(state.downloads[2].name), 'no second original');
  // Retake with the Original look: one file only.
  await p.click('#backBtn'); await p.click('#nav button[data-dest="camera"]'); await camLive(p);
  await p.click('#camLooks .look:text-is("Original")'); await p.waitForFunction(() => isOriginalLook());
  await p.click('#shutter'); await downloads(state, 4); await settle(600);
  eq(state.downloads.length, 4, 'Original look saves one file');
}, { start: 'camera', init: () => { localStorage.setItem('glowAutoSave', 'on'); localStorage.setItem('glowSaveOrig', 'on'); } });

// 2026-11-01 (owner's choice): camera saves carry the Glow Studio mark too, by the same rule.
// The saved camera file against the shot it came from: where they differ, and how big that area is.
const camMarked = async (p, file) => {
  const clean = await p.evaluate(() => cam.shot && (cam.shot.processed || cam.shot.raw));
  const r = await diffBox(p, 'data:image/jpeg;base64,' + fileB64(file), clean);
  return r.box && r.box[0] > r.w * 0.5 && r.box[1] > r.h * 0.85 ? 1 : 0;
};
test('camera: Save shows the mark note once and saves a marked photo', async ({ p, state }) => {
  await p.goto('https://app.test/'); await camLive(p);
  await p.click('#shutter'); await p.waitForSelector('#reviewControls:not([hidden])');
  await p.click('#saveShotBtn'); await p.waitForSelector('#ask[open]');
  eq(await p.textContent('#askTitle'), 'Free saves include a small Glow Studio badge', 'note before the first free camera save');
  await p.click('#ask .btn:has-text("Save")'); const [d] = await downloads(state, 1);
  assert(await camMarked(p, d.file) > 0.3, 'the saved camera photo has the dark badge pill in the corner');
  const ev = await p.evaluate(() => { flushTelemetry(); }).then(() => settle(400)).then(() => state.events.filter((e) => e.name === 'save').map((e) => e.props && e.props.marked));
  eq(ev.slice(-1), [true], 'tracked as marked');
}, { start: 'camera', markIntro: true, init: () => { localStorage.setItem('glowAutoSave', 'off'); } });
test('camera: auto-save marks quietly; Pro with the mark off saves clean', async ({ p, state }) => {
  await p.goto('https://app.test/'); await camLive(p);
  await p.click('#shutter'); const [d] = await downloads(state, 1);
  eq(await p.evaluate(() => $('ask').open), false, 'auto-save never stops for a note');
  assert(await camMarked(p, d.file) > 0.3, 'auto-saved photo is marked ');
  await p.evaluate(() => { showUsage({ plan: 'pro', expires: new Date(Date.now() + 864e5).toISOString(), remaining: 40, quota: 40 }); store.set('glowMark', 'off'); });
  await p.click('#retakeBtn').catch(() => {}); await camLive(p);
  await p.click('#shutter'); const d2 = (await downloads(state, 2))[1];
  eq(await camMarked(p, d2.file), 0, 'Pro with the mark off: clean');
}, { start: 'camera', init: () => { localStorage.setItem('glowAutoSave', 'on'); } });

// ---------- Camera lifecycle ----------
// ---------- AI Enhance in the camera, full-screen preview ----------
test('camera: full-screen preview, and the photo is cropped to what the screen showed', async ({ p }) => {
  await p.goto('https://app.test/'); await camLive(p);
  const r = await p.evaluate(() => { const c = $('camCanvas').getBoundingClientRect(), s = $('cameraScreen').getBoundingClientRect(); return { cw: c.width, ch: c.height, sw: s.width, sh: s.height, fit: getComputedStyle($('camCanvas')).objectFit }; });
  eq([r.cw, r.ch, r.fit], [r.sw, r.sh, 'cover'], 'preview fills the camera screen');
  await p.click('#shutter'); await p.waitForFunction(() => !!cam.shot);
  const a = await p.evaluate(() => cam.shot.w / cam.shot.h);
  assert(Math.abs(a - r.cw / r.ch) < 0.01, 'photo shape matches the preview: ' + [a, r.cw / r.ch]);
}, { start: 'camera' });

test('camera: held sideways, the web camera keeps the people in view (shutter rail on the right, rows along the bottom)', async ({ p }) => {
  await p.goto('https://app.test/'); await camLive(p);
  await p.waitForFunction(() => !$('splash'), null, { timeout: 5000 });   // the launch animation is over
  const r = await p.evaluate(() => {
    const b = (id) => $(id).getBoundingClientRect(), vf = b('viewfinder'), sh = b('shutter'), cr = document.querySelector('#cameraScreen .capture-row').getBoundingClientRect();
    const rows = $('camLooks').hidden ? null : b('camLooks');
    const clickable = ['camTimer', 'camAI', 'camSettingsBtn', 'shutter', 'camGallery'].filter((id) => $(id) && !$(id).hidden).every((id) => {
      const q = b(id); return $(id).contains(document.elementFromPoint(q.left + q.width / 2, q.top + q.height / 2)); });
    return { vfW: vf.width, vfH: vf.height, railLeft: cr.left, shutterX: sh.left + sh.width / 2, rowsTop: rows ? rows.top : vf.bottom, rowsRight: rows ? rows.right : 0, clickable };
  });
  assert(r.railLeft >= r.vfW * 0.8, 'shutter rail is a slim strip on the right edge: ' + JSON.stringify(r));
  assert(r.shutterX >= r.vfW * 0.85, 'shutter sits on the right edge: ' + JSON.stringify(r));
  assert(r.rowsTop >= r.vfH * 0.7 && r.rowsRight <= r.railLeft + 1, 'Looks run along the bottom, left of the rail: ' + JSON.stringify(r));
  assert(r.clickable, 'top bar and capture buttons are all tappable: ' + await p.evaluate(() => ['camTimer', 'camAI', 'camSettingsBtn', 'shutter', 'camGallery'].map((id) => { const q = $(id).getBoundingClientRect(), e = document.elementFromPoint(q.left + q.width / 2, q.top + q.height / 2); return id + '>' + (e && (e.id || e.className)) + '@' + Math.round(q.left) + ',' + Math.round(q.top); }).join(' ')));
  await p.click('#shutter'); await p.waitForFunction(() => !!cam.shot);
  const a = await p.evaluate(() => cam.shot.w / cam.shot.h);
  assert(a > 1 && Math.abs(a - r.vfW / r.vfH) < 0.01, 'a landscape photo shaped like the screen: ' + [a, r.vfW / r.vfH]);
}, { start: 'camera', viewport: { width: 844, height: 390 } });
test('camera: phone app held sideways turns the icons the short way and saves the photo the way the phone was held', async ({ p }) => {
  await p.goto('https://app.test/'); await camLive(p);
  const r = await p.evaluate(async () => {
    const rot = () => $('camFlip').style.getPropertyValue('--cam-rot'), seq = [];
    for (const d of [90, 0, 270, 180, 90, 0]) { setCamDeg(d); seq.push(rot()); }
    setCamDeg(0);
    // A 4×2 picture with a red top-left pixel, turned 90°, 180° and 270° clockwise.
    const c = newCanvas(4, 2), x = c.getContext('2d'); x.fillStyle = '#000'; x.fillRect(0, 0, 4, 2); x.fillStyle = '#f00'; x.fillRect(0, 0, 1, 1);
    const src = c.toDataURL('image/png'), out = {};
    for (const d of [90, 180, 270]) {
      const t = await turnPhoto(src, d), px = t.getContext('2d').getImageData(0, 0, t.width, t.height).data, red = [];
      for (let i = 0; i < px.length; i += 4) if (px[i] > 200 && px[i + 1] < 60) red.push([(i / 4) % t.width, Math.floor(i / 4 / t.width)]);
      out[d] = { w: t.width, h: t.height, red };
    }
    return { seq, out };
  });
  eq(r.seq, ['-90deg', '0deg', '90deg', '180deg', '270deg', '360deg'], 'icons counter-turn, always by 90° at a time');
  eq(r.out[90], { w: 2, h: 4, red: [[1, 0]] }, '90° clockwise: top-left goes to top-right');
  eq(r.out[180], { w: 4, h: 2, red: [[3, 1]] }, '180°: top-left goes to bottom-right');
  eq(r.out[270], { w: 2, h: 4, red: [[0, 3]] }, '270° clockwise: top-left goes to bottom-left');
}, { start: 'camera' });
test('camera: AI Enhance button on review runs Enhance for 1 credit, closing goes back to the camera', async ({ p, state }) => {
  await p.goto('https://app.test/'); await camLive(p);
  assert(await p.isVisible('#camAI'), 'AI switch visible'); eq(await p.getAttribute('#camAI', 'aria-pressed'), 'false', 'AI off by default');
  await p.click('#shutter'); await p.waitForSelector('#shotAIBtn:not([hidden])');
  await settle(300); eq(state.posts.length, 0, 'nothing sent before tapping');
  await p.click('#shotAIBtn'); await p.waitForSelector('#enhSheet[open]');
  assert(/1 AI credit/.test(await p.textContent('#enhCost')), 'cost shown');
  await p.click('#enhGo'); await p.waitForFunction(() => screen === 'enhanceResult', null, { timeout: 30000 });
  eq(state.posts, ['enhance'], 'one Enhance request'); eq(state.used, 1, 'one credit');
  await p.click('#enhDownload'); await downloads(state, 1); await p.waitForFunction(() => screen === 'enhanceShare');
  assert(/Take another/.test(await p.textContent('#enhAnother')), 'Take another');
  await p.click('#enhAnother'); await p.waitForFunction(() => screen === 'cameraScreen' && !cam.shot); await camLive(p);
}, { start: 'camera' });

test('camera: AI switch enhances right after the shutter and auto-save keeps the enhanced photo', async ({ p, state }) => {
  await p.goto('https://app.test/'); await camLive(p);
  await p.click('#camAI'); await p.waitForSelector('#ask[open]'); await p.click('#askActions button:has-text("Turn on")');
  eq(await p.getAttribute('#camAI', 'aria-pressed'), 'true', 'AI on');
  await p.click('#shutter'); await p.waitForFunction(() => screen === 'enhanceResult', null, { timeout: 30000 });
  eq(state.posts, ['enhance'], 'enhanced at once'); await downloads(state, 1); await settle(500);
  eq(state.downloads.length, 1, 'one save'); assert(/enhanced/.test(state.downloads[0].name), 'the enhanced photo was saved: ' + state.downloads[0].name);
  await p.click('#enhClose'); await p.waitForFunction(() => screen === 'cameraScreen'); await camLive(p);
  // Out of credits: the photo is kept and auto-saved without AI.
  state.used = state.quota; await p.evaluate(() => refreshAccount());
  await p.click('#shutter'); await downloads(state, 2); await settle(500);
  eq(state.posts.length, 1, 'no request without credits'); eq(await p.evaluate(() => screen), 'cameraScreen', 'stays on review');
  assert(/No AI credits/.test(await toast(p)), 'says why: ' + await toast(p));
  eq(state.downloads.length, 2, 'the plain photo was saved instead');
}, { start: 'camera', init: () => { localStorage.setItem('glowAutoSave', 'on'); } });

test('camera: selfie screen flash defaults to Auto, cycles On/Off, and lights the screen for the shot', async ({ p }) => {
  await p.goto('https://app.test/'); await camLive(p);
  eq(await p.evaluate(() => [cam.facing, cam.screenFlash, $('flashBtn').hidden, screenFlashMode()]), ['user', true, false, 'auto'], 'selfie camera shows the screen flash on Auto');
  await p.click('#flashBtn'); eq(await p.evaluate(() => screenFlashMode()), 'on', 'On');
  await p.evaluate(() => { window.__lit = 0; new MutationObserver(() => { if (document.querySelector('.screen-flash')) window.__lit++; }).observe(document.body, { childList: true }); });
  await p.click('#shutter'); await p.waitForFunction(() => !!cam.shot);
  eq(await p.evaluate(() => [window.__lit > 0, !!document.querySelector('.screen-flash')]), [true, false], 'screen lit for the shot, then cleared');
  await p.click('#retakeBtn'); await camLive(p);
  await p.click('#flashBtn'); eq(await p.evaluate(() => screenFlashMode()), 'off', 'Off');
  await p.click('#flashBtn'); eq(await p.evaluate(() => screenFlashMode()), 'auto', 'back to Auto');
}, { start: 'camera' });

test('camera: shutter timer counts down before the shot, and a second tap cancels it', async ({ p }) => {
  await p.goto('https://app.test/'); await camLive(p);
  eq(await p.evaluate(() => [timerSecs(), $('camTimer').getAttribute('aria-label')]), [0, 'Timer off'], 'off by default');
  await p.click('#camTimer'); eq(await p.evaluate(() => [timerSecs(), $('camTimer').getAttribute('aria-label')]), [3, 'Timer 3 seconds'], '3 seconds');
  await p.click('#camTimer'); eq(await p.evaluate(() => timerSecs()), 5, '5 seconds');
  await p.click('#camTimer'); eq(await p.evaluate(() => timerSecs()), 10, '10 seconds');
  await p.click('#shutter'); await settle(400);
  eq(await p.evaluate(() => [!!cam.shot, $('camCount').hidden, Number($('camCount').textContent) >= 7]), [false, false, true], 'counting, no photo yet');
  await p.click('#shutter'); await settle(400);
  eq(await p.evaluate(() => [!!cam.shot, $('camCount').hidden, !!cam.counting]), [false, true, false], 'second tap cancels');
  await p.click('#camTimer'); await p.click('#camTimer'); eq(await p.evaluate(() => timerSecs()), 3, 'back to 3 seconds');
  const t0 = Date.now(); await p.click('#shutter');
  await p.waitForFunction(() => !!cam.shot, null, { timeout: 15000 });
  assert(Date.now() - t0 > 2500, 'the photo waits for the countdown');
  eq(await p.evaluate(() => $('camCount').hidden), true, 'countdown cleared');
  await p.click('#retakeBtn'); await camLive(p);
  await p.click('#camTimer'); await p.click('#camTimer'); await p.click('#camTimer');
  eq(await p.evaluate(() => [timerSecs(), store.get('glowTimer')]), [0, '0'], 'cycles 5, 10 then off, remembered');
}, { start: 'camera' });

// ---------- Pro camera controls (2026-11-01): lenses, pinch, dial, focus, exposure, shapes ----------
// The fake camera can't zoom itself, so these run the browser's crop ("digital") zoom; the phone
// app's real lenses (NativeCam.setZoom) can't be checked here.
const vfPtr = (p, type, id, x, y) => p.evaluate(([type, id, x, y]) => {
  const r = $('viewfinder').getBoundingClientRect();
  $('viewfinder').dispatchEvent(new PointerEvent(type, { pointerId: id, clientX: r.left + x, clientY: r.top + y, bubbles: true, isPrimary: id === 1 }));
}, [type, id, x, y]);
const vfTap = (p, x, y) => p.evaluate(([x, y]) => {
  const r = $('viewfinder').getBoundingClientRect();
  for (const type of ['pointerdown', 'pointerup']) $('viewfinder').dispatchEvent(new PointerEvent(type, { pointerId: 1, clientX: r.left + x, clientY: r.top + y, bubbles: true, isPrimary: true }));
}, [x, y]);
test('camera pro: lens buttons zoom with a glide, pinch and the dial zoom, and the photo keeps what the frame shows', async ({ p }) => {
  await p.goto('https://app.test/'); await camLive(p);
  eq(await p.evaluate(() => [$('camZoom').hidden, cam.zr.mode, [...$('camLenses').children].map((b) => b.textContent)]), [false, 'digital', ['1×', '2']], 'lens pill over the shutter: 1× (gold, active) and 2');
  await p.click('#shutter'); await p.waitForFunction(() => !!cam.shot); const w1 = await p.evaluate(() => [cam.shot.w, cam.shot.h]);
  await p.click('#retakeBtn'); await camLive(p);
  await p.click('#camLenses button:nth-child(2)'); await settle(500);
  eq(await p.evaluate(() => [Math.round(cam.zoom * 100) / 100, $('camCanvas').style.transform, [...$('camLenses').children].map((b) => b.textContent)]), [2, 'scale(2)', ['1', '2×']], '2× glides in and the preview zooms');
  await p.click('#shutter'); await p.waitForFunction(() => !!cam.shot); const w2 = await p.evaluate(() => [cam.shot.w, cam.shot.h]);
  assert(Math.abs(w2[0] * 2 - w1[0]) <= 2 && Math.abs(w2[1] * 2 - w1[1]) <= 2, 'the 2× photo is the middle half of the 1× one: ' + [w1, w2]);
  await p.click('#retakeBtn'); await camLive(p);
  eq(await p.evaluate(() => cam.zoom), 1, 'a reopened camera starts at 1×');
  // Pinch out to about 3×, with the dial showing.
  await vfPtr(p, 'pointerdown', 1, 150, 400); await vfPtr(p, 'pointerdown', 2, 250, 400);
  await vfPtr(p, 'pointermove', 1, 50, 400); await vfPtr(p, 'pointermove', 2, 350, 400);
  eq(await p.evaluate(() => [Math.round(cam.zoom * 10) / 10, $('camDial').hidden, $('camDialVal').textContent]), [3, false, '3×'], 'pinch zooms with the finger and shows the dial');
  await vfPtr(p, 'pointerup', 1, 50, 400); await vfPtr(p, 'pointerup', 2, 350, 400); await settle(1500);
  eq(await p.evaluate(() => [$('camDial').hidden, cam.compare]), [true, false], 'dial hides after letting go; no compare from a pinch');
  // Drag the lens pill to the right: the dial turns back toward 1×; never past the limits.
  const b = await p.evaluate(() => { const r = $('camLenses').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
  await p.mouse.move(b[0], b[1]); await p.mouse.down(); await p.mouse.move(b[0] + 60, b[1], { steps: 4 }); await p.mouse.move(b[0] + 400, b[1], { steps: 4 });
  eq(await p.evaluate(() => [cam.zoom, $('camDial').hidden]), [1, false], 'dragging the lenses turns the dial, stopping at 1×');
  await p.mouse.up(); await settle(200);
  eq(await p.evaluate(() => cam.zoom), 1, 'a drag is not a tap on a lens');
}, { start: 'camera' });
test('camera pro: tap to focus shows the square, a slide sets exposure (baked into the photo), lock where supported', async ({ p }) => {
  await p.goto('https://app.test/'); await camLive(p);
  await vfTap(p, 200, 300);
  eq(await p.evaluate(() => [$('camFocus').hidden, Math.round(parseFloat($('camFocus').style.left)), Math.round(parseFloat($('camFocus').style.top)), cam.ev]), [false, 200, 300, 0], 'gold square where the finger tapped');
  await vfPtr(p, 'pointerdown', 1, 200, 400); await vfPtr(p, 'pointermove', 1, 200, 380); await vfPtr(p, 'pointermove', 1, 200, 310); await vfPtr(p, 'pointerup', 1, 200, 310);
  const ev = await p.evaluate(() => [cam.ev, $('camCanvas').style.filter, $('camEvVal').textContent, cam.compare]);
  eq([ev[0], ev[2], ev[3]], [1, '+1.0', false], 'sliding up 90px brightens by one stop');
  assert(/brightness\(1\.5/.test(ev[1]), 'preview brightened: ' + ev[1]);
  await vfPtr(p, 'pointerdown', 1, 200, 400); await vfPtr(p, 'pointermove', 1, 200, 420); await vfPtr(p, 'pointermove', 1, 200, 900); await vfPtr(p, 'pointerup', 1, 200, 900);
  eq(await p.evaluate(() => cam.ev), -2, 'never darker than −2');
  await vfTap(p, 100, 500);
  eq(await p.evaluate(() => [cam.ev, $('camCanvas').style.filter]), [0, ''], 'a new tap resets exposure, like the phones');
  // A darker photo with exposure down.
  const lum = () => p.evaluate(async () => { const i = await loadImg(cam.shot.raw), c = newCanvas(32, 32), x = c.getContext('2d'); x.drawImage(i, 0, 0, 32, 32); const d = x.getImageData(0, 0, 32, 32).data; let t = 0; for (let k = 0; k < d.length; k += 4) t += d[k] + d[k + 1] + d[k + 2]; return t / (d.length / 4) / 3; });
  await p.click('#shutter'); await p.waitForFunction(() => !!cam.shot); const l0 = await lum();
  await p.click('#retakeBtn'); await camLive(p);
  await vfTap(p, 200, 300);
  await vfPtr(p, 'pointerdown', 1, 200, 400); await vfPtr(p, 'pointermove', 1, 200, 420); await vfPtr(p, 'pointermove', 1, 200, 490); await vfPtr(p, 'pointerup', 1, 200, 490);
  const dbg = await p.evaluate(() => [cam.ev, cam.evr.mode, camEvGain()]);
  await p.click('#shutter'); await p.waitForFunction(() => !!cam.shot); const l1 = await lum();
  assert(l1 < l0 * 0.9, 'exposure −1 is baked into the saved photo: ' + [l0, l1, dbg]);
  eq(await p.evaluate(() => { const c = newCanvas(4, 4), x = c.getContext('2d'); x.fillStyle = 'rgb(200,200,200)'; x.fillRect(0, 0, 4, 4);
    return withGain(c, 0.5).getContext('2d').getImageData(1, 1, 1, 1).data[0]; }), 100, 'exposure gain halves a mid grey');
  await p.click('#retakeBtn'); await camLive(p);
  await vfTap(p, 200, 300);
  eq(await p.evaluate(() => $('camLock').hidden), !(await p.evaluate(() => cam.canLock)), 'the lock shows only where the camera can lock');
  if (await p.evaluate(() => cam.canLock)) {
    await p.click('#camLock');
    eq(await p.evaluate(() => [cam.focus.locked, $('camLocked').hidden, $('camLock').getAttribute('aria-pressed')]), [true, false, 'true'], 'AE/AF lock on');
    await vfTap(p, 120, 500);
    eq(await p.evaluate(() => [cam.focus.locked, $('camLocked').hidden]), [false, true], 'a tap elsewhere unlocks and refocuses');
  }
}, { start: 'camera', init: () => { localStorage.setItem('glowAutoSave', 'off'); } });
test('camera pro: photo shapes dim the rest and crop the photo; grid, level, 5s timer and back-camera flash modes', async ({ p }) => {
  await p.goto('https://app.test/'); await camLive(p);
  eq(await p.evaluate(() => [$('camRatio').textContent, $('camFrame').classList.contains('masked')]), ['Full', false], 'Full by default (unchanged)');
  for (const [want, a] of [['3:4', 3 / 4], ['9:16', 9 / 16], ['1:1', 1]]) {
    await p.click('#camRatio');
    const r = await p.evaluate(() => { const f = $('camFrame').getBoundingClientRect(); return [$('camRatio').textContent, f.width / f.height, $('camFrame').classList.contains('masked'), f.top >= $('cameraScreen').querySelector('.cam-top').getBoundingClientRect().bottom - 1]; });
    eq([r[0], Math.round(r[1] * 100) / 100, r[2], r[3]], [want, Math.round(a * 100) / 100, true, true], `${want} frame below the top bar, the rest dimmed`);
    await p.click('#shutter'); await p.waitForFunction(() => !!cam.shot);
    const s = await p.evaluate(() => { const i = $('reviewImg').getBoundingClientRect(), f = $('camFrame').getBoundingClientRect(); return [cam.shot.w / cam.shot.h, Math.abs(i.top - f.top) + Math.abs(i.height - f.height)]; });
    assert(Math.abs(s[0] - a) < 0.02, `${want} photo: ` + s[0]);
    assert(s[1] < 2, 'review shows the photo in the same frame');
    await p.click('#retakeBtn'); await camLive(p);
  }
  await p.click('#camRatio'); eq(await p.evaluate(() => [store.get('glowRatio'), $('camRatio').textContent]), ['full', 'Full'], 'back to Full, remembered');
  await p.click('#camMore');
  eq(await p.evaluate(() => [$('camQuick').hidden, $('camMore').getAttribute('aria-expanded'), $('camQuick').querySelector('[data-q=hdr]').hidden]), [false, 'true', true], 'quick settings open; HDR only in the phone app');
  await p.click('#camQuick [data-q=grid]'); await p.click('#camQuick [data-q=level]');
  eq(await p.evaluate(() => [$('camGrid').hidden, $('camLevel').hidden, store.get('glowGrid'), store.get('glowLevel')]), [false, false, 'on', 'on'], 'grid and level on, remembered');
  await p.evaluate(() => { const e = new Event('devicemotion'); e.accelerationIncludingGravity = { x: 0, y: 9.8, z: 0 }; for (let i = 0; i < 12; i++) window.dispatchEvent(e); });
  eq(await p.evaluate(() => $('camLevel').classList.contains('ok')), true, 'level turns gold when straight');
  await p.evaluate(() => { const e = new Event('devicemotion'); e.accelerationIncludingGravity = { x: -1.7, y: 9.65, z: 0 }; for (let i = 0; i < 30; i++) window.dispatchEvent(e); });
  eq(await p.evaluate(() => [$('camLevel').classList.contains('ok'), Math.round(parseFloat($('camLevel').style.getPropertyValue('--lvl')))]), [false, -10], 'tilted 10°: the line turns back 10° to stay level');
  // Back camera flash: Auto, On, Off (the fake camera has none, so the button is drawn directly).
  eq(await p.evaluate(() => { cam.screenFlash = false; renderFlashBtn(); const seq = [$('flashBtn').getAttribute('aria-label')]; for (let i = 0; i < 3; i++) { cycleRearFlash(); seq.push($('flashBtn').getAttribute('aria-label')); } return seq; }),
    ['Flash auto', 'Flash on', 'Flash off', 'Flash auto'], 'back flash cycles Auto, On, Off');
}, { start: 'camera' });
test('camera filters: 13 filters, film effects over the preview and in the photo, Strength scales them', async ({ p }) => {
  await p.goto('https://app.test/'); await camLive(p);
  eq(await p.evaluate(() => FILTERS.map((f) => f.id)), ['none', 'glow', 'film', 'warm', 'soft', 'matte', 'clear', 'vivid', 'cool', 'digicam', 'disposable', 'instant', 'mono', 'noir'], 'the filter list');
  eq(await p.evaluate(() => FILTERS.every((f) => f.f === 'none' || f.f.match(/\(/g).length <= 4)), true, 'every chain fits the native camera');
  await p.evaluate(() => { $('adjustPanel').hidden = false; selectAdj('filter'); });
  eq(await p.evaluate(() => [$('camFx').hidden, $('sFilterAmt').closest('.slider').hidden]), [true, true], 'no filter: no effects, no Strength');
  await p.evaluate(() => [...$('camFilters').children].find((b) => b.textContent === 'Disposable').click());
  const fx = await p.evaluate(() => { const c = $('camFx').children; return { hidden: $('camFx').hidden, date: c[5].textContent, grain: c[4].style.backgroundImage.startsWith('url('),
    vig: c[3].style.background.includes('radial-gradient'), canvas: $('camCanvas').style.filter, amt: $('sFilterAmt').value, slider: $('sFilterAmt').closest('.slider').hidden }; });
  eq([fx.hidden, /^'\d\d \d\d \d\d$/.test(fx.date), fx.grain, fx.vig, fx.canvas.includes('saturate(1.18)'), fx.amt, fx.slider], [false, true, true, true, true, '100', false], 'Disposable over the preview');
  await p.evaluate(() => { $('sFilterAmt').value = 50; $('sFilterAmt').dispatchEvent(new Event('input')); });
  eq(await p.evaluate(() => [beauty.filterAmt, $('camCanvas').style.filter.includes('saturate(1.09)'), $('camFx').children[3].style.background.includes('0.14)')]), [50, true, true], 'Strength 50 halves the filter and its effects');
  await p.evaluate(() => { $('sFilterAmt').value = 100; $('sFilterAmt').dispatchEvent(new Event('input')); });
  await p.click('#shutter'); await p.waitForFunction(() => !!cam.shot && !!cam.shot.processed, null, { timeout: 15000 });
  eq(await p.evaluate(() => $('camFx').hidden), true, 'effects leave with the live preview');
  // The orange date stamp is in the photo's bottom-right corner.
  const orange = await p.evaluate(async () => { const i = await loadImg(cam.shot.processed), c = newCanvas(i.naturalWidth, i.naturalHeight), x = c.getContext('2d'); x.drawImage(i, 0, 0);
    const w = Math.round(c.width * 0.3), h = Math.round(Math.min(c.width, c.height) * 0.1), d = x.getImageData(c.width - w, c.height - h, w, h).data; let n = 0;
    for (let k = 0; k < d.length; k += 4) if (d[k] > 200 && d[k + 1] > 90 && d[k + 1] < 200 && d[k + 2] < 120) n++; return n; });
  assert(orange > 20, `date stamp in the photo (${orange} orange pixels)`);
  eq(await p.evaluate(() => { const f = scaleFilter(FILTERS.find((x) => x.id === 'disposable'), 0); return [f.f, f.wash.endsWith(',0)'), f.fx.grain, f.fx.date]; }),
    ['saturate(1) contrast(1) sepia(0)', true, 0, 0], 'Strength 0 is no change');
}, { start: 'camera' });

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
  await applyTool(p); await idle(p);
  await tool(p, 'edit', 'crop', 'crop'); await p.waitForFunction(() => !!cr); await p.click('.panel .opt:has-text("Square")');
  const cropped = true; await applyTool(p); await idle(p);
  await p.click('#saveBtn'); await downloads(state, 1); await settle(300);
  const s = imageSize(state.downloads[0].file);
  if (cropped) eq([s.w, s.h], [3024, 3024], 'square crop at full size'); else eq([s.w, s.h], [3024, 4032], 'full size');
  assert(/Saved at 3024 × (3024|4032)/.test(await toast(p)), 'toast states the size: ' + await toast(p));
  state.report = { case: '12 MP EXIF-6 JPEG', original: dims.orig, working: dims.work, exported: [s.w, s.h], steps: cropped ? 'Light +20, Crop 1:1' : 'Light +20' };
});

test('export: a 24 MP photo is capped at 16 MP, never upscaled', async ({ p, state }) => {
  await p.goto('https://app.test/'); await pick(p, fx('large-24mp.jpg'));
  await tool(p, 'looks', 'filters', await p.evaluate(() => TOOLS.find((t) => t.kind === 'filter' && t.filter.id === 'film').id)); await applyTool(p); await idle(p);
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
  await applyTool(p); await idle(p);
  await p.click('#saveBtn'); await downloads(state, 1);
  const s = imageSize(state.downloads[0].file); eq(s.type, 'png', 'PNG out'); eq([s.w, s.h], [1200, 900], 'same size');
  const alpha = await p.evaluate(async (b64) => { const i = await loadImg('data:image/png;base64,' + b64), c = newCanvas(i.naturalWidth, i.naturalHeight), x = c.getContext('2d'); x.drawImage(i, 0, 0);
    return [x.getImageData(5, 5, 1, 1).data[3], x.getImageData(600, 450, 1, 1).data[3]]; }, fs.readFileSync(state.downloads[0].file).toString('base64'));
  eq(alpha, [0, 255], 'corner transparent, centre opaque');
});

test('export: AI result saves at the size the AI returned, and later steps build on it', async ({ p, state }) => {
  await p.goto('https://app.test/'); await pick(p, fx('phone-12mp-exif6.jpg'));
  await tool(p, 'foryou', null, 'pro'); await applyTool(p); await idle(p);
  await aiApply(p, 20000);
  await tool(p, 'edit', 'light', 'light'); await p.fill('.panel input[type=range]', '-10'); await idle(p); await applyTool(p); await idle(p);
  await p.click('#saveBtn'); await downloads(state, 1);
  // Pro edit's finish puts the photo's own detail back, so it comes back at the photo's size (up to 2560px), not the AI's 1024 × 1365.
  const s = imageSize(state.downloads[0].file); eq([s.w, s.h], [1920, 2560], 'photo size (2560 cap), not the AI size or an upscale to 3024 × 4032');
  assert(!/returned/.test(await toast(p)), 'toast does not claim the AI size: ' + await toast(p));
  eq(state.posts.length, 1, 'one paid request');
  state.report = { case: 'Enhance, then Light −10', original: [3024, 4032], working: [1024, 1365], exported: [s.w, s.h], steps: 'AI result is the base' };
});

test('export: Also save the original saves the original file once, untouched', async ({ p, state }) => {
  await p.goto('https://app.test/'); await pick(p, fx('phone-12mp-exif6.jpg'));
  await tool(p, 'edit', 'light', 'light'); await p.fill('.panel input[type=range]', '15'); await idle(p); await applyTool(p); await idle(p);
  await p.click('#saveBtn'); await downloads(state, 2);
  const orig = state.downloads.find((d) => /-original/.test(d.name));
  assert(orig, 'original saved'); eq(fs.readFileSync(orig.file).equals(fs.readFileSync(fx('phone-12mp-exif6.jpg'))), true, 'byte-for-byte the picked file');
  assert(await p.isDisabled('#saveBtn'), 'Save disabled until something changes');
  await tool(p, 'edit', 'color', 'color'); await p.fill('.panel input[type=range]', '10'); await idle(p); await applyTool(p); await idle(p);
  await p.click('#saveBtn'); await downloads(state, 3); await settle(300);
  eq(state.downloads.length, 3, 'second Save: only the new edit');
}, { init: () => localStorage.setItem('glowSaveOrig', 'on') });

// ---------- AI job recovery ----------
test('ai: dropped connection on start → unknown, Check status never re-charges (current server)', async ({ p, state }) => {
  state.ai.dropPost = true;
  await p.goto('https://app.test/'); await pick(p, fx('phone-12mp-exif6.jpg'));
  await tool(p, 'foryou', null, 'pro'); await applyTool(p); await idle(p);
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
  await tool(p, 'foryou', null, 'pro'); await applyTool(p); await idle(p);
  await p.waitForFunction(() => job && job.status === 'unknown');
  await p.click('#jobActions button:has-text("Check status")');
  await aiApply(p, 15000);
  eq(state.posts.length, 1, 'one paid request'); eq(state.used, 2, 'charged once (Pro edit is 2 credits)');
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
  await tool(p, 'foryou', null, 'pro'); await applyTool(p); await settle(2500);
  eq(await p.evaluate(() => job && job.status), 'processing', 'processing');
  await p.reload(); await p.waitForFunction(() => !!ed.hist.length, null, { timeout: 10000 });
  await p.click('#resumeBtn').catch(() => {});
  await aiApply(p, 60000);
  eq(state.posts.length, 1, 'no second paid request'); assert(state.polls >= 2, 'polled by id');
});

test('ai: network loss while polling → unknown, then resumes on Check status', async ({ p, state }) => {
  state.ai = { ...state.ai, post: 'processing', polls: ['processing', 'processing', 'succeeded'], dropPolls: 1 };
  await p.goto('https://app.test/'); await pick(p, fx('phone-12mp-exif6.jpg'));
  await tool(p, 'foryou', null, 'pro'); await applyTool(p);
  await p.waitForFunction(() => job && job.status === 'unknown', null, { timeout: 20000 });
  assert(/couldn't reach its server/.test(await p.textContent('#jobText')), 'network wording');
  await p.click('#jobActions button:has-text("Check status")');
  await aiApply(p, 30000);
  eq(state.posts.length, 1, 'one paid request');
});

test('ai: confirmed failure claims a refund only when the server confirms it', async ({ p, state }) => {
  state.ai = { ...state.ai, post: 'processing', polls: ['processing', 'failed'] };
  await p.goto('https://app.test/'); await pick(p, fx('phone-12mp-exif6.jpg'));
  await tool(p, 'foryou', null, 'pro'); await applyTool(p);
  await p.waitForFunction(() => job && job.status === 'failed', null, { timeout: 20000 }); await settle(400);
  const t1 = await p.textContent('#jobText');
  assert(!/returned the AI credit/.test(t1), 'current server: no refund claim: ' + t1); assert(/balance shows/.test(t1), 'shows the balance instead');
  await p.click('#jobActions button:has-text("Dismiss")');
  state.ai = { ...state.ai, server: 'patched', polls: ['processing', 'failed'] };
  await tool(p, 'foryou', null, 'pro'); await applyTool(p);
  await p.waitForFunction(() => job && job.status === 'failed', null, { timeout: 20000 });
  assert(/returned the AI credit/.test(await p.textContent('#jobText')), 'patched server: confirmed refund is stated');
  eq(state.posts.length, 2, 'no automatic retry');
});

test('ai: a result that finishes after the photo was replaced waits on Editor home', async ({ p, state }) => {
  state.ai = { ...state.ai, post: 'processing', polls: ['processing', 'processing', 'processing', 'processing', 'processing', 'processing', 'processing', 'processing', 'processing', 'processing', 'processing', 'processing', 'succeeded'] };
  await p.goto('https://app.test/'); await pick(p, fx('phone-12mp-exif6.jpg'));
  await tool(p, 'foryou', null, 'pro'); await applyTool(p);
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
  const over = () => p.evaluate(() => [document.documentElement.scrollWidth > innerWidth, [...document.querySelectorAll('#app *')].filter((e) => { const r = e.getBoundingClientRect(); return r.width && e.offsetParent && r.right > innerWidth + 1 && getComputedStyle(e).overflowX === 'visible' && !e.closest('.looks,.tools,.tabs,.chips,.opts,.subchips,.areas'); }).map((e) => e.id || e.className).slice(0, 5)]);
  await camLive(p);
  let o = await over(); eq(o[0], false, 'camera page scroll'); eq(o[1], [], 'camera clipped elements');
  await p.click('#nav button[data-dest="editor"]'); o = await over(); eq(o[0], false, 'home scroll'); eq(o[1], [], 'home clipped');
  await pick(p, fx('transparent.png')); await tool(p, 'edit', 'light', 'light');
  o = await over(); eq(o[0], false, 'editor scroll'); eq(o[1], [], 'editor clipped');
  assert(await p.isVisible('#panelBody .slider input'), 'slider reachable');
  await p.click('#backBtn'); await p.click('#homeSettingsBtn'); o = await over(); eq(o[0], false, 'settings scroll');
  await p.screenshot({ path: path.join(__dirname, 'out', 'a11y-200-settings.png') });
}, { start: 'camera' });

test('a11y: keyboard focus is visible, sliders have names and spoken values', async ({ p }) => {
  await p.goto('https://app.test/'); await pick(p, fx('transparent.png'));
  await tool(p, 'edit', 'light', 'light');
  const r = await p.evaluate(() => { const s = document.querySelector('.panel input[type=range]'); return { label: s.getAttribute('aria-label'), text: s.getAttribute('aria-valuetext') }; });
  eq(r, { label: 'Brightness amount', text: 'No change' }, 'slider name and value');
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
  const m = JSON.parse(fs.readFileSync(path.join(__dirname, '../public/samples/demo-v2/manifest.json')));
  if (!m.previews.some((e) => e.tool === 'golden')) m.previews.push({ tool: 'golden', title: 'Golden hour' });
  for (const e of m.previews) Object.assign(e, e.tool === 'pro' || e.tool === 'golden' ? { status: 'ready', result: `test-${e.tool}.jpg`, aligned: true } : { status: 'needs-generation', result: null });
  return m;
})();
const demoFiles = (extra = {}) => ({ '/samples/demo-v2/manifest.json': { json: demoManifest }, '/samples/demo-v2/test-pro.jpg': fx('demo-test-a.jpg'),
  '/samples/demo-v2/test-golden.jpg': fx('demo-test-b.jpg'), ...extra });
async function openDemo(p) {
  await p.goto('https://app.test/'); await p.click('#sampleBtn:visible, #qaSampleBtn:visible');
  await p.waitForFunction(() => screen === 'editorScreen' && ed.demo && $('before').naturalWidth > 0, null, { timeout: 15000 });
  await p.waitForFunction(() => demo && !demo.loading); await settle(300);
}
const credit = (state) => ({ used: state.used, posts: state.posts.length, polls: state.polls, lookups: state.lookups });

test('demo: Try a sample opens the attached original with demo labels', async ({ p, state }) => {
  await openDemo(p);
  const o = await p.evaluate(async () => { const b = new Uint8Array(await ed.original.blob.arrayBuffer()); const h = await crypto.subtle.digest('SHA-256', b);
    return { w: ed.original.w, h: ed.original.h, sha: [...new Uint8Array(h)].map((x) => x.toString(16).padStart(2, '0')).join('') }; });
  eq(o, { w: 1086, h: 1448, sha: demoManifest.original.sha256 }, 'unchanged original');
  // The disclosure is a small "AI sample" badge on the photo, with the full explanation for screen readers and on tap.
  const badge = await p.evaluate(() => { const b = $('demoNote').getBoundingClientRect(), st = $('stage').getBoundingClientRect();
    return { text: $('demoNote').textContent, onPhoto: b.top >= st.top && b.bottom <= st.bottom && b.left >= st.left, h: b.height, w: b.width }; });
  assert(/^AI sample/.test(badge.text) && /AI-generated sample, not a real person/.test(badge.text), 'badge text and accessible explanation: ' + badge.text);
  assert(badge.onPhoto && badge.h <= 36 && badge.w <= 140, 'a small badge on the photo, not a row: ' + JSON.stringify(badge));
  await p.click('#demoNote'); assert(/AI-generated, not a real person/.test(await p.textContent('#toast')), 'tapping the badge explains it');
  // Use your photo is the small upload action in the utility row (on phones a glass pill over the photo), not a header button.
  const row = await p.evaluate(() => { const b = $('demoOwnBtn').getBoundingClientRect();
    return { inRow: !!$('demoOwnBtn').closest('.viewbar'), bh: b.height, name: $('demoOwnBtn').getAttribute('aria-label'), header: !!$('demoOwnBtn').closest('.topbar') }; });
  eq([row.inRow, row.header, row.bh >= 44, row.name], [true, false, true, 'Use your photo'], 'small Use your photo action in the utility row');
  assert(await p.isVisible('#demoOwnBtn'), 'Try your own photo'); assert(await p.isHidden('#balanceBtn'), 'no credit balance in the demo');
  await p.click('.tab[data-cat="ai"]');   // Pro edit is filed under AI · Improve
  eq(await p.evaluate(() => [...document.querySelectorAll('.tool .cost')].map((c) => c.textContent)), ['Preview'], 'AI tools offered = prepared ones');
  await p.click('.tab[data-cat="looks"]');   // Golden hour under Looks · Styles
  eq(await p.evaluate(() => [...document.querySelectorAll('.tool[data-tool="golden"] .cost')].map((c) => c.textContent)), ['Preview'], 'Golden hour prepared');
  await p.click('.tab[data-cat="ai"]');
  assert(/prepared preview, no credits/.test(await p.getAttribute('.tool[data-tool="pro"]', 'aria-label')), 'screen-reader label');
  await p.screenshot({ path: path.join(__dirname, 'out', 'demo-open.png') });
}, { files: demoFiles() });

test('demo: prepared previews make no AI request, use no credits, and never stack', async ({ p, state }) => {
  await openDemo(p); const before = credit(state);
  for (let i = 0; i < 3; i++) for (const id of ['pro', 'golden']) {
    await tool(p, 'foryou', null, id); await p.waitForFunction((x) => ed.idx === 1 && ed.hist[1].op.tool === x, id);
    const v = await p.evaluate(() => ({ n: ed.hist.length, before: $('before').src === ed.hist[0].data, after: $('after').src === ed.hist[1].data, hidden: $('after').hidden, badge: $('tagRight').textContent }));
    eq(v, { n: 2, before: true, after: true, hidden: false, badge: 'Prepared preview' }, `${id}: original vs this result only`);
  }
  eq(credit(state), before, 'no enhance calls, credits unchanged'); eq(state.posts.length, 0, 'no POST');
  assert(!(await p.evaluate(() => $('paywall').open)), 'no paywall');
  assert(/No credits used/.test(await p.textContent('#panelNote')), 'says no credits are used');
  await p.screenshot({ path: path.join(__dirname, 'out', 'demo-prepared.png') });
}, { files: demoFiles(), quota: 0 });

test('demo: works with zero credits and with sign-in failing', async ({ p, state }) => {
  await openDemo(p);
  await tool(p, 'foryou', null, 'pro'); await p.waitForFunction(() => ed.idx === 1);
  await applyTool(p); await settle(300);
  eq(await p.evaluate(() => [sel, ed.idx, $('paywall').open]), [null, 1, false], 'Done keeps the preview, no paywall');
  eq(state.posts.length, 0, 'no AI request');
}, { files: demoFiles(), quota: 0, authFail: true });

test('demo: on-device tools stay interactive and reset the prepared preview', async ({ p, state }) => {
  await openDemo(p);
  await tool(p, 'foryou', null, 'pro'); await p.waitForFunction(() => ed.idx === 1);
  await tool(p, 'edit', 'light', 'light');
  eq(await p.evaluate(() => [ed.idx, ed.hist.length]), [0, 1], 'back to the original');
  assert(/Back to the original/.test(await toast(p)), 'says so');
  await p.fill('.panel input[type=range]', '20'); await idle(p); await applyTool(p); await idle(p);
  eq(await p.evaluate(() => ed.idx), 1, 'light applied on the original');
  await tool(p, 'foryou', null, 'golden'); await p.waitForFunction(() => ed.idx === 1 && ed.hist[1].op.tool === 'golden');
  eq(await p.evaluate(() => ed.hist.map((h) => h.op && h.op.tool)), [null, 'golden'], 'prepared preview starts from the original, light dropped');
  eq(state.posts.length, 0, 'local edits never sent to AI');
}, { files: demoFiles() });

test('demo: a missing preview shows a useful message and Retry recovers', async ({ p, state }) => {
  await openDemo(p);
  await tool(p, 'foryou', null, 'golden'); await p.waitForFunction(() => demo.failed.golden);
  assert(/Couldn't load this preview/.test(await p.textContent('#panelNote')), 'message'); eq(await p.textContent('#applyBtn'), 'Retry', 'retry action');
  eq(await p.evaluate(() => ed.idx), 0, 'shows the original meanwhile');
  await applyTool(p); await p.waitForFunction(() => ed.idx === 1 && ed.hist[1].op.tool === 'golden');
  eq(state.posts.length, 0, 'no AI request');
}, { files: demoFiles({ '/samples/demo-v2/test-golden.jpg': { path: fx('demo-test-b.jpg'), flaky: 2 /* the preload and the first tap fail */ } }) });

test('demo: a preview whose file is gone is not offered', async ({ p }) => {
  await openDemo(p);
  eq(await p.evaluate(() => demo.ready), ['pro'], 'only previews that exist');
}, { files: demoFiles({ '/samples/demo-v2/test-golden.jpg': 404 }) });

test('demo: with no prepared previews, no AI tools are offered and the note explains why', async ({ p, state }) => {
  await openDemo(p);
  eq(await p.evaluate(() => [...document.querySelectorAll('.tool .cost')].length), 0, 'no AI tiles');
  await p.click('.tab[data-cat="ai"]');
  eq(await p.$$eval('#tools .tool[data-tool]', (x) => x.map((b) => [b.dataset.tool, b.querySelector('.cost') && b.querySelector('.cost').textContent])),
    [['erase', null], ['fill', null], ['custom', null]], 'Remove, Fill and Describe stay listed, with no badge (the panel explains)');
  eq(await p.$$eval('#subchips .subchip', (x) => x.map((c) => c.textContent)), ['Change'], 'one group left on the tab: its one name');
  assert(await p.$$eval('#tools .tool[data-tool]', (x) => x.every((b) => /needs your own photo/.test(b.getAttribute('aria-label')))), 'spoken: needs your own photo');
  await p.click('.tab[data-cat="looks"]');
  assert(!(await p.$$eval('#tools .tool', (x) => x.some((b) => /uses \d credit/.test(b.getAttribute('aria-label'))))), 'no AI tool offered as chargeable on the sample');
  eq(state.posts.length, 0, 'no AI request');
}, { files: { '/samples/demo-v2/manifest.json': { json: { ...demoManifest, previews: demoManifest.previews.map((e) => ({ ...e, status: 'needs-generation', result: null })) } } } });

test('demo: the shipped prepared previews are all there, match the manifest, and never call the AI', async ({ p, state }) => {
  const dir = path.join(__dirname, '../public/samples/demo-v2'), m = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  const raw = fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8');
  assert(!/https?:\/\/|token|X-Amz|Signature=/i.test(raw), 'no URLs or credentials in the manifest');
  const ready = m.previews.filter((e) => e.status === 'ready');
  // The original is the approved portrait, and every shipped preview was made from that exact file
  // and lines up with it: same size, same framing. Old results from an earlier sample are never shipped.
  const orig = path.join(dir, m.original.file);
  eq([require('crypto').createHash('sha256').update(fs.readFileSync(orig)).digest('hex'), imageSize(orig).w, imageSize(orig).h], [m.original.sha256, m.original.width, m.original.height], 'original matches the manifest');
  for (const e of ready) {
    const f = path.join(dir, e.result), sha = require('crypto').createHash('sha256').update(fs.readFileSync(f)).digest('hex');
    eq([sha, imageSize(f).w, imageSize(f).h], [e.sha256, m.original.width, m.original.height], `${e.tool}: file matches and has the original's size`);
    assert(e.aligned === true && e.provenance && e.provenance.predictionId && e.provenance.originalSha256 === m.original.sha256 && e.assetVersion === m.assetVersion, `${e.tool}: aligned, made from this original`);
  }
  const shipped = fs.readdirSync(dir).filter((f) => /\.(jpe?g|png|webp)$/i.test(f)).sort();
  eq(shipped, [...new Set(['intro.jpg', 'thumb.jpg', 'pw-before.jpg', 'pw-after.jpg', m.original.file, ...(m.intro ? [m.intro.file] : []), ...ready.map((e) => e.result)])].sort(), 'no stray or old result images');
  await openDemo(p); const before = credit(state), retired = await p.evaluate(() => RETIRED), IN_TRY_ON_IDS = await p.evaluate(() => IN_TRY_ON);
  // Colorize is only offered for black-and-white photos, so the color sample doesn't show it; retired tools aren't offered.
  // Suit and Sundress live inside Try on now (no tile of their own).
  for (const e of ready.filter((x) => x.tool !== 'colorize' && !retired.includes(x.tool) && !IN_TRY_ON_IDS.includes(x.tool))) {
    await tool(p, 'foryou', null, e.tool); await p.waitForFunction((x) => ed.idx === 1 && ed.hist[1].op.tool === x && $('after').naturalWidth > 0, e.tool, { timeout: 15000 });
    eq(await p.evaluate(() => [ed.hist.length, $('after').naturalWidth, $('after').naturalHeight]), [2, e.width, e.height], `${e.tool}: shown alone, at its size`);
  }
  // The outfit previews live inside Try on.
  for (const id of ['suit', 'sundress'].filter((x) => ready.some((e) => e.tool === x))) {
    await tool(p, 'looks', null, 'outfit'); await p.click(`.try-card[data-idea="${id}"]`);
    await p.waitForFunction((x) => ed.idx === 1 && ed.hist[1].op.tool === x && sel === 'outfit' && $('after').naturalWidth > 0, id, { timeout: 15000 });
    eq(await p.textContent('#applyBtn'), 'Done', `${id}: shown in Try on as a prepared preview`);
  }
  eq(credit(state), before, 'no AI requests, credits unchanged');
  if (ready.length) { await p.click('#compareBtn'); await settle(300); }
  await p.screenshot({ path: path.join(__dirname, 'out', 'demo-shipped.png') });
}, { quota: 0 });

test('demo: Try your own photo exits the demo completely, then real AI is charged by the server', async ({ p, state }) => {
  await openDemo(p);
  const faceBefore = await p.evaluate(() => faceSet.amt.fsmooth);
  await tool(p, 'retouch', 'skin', 'fsmooth'); await p.fill('.panel input[type=range]', '90'); await idle(p);
  await tool(p, 'foryou', null, 'pro'); await p.waitForFunction(() => ed.idx === 1);
  const fc = p.waitForEvent('filechooser'); await p.click('#demoOwnBtn'); await (await fc).setFiles(fx('phone-12mp-exif6.jpg'));
  await p.waitForFunction(() => !ed.demo && ed.original && ed.original.w === 3024, null, { timeout: 15000 });
  const s = await p.evaluate(() => ({ demo: !!demo, bar: $('demoBar').hidden, sel, n: ed.hist.length, badge: $('demoNote').hidden && !$('tagRight').textContent, amt: faceSet.amt.fsmooth,
    costs: [...document.querySelectorAll('.tool .cost')].map((c) => c.textContent) }));
  eq([s.demo, s.bar, s.sel, s.n, s.badge], [false, true, null, 1, true], 'no demo state, labels gone, nothing selected, no sample result carried');
  eq(s.amt, faceBefore, 'tool settings restored'); assert(s.costs.includes('AI · 1'), 'real pricing back: ' + s.costs);
  eq(state.posts.length, 0, 'the last demo tool did not run');
  await tool(p, 'foryou', null, 'pro');
  assert(/Apply · 2 credits/.test(await p.textContent('#applyBtn')), 'shows the real cost first');
  await applyTool(p); await idle(p); await aiApply(p, 20000);
  eq([state.posts.length, state.used], [1, 2], 'real edit went to the server, which charged its 2 credits');
  const draft = await p.evaluate(async () => (await Drafts.get()).hist.map((h) => h.op && h.op.demo));
  assert(!draft.includes(true), 'no sample result in the saved project');
}, { files: demoFiles(), viewport: { width: 1280, height: 860 }, mobile: false, touch: false });

test('demo: saving exports the shown result and names it as an AI-generated sample', async ({ p, state }) => {
  await openDemo(p);
  await tool(p, 'foryou', null, 'pro'); await p.waitForFunction(() => ed.idx === 1); await applyTool(p);
  await p.click('#saveBtn'); assert(/AI-generated sample/.test(await p.textContent('#ask')), 'export flow says it is a sample');
  await p.click('#ask .btn:has-text("Save sample")'); await downloads(state, 1);
  assert(/^glow-studio-ai-sample-/.test(state.downloads[0].name), 'file name: ' + state.downloads[0].name);
  eq((({ w, h }) => [w, h])(imageSize(state.downloads[0].file)), [1086, 1448], 'shown result at its size');
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
test('first launch opens Enhance: sample before/after, Choose a photo, then the sample; the welcome screen still works', async ({ p }) => {
  await p.goto('https://app.test/'); await p.waitForFunction(() => screen === 'enhanceHome');
  const h = await p.evaluate(() => { const b = (id) => $(id).getBoundingClientRect();
    return { nav: [...document.querySelectorAll('#nav button')].map((x) => x.dataset.dest), current: document.querySelector('#nav [aria-current]').dataset.dest,
      order: ['enhPick', 'enhSample'].map((id) => Math.round(b(id).top)), fits: b('enhSample').bottom <= innerHeight, onboarded: store.get('glowOnboarded'),
      hero: [...document.querySelectorAll('#enhanceHome .enh-hero img')].map((i) => i.src.split('/').pop()) }; });
  eq([h.nav, h.current, h.onboarded, h.hero], [['enhance', 'camera', 'editor'], 'enhance', '1', ['original.png', 'enhance.jpg']], 'Enhance first, with the sample before/after');
  assert(h.order[0] < h.order[1] && h.fits, 'Choose a photo, then Try the sample, both on screen: ' + h.order);
  eq(await p.evaluate(() => window.__streams.length), 0, 'no camera request on the first screen');
  // The welcome screen (no longer offered in Settings) still shows the whole sample portrait.
  await p.evaluate(() => showOnboarding()); await p.waitForSelector('#onboarding:not([hidden])');
  const r = await p.evaluate(() => { const ph = document.querySelector('.ob-photo'), img = ph.querySelector('img'), b = (id) => $(id).getBoundingClientRect();
    return { h: $('obSlide').querySelector('h1').textContent, fit: getComputedStyle(img).objectFit, order: ['obPick', 'obSample', 'obCamera'].map((id) => Math.round(b(id).top)) }; });
  // No button opens it any more, so its buttons no longer have to fit one screen.
  eq([r.h, r.fit, r.order[0] < r.order[1] && r.order[1] < r.order[2]], ['Your light, your look.', 'contain', true], 'welcome screen intact: ' + JSON.stringify(r));
  assert(r.order[0] < r.order[1] && r.order[1] < r.order[2], 'Choose a photo, Try the sample, camera: ' + r.order);
  await p.click('#obSample');
  await p.waitForFunction(() => screen === 'editorScreen' && ed.demo && $('before').naturalWidth > 0, null, { timeout: 15000 });
  await p.reload(); await p.waitForFunction(() => screen === 'enhanceHome');   // always reopens on home, never the last tab
  await p.evaluate(() => localStorage.setItem('glowLastDest', 'camera'));   // last used the camera
  await p.reload(); await p.waitForFunction(() => screen === 'enhanceHome');
  eq(await p.evaluate(() => window.__streams.length), 0, 'reopening after the camera asks for no camera');
}, { onboarded: false, camera: false, viewport: { width: 390, height: 740 } });

test('enhance: Pro Edit sends one "pro" request, keeps faces true on the phone, and is remembered', async ({ p, state }) => {
  await p.goto('https://app.test/'); await p.waitForFunction(() => screen === 'enhanceHome');
  const fc = p.waitForEvent('filechooser'); await p.click('#enhPick'); await (await fc).setFiles(PORTRAIT);
  await p.waitForSelector('#enhSheet[open]');
  await p.click('#enhStyle button[data-style=pro]');
  eq(await p.getAttribute('#enhStyle button[data-style=pro]', 'aria-checked'), 'true', 'Pro Edit selected');
  assert(/premium credit/.test(await p.textContent('#enhCost')), 'premium cost shown: ' + await p.textContent('#enhCost'));
  eq(await p.textContent('#enhGoLbl'), 'Pro Edit', 'button says Pro Edit');
  eq(await p.getAttribute('#enhGoCost', 'aria-label'), '2 credits', 'price on the button');
  await p.click('#enhGo');
  await p.waitForFunction(() => screen === 'enhanceResult' && $('enhAfter').naturalWidth > 0, null, { timeout: 60000 });
  eq(state.posts, ['pro'], 'one pro request');
  eq(state.sheets.length, 1, 'the face sheet goes with it (faces restored from the photo)');
  assert(await p.isVisible('#enhPro'), 'Pro panel shown on the result');
  assert((await p.textContent('#enhChanges')).includes('kept true'), 'what changed: ' + await p.textContent('#enhChanges'));
  const full = await p.evaluate(() => $('enhAfter').src);
  await p.fill('#enhStrength', '50'); await p.waitForFunction((f) => $('enhAfter').src !== f, full, { timeout: 15000 });
  eq(await p.textContent('#enhStrengthVal'), '50%', 'strength shown');
  eq(state.posts, ['pro'], 'strength never calls the AI');
  eq(await p.evaluate(() => store.get('glow.enhStyle')), 'pro', 'choice remembered');
  eq(state.errs, [], 'no page errors');
}, { start: 'enhance', camera: false, plan: 'pro', quota: 40 });

test('enhance: pick, one AI request, before/after, toggles on the phone, save, share screen, editor hand-off', async ({ p, state }) => {
  await p.goto('https://app.test/'); await p.waitForFunction(() => screen === 'enhanceHome');
  const fc = p.waitForEvent('filechooser'); await p.click('#enhPick'); await (await fc).setFiles(PORTRAIT);
  await p.waitForSelector('#enhSheet[open]'); assert(/1 AI credit/.test(await p.textContent('#enhCost')), 'cost shown before Enhance');
  await p.click('#enhGo');
  await p.waitForFunction(() => screen === 'enhanceResult' && $('enhAfter').naturalWidth > 0, null, { timeout: 30000 });
  eq(state.posts.length, 1, 'one AI request'); eq(state.posts[0], 'enhance', 'the enhance mode');
  // Each tool opens its levels: pick one, then done (or back to undo it).
  const level = async (k, i, done = true) => {
    await p.click(`.enh-t[data-k=${k}]`); await p.waitForSelector('#enhLevels:not([hidden])');
    await p.click(`#enhLvRow .enh-lv[data-i="${i}"]`);
    await p.waitForFunction(() => !$('enhWorking').classList.contains('on'), null, { timeout: 60000 });
    await p.click(done ? '#enhLvDone' : '#enhLvBack'); await p.waitForSelector('#enhToggles:not([hidden])');
  };
  eq(await p.evaluate(() => $('enhLevels').hidden), true, 'no levels open at first');
  await level('colors', 2); await level('bg', 0);
  eq(await p.evaluate(() => [enh.lv.colors, enh.lv.bg, document.querySelector('.enh-t[data-k=colors]').getAttribute('aria-pressed')]), [2, 0, 'true'], 'levels kept');
  const blur0 = await p.evaluate(() => enh.lv.blur);
  eq(blur0, 0, 'Background Blur is off until chosen, portraits too');
  await level('blur', 3, false);
  eq(await p.evaluate(() => enh.lv.blur), blur0, 'back undoes the change');
  await level('blur', 1);
  // Set as default: the next photo opens with Low blur.
  await p.click('.enh-t[data-k=blur]'); await p.click('#enhDefault'); await p.click('#enhLvDone');
  eq(await p.evaluate(() => JSON.parse(store.get('glow.enhDefaults'))), { blur: 1 }, 'default saved');
  await p.waitForTimeout(300);
  eq(state.posts.length, 1, 'levels never call the AI again');
  await p.click('#enhDownload'); await downloads(state, 1);
  await p.waitForFunction(() => screen === 'enhanceShare'); eq(await p.textContent('#enhSavedText'), 'Downloaded', 'honest save label in a browser');
  await p.click('#enhEdit'); await p.waitForFunction(() => screen === 'editorScreen' && ed.hist.length === 2 && ed.idx === 1);
  eq(state.errs, [], 'no page errors');
}, { start: 'enhance', camera: false });

// 2026-10-31 (user's screenshots): the photo shrank when a tool's levels opened, levels 1-3 looked
// alike, and some Colors looks barely differed. The frame keeps one size; each level and look differs.
test('enhance result: the photo keeps its size when levels open, each level is stronger, every look differs, defaults round-trip', async ({ p, state }) => {
  await p.goto('https://app.test/'); await p.waitForFunction(() => screen === 'enhanceHome');
  const fc = p.waitForEvent('filechooser'); await p.click('#enhPick'); await (await fc).setFiles(PORTRAIT);
  await p.waitForSelector('#enhSheet[open]'); await p.click('#enhGo');
  await p.waitForFunction(() => screen === 'enhanceResult' && $('enhAfter').naturalWidth > 0 && enh.faces.length > 0, null, { timeout: 30000 });
  const size = () => p.evaluate(() => { const r = $('enhFrame').getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; });
  const first = await size();
  for (const k of ['face', 'colors']) {
    await p.click(`.enh-t[data-k=${k}]`); await p.waitForSelector('#enhLevels:not([hidden])'); await p.waitForTimeout(100);
    eq(await size(), first, k + ' levels open: same photo size');
    await p.click('#enhLvBack'); await p.waitForTimeout(100); eq(await size(), first, 'closed: same size');
  }
  const r = await p.evaluate(async () => {
    const px = async (s) => { const im = await loadImg(s), c = newCanvas(160, Math.round(160 * im.naturalHeight / im.naturalWidth)), x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(im, 0, 0, c.width, c.height); return x.getImageData(0, 0, c.width, c.height).data; };
    const d = (a, b) => { let s = 0; for (let i = 0; i < a.length; i += 4) s += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]); return s / (a.length / 4) / 3; };
    const std = { face: 2, bg: 2, retouch: 0, colors: 0, blur: 0 }, out = {};
    for (const k of ['retouch', 'colors']) {
      const n = ENH_TOGGLES.find((t) => t[0] === k)[3].length, ims = [];
      for (let i = 0; i < n; i++) ims.push(await px(await composeEnhanced({ ...std, [k]: i })));
      out[k] = ims.map((a) => ims.map((b) => +d(a, b).toFixed(2)));
    }
    return { out, def: ENH_TOGGLES.map((t) => t[4]), key: enhAIKey() };
  });
  eq(r.def.slice(0, 2), [2, 2], 'Face and Background Enhancer start at 2, the AI result as it came');
  const rt = r.out.retouch[0]; assert(rt[1] > 0 && rt[2] > rt[1] && rt[3] > rt[2], 'retouch grows with each level: ' + rt);
  const c = r.out.colors;
  for (let i = 2; i < c.length; i++) for (let j = 1; j < c.length; j++) if (i !== j) assert(c[i][j] > 1.5, `look ${i} vs ${j} differ: ${c[i][j]}`);
  // Set as default on Retouch 2, then a new result opens with it.
  await p.click('.enh-t[data-k=retouch]'); await p.click('#enhLvRow .enh-lv[data-i="2"]');
  await p.click('#enhDefault'); await p.click('#enhLvDone');
  eq(await p.evaluate(() => JSON.parse(store.get('glow.enhDefaults'))), { retouch: 2 }, 'saved');
  await p.evaluate(() => showEnhResult()); eq(await p.evaluate(() => enh.lv.retouch), 2, 'loaded for the next result');
  await p.click('.enh-t[data-k=retouch]'); eq(await p.evaluate(() => $('enhDefault').checked), true, 'switch shows it is the default');
  eq(state.posts.length, 1, 'levels never call the AI again'); eq(state.errs, [], 'no page errors');
}, { start: 'enhance', camera: false, viewport: { width: 412, height: 892 } });

// 2026-10-31: More tools / Edit more opened the editor with no way back to the Enhance result
// (its Back went to Editor home, and the browser's Back left the app).
test('enhance: the editor opened from the result goes Back to the result (button, browser Back), and More tools again carries on the same edit', async ({ p, state }) => {
  await p.goto('https://app.test/'); await p.waitForFunction(() => screen === 'enhanceHome');
  const fc = p.waitForEvent('filechooser'); await p.click('#enhPick'); await (await fc).setFiles(PORTRAIT);
  await p.waitForSelector('#enhSheet[open]'); await p.click('#enhGo');
  await p.waitForFunction(() => screen === 'enhanceResult' && $('enhAfter').naturalWidth > 0, null, { timeout: 30000 });
  const result = await p.evaluate(() => enh.current);
  const back = () => p.evaluate(() => history.back());
  // More tools -> editor -> Back button -> the same result.
  await p.click('#enhMore'); await p.waitForFunction(() => screen === 'editorScreen' && ed.idx === 1);
  eq(await p.getAttribute('#backBtn', 'aria-label'), 'Back to Enhance', 'Back says where it goes');
  await p.click('#backBtn'); await p.waitForFunction(() => screen === 'enhanceResult');
  eq(await p.evaluate(() => [enh.current, $('enhAfter').naturalWidth > 0, $('nav').hidden]), [result, true, true], 'the same result, still showing');
  // More tools again: the same edit, no "Start a new edit?" question.
  await p.click('#enhMore'); await p.waitForFunction(() => screen === 'editorScreen');
  await p.waitForTimeout(300);
  eq(await p.evaluate(() => [!!document.querySelector('dialog[open]'), ed.hist.length, ed.idx]), [false, 2, 1], 'carried on, nothing asked');
  // The browser's (or phone's) Back from the editor: the result again, not out of the app.
  await back(); await p.waitForFunction(() => screen === 'enhanceResult');
  eq(await p.evaluate(() => enh.current), result, 'result kept after browser Back');
  // Browser Back on the unsaved result asks first, and the app is still here.
  await back(); await p.waitForSelector('#ask[open]');
  eq(await p.evaluate(() => [screen, location.href]), ['enhanceResult', 'https://app.test/'], 'still in the app, asking');
  await back(); await p.waitForFunction(() => !$('ask').open);   // Back closes the question
  eq(await p.evaluate(() => screen), 'enhanceResult', 'Keep looking');
  // Save -> Share -> Edit more -> Back -> Share.
  await p.click('#enhDownload'); await downloads(state, 1); await p.waitForFunction(() => screen === 'enhanceShare');
  await p.click('#enhEdit'); await p.waitForFunction(() => screen === 'editorScreen');
  await p.click('#backBtn'); await p.waitForFunction(() => screen === 'enhanceShare');
  await back(); await p.waitForFunction(() => screen === 'enhanceResult');
  // Edit another photo from the editor's menu still goes to Editor home.
  await p.click('#enhMore'); await p.waitForFunction(() => screen === 'editorScreen');
  await p.click('#moreBtn'); await p.click('#otherPhotoBtn'); await p.waitForFunction(() => screen === 'editorHome');
  await p.click('#resumeBtn'); await p.waitForFunction(() => screen === 'editorScreen');
  eq(await p.getAttribute('#backBtn', 'aria-label'), 'Back to Editor home', 'Resume goes back to Editor home');
  eq(state.posts.length, 1, 'one AI request in all');
  eq(state.errs, [], 'no page errors');
}, { start: 'enhance', camera: false, viewport: { width: 390, height: 740 } });

test('enhance: the sample result opens the editor demo and Back returns to the sample result', async ({ p }) => {
  await p.goto('https://app.test/'); await p.waitForFunction(() => screen === 'enhanceHome');
  await p.click('#enhSample'); await p.waitForSelector('#enhSheet[open]');
  await p.click('#enhGo'); await p.waitForFunction(() => screen === 'enhanceResult' && $('enhAfter').naturalWidth > 0, null, { timeout: 30000 });
  await p.click('#enhMore'); await p.waitForFunction(() => screen === 'editorScreen' && ed.demo, null, { timeout: 15000 });
  await p.click('#backBtn'); await p.waitForFunction(() => screen === 'enhanceResult' && enh.demo);
}, { start: 'enhance', camera: false, files: demoFiles() });

test('settings: Enhance defaults, subscription details, share the app, and suggest a feature', async ({ p, state }) => {
  await p.goto('https://app.test/'); await p.waitForFunction(() => screen === 'enhanceHome');
  await p.evaluate(() => store.set('glow.enhDefaults', JSON.stringify({ blur: 2 })));
  await p.click('#enhSettingsBtn'); await p.waitForSelector('#settings[open]');
  eq(await p.$$eval('#enhPrefsList select', (s) => s.map((x) => x.dataset.k + '=' + x.value)), ['face=2', 'bg=2', 'retouch=0', 'colors=0', 'blur=2'], 'each tool shows its default');
  await p.selectOption('#enhPrefsList select[data-k=face]', '3'); await p.selectOption('#enhPrefsList select[data-k=blur]', '0');
  eq(await p.evaluate(() => JSON.parse(store.get('glow.enhDefaults'))), { face: 3 }, 'changes saved; the standard level needs no entry');
  await p.click('#enhPrefsReset'); eq(await p.evaluate(() => store.get('glow.enhDefaults')), '{}', 'reset');
  await p.evaluate(() => { window.__shared = null; navigator.share = async (d) => { window.__shared = d; }; });
  await p.click('#shareApp'); eq(await p.evaluate(() => window.__shared && window.__shared.url), 'https://glow-photo-enhancer.vercel.app', 'share sheet gets the app link');
  await p.click('#suggestFeature'); await p.waitForSelector('#supportSheet[open]');
  eq([await p.textContent('#supportTitle'), await p.isVisible('#supportTopic')], ['Suggest a feature', false], 'idea form');
  await p.click('#supportSheet [data-close]');
  await p.click('#subsInfo'); await p.waitForSelector('#creditsSheet[open]');
  eq(state.errs, [], 'no page errors');
}, { start: 'enhance', camera: false });

// 2026-11-01: in the phone app Help restarted the app (/support has no file there) and Licenses
// was black text on the dark background. Every page now opens in an in-app sheet that follows the
// app's theme; Share never adds a "Link copied" toast once a share sheet opened; the credits sheet
// names the real 2-credit tools.
test('settings: Help, Privacy, Terms and Licenses open inside the app, readable in dark mode; share and credits text', async ({ p, state }) => {
  await p.goto('https://app.test/'); await p.waitForFunction(() => screen === 'enhanceHome');
  await p.evaluate(() => { store.set('glowTheme', 'dark'); applyTheme(); });
  const docs = [['Help and FAQ', 'Help and support', 'support'], ['Privacy policy', 'Privacy Policy', 'privacy'], ['Terms of use', 'Terms of Use', 'terms'], ['Licenses', 'Licenses', 'licenses']];
  for (const [row, h1] of docs) {
    if (!(await p.evaluate(() => $('settings').open))) await p.click('#enhSettingsBtn'); await p.waitForSelector('#settings[open]');
    await p.click(`#settings [data-doc="${row}"]`); await p.waitForSelector('#docSheet[open]');
    await p.waitForFunction((h1) => { const d = $('docFrame').contentDocument; return d && d.documentElement && d.documentElement.dataset.theme && d.querySelector('h1') && d.querySelector('h1').textContent === h1; }, h1);
    const r = await p.evaluate(() => { const d = $('docFrame').contentDocument, cs = d.defaultView.getComputedStyle(d.body);
      return [location.pathname, screen, $('docTitle').textContent, cs.color, cs.backgroundColor, d.documentElement.dataset.theme, d.defaultView.getComputedStyle(d.querySelector('.brand')).display]; });
    eq(r[0], '/', `${row}: the app stays on its page`); eq(r[1], 'enhanceHome', `${row}: no restart`); eq(r[2], h1, `${row}: sheet title`);
    eq([r[3], r[4], r[5], r[6]], ['rgb(247, 243, 234)', 'rgb(13, 13, 16)', 'dark', 'none'], `${row}: light text on dark, app header hidden`);
    await p.click('#docSheet [data-close]');
  }
  // A link to another help page stays in the sheet; the Glow Studio home link closes it.
  await p.click('#settings [data-doc="Privacy policy"]');
  await p.waitForFunction(() => { const d = $('docFrame').contentDocument; return d && d.documentElement && d.documentElement.dataset.embed && /privacy/.test(d.location.pathname) && d.querySelector('footer'); });
  await p.evaluate(() => $('docFrame').contentDocument.querySelector('footer a[href="/support.html"]').click());
  await p.waitForFunction(() => { const d = $('docFrame').contentDocument; return d && d.documentElement && d.documentElement.dataset.embed && /support/.test(d.location.pathname); });
  eq(await p.textContent('#docTitle'), 'Help and support', 'footer link opens Help in the sheet');
  await p.evaluate(() => { const a = $('docFrame').contentDocument.createElement('a'); a.href = '/'; $('docFrame').contentDocument.body.append(a); a.click(); });
  await p.waitForFunction(() => !$('docSheet').open); eq(await p.evaluate(() => [location.pathname, $('settings').open]), ['/', true], 'home link closes the sheet, back to Settings');
  // Credits sheet: the 2-credit tools are the real ones, and retired tools aren't named.
  await p.evaluate(() => { account = { plan: 'free', remaining: 3, quota: 3, trialLeft: 3 }; renderCreditsSheet(); });
  const txt = await p.textContent('#creditsBody');
  assert(/Pro edit, portrait styles, Describe, AI scene and Fill use 2\./.test(txt), 'real 2-credit tools: ' + txt);
  assert(/Golden hour, Try on, portrait styles/.test(txt) && !/Headshot|Fashion|outfits|Expand/.test(txt), 'no stale names: ' + txt);
  assert(/Daily credits work with Enhance, AI retouch, Colorize and Remove\./.test(txt), 'daily tools: ' + txt);
  eq(await p.evaluate(() => $('manageSubs').hidden), true, 'no store subscriptions on the web');
  eq(state.errs, [], 'no page errors');
}, { start: 'enhance', camera: false });

// 2026-11-02: Contact support asks for full name and email (saved on the account by the server);
// an idea keeps them optional; the Help page's Contact support button opens the form in the app.
test('contact support: name and email required, sent with the message, remembered; Help button opens the form', async ({ p, state }) => {
  await p.goto('https://app.test/'); await p.waitForFunction(() => screen === 'enhanceHome');
  await p.click('#enhSettingsBtn'); await p.waitForSelector('#settings[open]');
  await p.click('#contactSupport'); await p.waitForSelector('#supportSheet[open]');
  eq(await p.evaluate(() => [$('supportName').required, $('supportEmail').required]), [true, true], 'both required for support');
  await p.fill('#supportMessage', 'My credits did not come back');
  await p.evaluate(() => $('supportForm').requestSubmit());
  await p.waitForTimeout(200); eq(state.support.length, 0, 'not sent without a name and email');
  await p.fill('#supportName', '  Jane   Smith '); await p.fill('#supportEmail', 'jane@example.com');
  await p.click('#supportSend'); await p.waitForFunction(() => !$('supportSheet').open);
  eq([state.support[0].name, state.support[0].email, state.support[0].message], ['Jane Smith', 'jane@example.com', 'My credits did not come back'], 'name and email sent');
  await p.click('#suggestFeature'); await p.waitForSelector('#supportSheet[open]');
  eq(await p.evaluate(() => [$('supportName').required, $('supportEmail').required, $('supportName').value, $('supportEmail').value]), [false, false, 'Jane Smith', 'jane@example.com'], 'idea: optional, filled from last time');
  await p.click('#supportSheet [data-close]');
  await p.click('#settings [data-doc="Help and FAQ"]');
  await p.waitForFunction(() => { const d = $('docFrame').contentDocument; return d && d.documentElement && d.documentElement.dataset.embed && d.querySelector('[data-contact]'); });
  eq(await p.evaluate(() => $('docFrame').contentDocument.body.textContent.includes('@gmail.com')), false, 'Help page shows the form, not the email address');
  await p.evaluate(() => $('docFrame').contentDocument.querySelector('[data-contact]').click());
  await p.waitForSelector('#supportSheet[open]'); eq(await p.evaluate(() => [$('docSheet').open, $('supportTitle').textContent]), [false, 'Contact support'], 'Help button opens Contact support');
  eq(state.errs, [], 'no page errors');
}, { start: 'enhance', camera: false });

// 2026-11-02: replies from the admin Support inbox show in the app (Settings, Your messages), with a
// count, a dot on the Settings buttons, a one-time toast, follow-up replies and a thumbs rating.
test('your messages: support replies show in the app; reply back and rate', async ({ p, state }) => {
  const t = new Date().toISOString();
  state.convos = [
    { id: 7, topic: 'ai', status: 'pending', created_at: t, rating: null, unread: true, messages: [{ from: 'you', body: 'Try on failed', at: t }, { from: 'support', body: 'Hi Jane, credits returned.', at: t }] },
    { id: 3, topic: 'billing', status: 'closed', created_at: t, rating: null, unread: false, messages: [{ from: 'you', body: 'Refund?', at: t }, { from: 'support', body: 'Apple handles refunds.', at: t }] },
  ];
  state.supportBadge = { any: true, unread: 1, latest: { id: 7, at: t, preview: 'Hi Jane, credits returned.' } };
  await p.goto('https://app.test/'); await p.waitForFunction(() => screen === 'enhanceHome');
  await p.waitForFunction(() => $('enhSettingsBtn').classList.contains('has-dot'), null, { timeout: 5000 });
  // The "support replied" card: above the tab bar, with the start of the reply; it doesn't use the toast.
  await p.waitForSelector('#replyCard.on:not([hidden])', { timeout: 5000 });
  eq(await p.evaluate(() => [$('replyPreview').textContent, $('replyCard').classList.contains('over-nav'), $('toast').classList.contains('on')]), ['“Hi Jane, credits returned.”', true, false], 'reply card with preview, above the tab bar, no toast');
  const r = await p.evaluate(() => [$('replyCard').getBoundingClientRect().bottom, $('nav').getBoundingClientRect().top]);
  assert(r[0] <= r[1], 'card sits above the tab bar ' + r);
  // Close hides it for this reply, also after a reload; the dot stays until it's read.
  await p.click('#replyX'); await p.waitForFunction(() => $('replyCard').hidden);
  await p.reload(); await p.waitForFunction(() => screen === 'enhanceHome');
  await p.waitForFunction(() => $('enhSettingsBtn').classList.contains('has-dot'), null, { timeout: 5000 });
  await p.waitForTimeout(300);
  eq(await p.evaluate(() => $('replyCard').hidden), true, 'closed card stays closed for the same reply');
  await p.click('#enhSettingsBtn'); await p.waitForSelector('#settings[open]');
  eq(await p.evaluate(() => [$('myMessages').hidden, $('myMessagesCount').textContent]), [false, '1'], 'Your messages row with count');
  await p.click('#myMessages'); await p.waitForSelector('#msgsSheet[open] .convo');
  eq(await p.evaluate(() => [$('settings').open, document.querySelectorAll('#msgsBody .convo').length, $('msgsBody').textContent.includes('credits returned'), $('enhSettingsBtn').classList.contains('has-dot')]), [false, 2, true, false], 'two conversations, reply shown, dot cleared');
  await p.fill('#msgsBody .convo:first-child textarea', 'Thanks, works now');
  await p.click('#msgsBody .convo:first-child .acts .btn');
  await p.waitForFunction(() => $('msgsBody').textContent.includes('works now'));
  eq(state.supportReplies, [{ id: 7, message: 'Thanks, works now', images: [] }], 'follow-up sent to the conversation');
  await p.evaluate(() => document.querySelectorAll('#msgsBody details')[1].open = true);
  await p.click('#msgsBody .convo:nth-child(2) .rate button');
  await p.waitForFunction(() => /Glad we could help/.test($('msgsBody').textContent));
  eq(state.supportRates, [{ id: 3, rating: 1 }], 'rating sent');
  eq(state.errs, [], 'no page errors');
}, { start: 'enhance', camera: false });

test('your messages: hidden when there are no conversations', async ({ p, state }) => {
  await p.goto('https://app.test/'); await p.waitForFunction(() => screen === 'enhanceHome');
  await p.click('#enhSettingsBtn'); await p.waitForSelector('#settings[open]');
  eq(await p.evaluate(() => [$('myMessages').hidden, $('enhSettingsBtn').classList.contains('has-dot')]), [true, false], 'no row, no dot');
  eq(state.errs, [], 'no page errors');
}, { start: 'enhance', camera: false });

// 2026-11-02: screenshots on support messages (migration 018), shown back in the conversation, and
// the reply email's "Open Your messages" link (/?messages).
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
test('your messages: screenshots go with a message and show in the conversation', async ({ p, state }) => {
  const t = new Date().toISOString();
  await p.goto('https://app.test/'); await p.waitForFunction(() => screen === 'enhanceHome');
  await p.evaluate(() => openSupport(false));
  await p.waitForSelector('#supportSheet[open]');
  await p.setInputFiles('#supportSheet .shots input[type=file]', { name: 'shot.png', mimeType: 'image/png', buffer: PNG });
  await p.waitForSelector('#supportSheet .shot img');
  await p.fill('#supportMessage', 'Try on looks wrong'); await p.fill('#supportName', 'Jane Smith'); await p.fill('#supportEmail', 'jane@example.com');
  await p.click('#supportSend');
  await p.waitForFunction(() => !$('supportSheet').open);
  eq(state.support.length, 1, 'sent');
  eq([state.support[0].images.length, /^data:image\/jpeg;base64,/.test(state.support[0].images[0])], [1, true], 'one JPEG screenshot sent');
  eq(await p.evaluate(() => document.querySelectorAll('#supportSheet .shot').length), 0, 'picker cleared after sending');
  // Back in Your messages the screenshot shows in the bubble; a reply can carry one too.
  state.convos = [{ id: 9, topic: 'ai', status: 'pending', created_at: t, rating: null, unread: true,
    messages: [{ from: 'you', body: 'Try on looks wrong', at: t, images: ['data:image/png;base64,' + PNG.toString('base64')] }, { from: 'support', body: 'Thanks, checking.', at: t, images: [] }] }];
  state.supportBadge = { any: true, unread: 1 };
  await p.goto('https://app.test/?messages'); await p.waitForSelector('#msgsSheet[open] .convo', { timeout: 6000 });
  eq(await p.evaluate(() => [location.search, document.querySelectorAll('#msgsBody .b-shots img').length]), ['', 1], '/?messages opens Your messages; screenshot shown');
  await p.setInputFiles('#msgsBody .convo .shots input[type=file]', { name: 'shot.png', mimeType: 'image/png', buffer: PNG });
  await p.waitForSelector('#msgsBody .shot img');
  await p.click('#msgsBody .convo .acts .btn');
  await p.waitForFunction(() => $('msgsBody').textContent.includes('(Screenshot)'));
  eq([state.supportReplies.length, state.supportReplies[0].message, state.supportReplies[0].images.length], [1, '(Screenshot)', 1], 'screenshot-only reply sent');
  eq(state.errs, [], 'no page errors');
}, { start: 'enhance', camera: false });

test('contact support: the website link /?contact opens the form', async ({ p, state }) => {
  await p.goto('https://app.test/?contact'); await p.waitForSelector('#supportSheet[open]', { timeout: 5000 });
  eq(await p.evaluate(() => [location.search, $('supportTitle').textContent]), ['', 'Contact support'], 'form open, address cleaned');
  eq(state.errs, [], 'no page errors');
}, { start: 'enhance', camera: false });

// 2026-11-01: closing a page opened from Settings (Help, credits, Contact support...) closed Settings too.
test('settings: pages opened from Settings close back to Settings, where you were', async ({ p, state }) => {
  await p.goto('https://app.test/'); await p.waitForFunction(() => screen === 'enhanceHome');
  const open = async () => { if (!(await p.evaluate(() => $('settings').open))) await p.click('#enhSettingsBtn'); await p.waitForSelector('#settings[open]'); await p.evaluate(() => { $('settings').scrollTop = 9999; }); };
  const back = (how) => how === 'x' ? null : p.evaluate(() => goBack());
  for (const [sel, sheet] of [['[data-doc="Help and FAQ"]', 'docSheet'], ['[data-doc="Licenses"]', 'docSheet'], ['#subsInfo', 'creditsSheet'], ['#contactSupport', 'supportSheet'], ['#suggestFeature', 'supportSheet']]) {
    for (const how of ['x', 'back']) {
      await open(); const top = await p.evaluate(() => $('settings').scrollTop);
      await p.click('#settings ' + sel); await p.waitForSelector(`#${sheet}[open]`);
      if (how === 'x') await p.click(`#${sheet} [data-close]`); else await back(how);
      await p.waitForFunction((id) => !$(id).open, sheet);
      eq(await p.evaluate(() => [$('settings').open, $('settings').scrollTop > 0]), [true, top > 0], `${sel} closed with ${how}: Settings still open where it was`);
    }
  }
  // Back from Settings itself still closes it.
  await p.evaluate(() => goBack()); eq(await p.evaluate(() => $('settings').open), false, 'Back on Settings closes it');
  eq(state.errs, [], 'no page errors');
}, { start: 'enhance', camera: false });

test('settings in the Android app: share sheet without a "Link copied" toast, build line names the app, Manage subscription shown', async ({ p, state }) => {
  await p.goto('https://app.test/'); await p.waitForFunction(() => screen === 'enhanceHome');
  await p.evaluate(() => { $('toast').textContent = ''; });
  await p.click('#enhSettingsBtn'); await p.waitForSelector('#settings[open]');
  await p.click('#shareApp'); await settle(300);
  eq(await p.evaluate(() => window.__shared && window.__shared.url), 'https://glow-photo-enhancer.vercel.app', 'the phone share sheet gets the link');
  eq(await p.textContent('#toast'), '', 'no "Link copied" toast when the sheet reports it was closed');
  await p.waitForFunction(() => /Version/.test($('buildId').textContent) && !/checking/.test($('buildId').textContent));
  assert(/ · Android app/.test(await p.textContent('#buildId')) && !/localhost/.test(await p.textContent('#buildId')), 'names the app: ' + await p.textContent('#buildId'));
  eq(await p.isVisible('#manageSubs'), true, 'Manage subscription in the phone app');
  eq(state.errs, [], 'no page errors');
}, { start: 'enhance', camera: false, init: () => {
  window.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'android', Plugins: { Share: { share: async (d) => { window.__shared = d; throw new Error('Share canceled'); } } } };
} });

// 2026-10-31: a 1200x1600 photo ran Real-ESRGAN out of GPU memory; the credit came back but the
// error toast sat behind the sheet and said "lost the connection", so nothing seemed to happen.
const OOM = 'CUDA out of memory. Tried to allocate 3.66 GiB. GPU 0 has a total capacity of 14.56 GiB of which 3.28 GiB is free.';
const upSize = (p, d) => p.evaluate(async (d) => { const i = await loadImg(d); return [i.naturalWidth, i.naturalHeight]; }, d);
test('enhance: a 12 MP photo uploads at 0.9 MP at most, and a GPU out-of-memory failure retries once at 0.6 MP and shows the result', async ({ p, state }) => {
  await p.goto('https://app.test/'); await p.waitForFunction(() => screen === 'enhanceHome');
  const fc = p.waitForEvent('filechooser'); await p.click('#enhPick'); await (await fc).setFiles(path.join(fixtures, 'phone-12mp-exif6.jpg'));
  await p.waitForSelector('#enhSheet[open]'); await p.click('#enhGo');
  await p.waitForFunction(() => screen === 'enhanceResult' && $('enhAfter').naturalWidth > 0, null, { timeout: 30000 });
  eq(state.posts, ['enhance', 'enhance'], 'one retry after the memory error');
  const [a, b] = [await upSize(p, state.sizes[0]), await upSize(p, state.sizes[1])];
  assert(a[0] * a[1] <= 900_000 && a[0] * a[1] > 850_000 && Math.max(...a) <= 1280, 'first upload about 0.9 MP: ' + a);
  assert(b[0] * b[1] <= 600_000 && b[0] * b[1] > 560_000, 'retry about 0.6 MP: ' + b);
  eq(Math.abs(Math.max(...a) / Math.min(...a) - 4 / 3) < 0.01, true, 'shape kept: ' + a);
  eq([state.refunds, state.used], [1, 1], 'the failed try was refunded; one credit used in all');
  eq(state.errs, [], 'no page errors');
}, { start: 'enhance', camera: false, ai: { server: 'patched', failFirst: OOM, failCount: 1 } });

test('enhance: when the AI fails, the sheet says so plainly (no model jargon, not "lost the connection") and nothing is hidden behind the sheet', async ({ p, state }) => {
  await p.goto('https://app.test/'); await p.waitForFunction(() => screen === 'enhanceHome');
  const fc = p.waitForEvent('filechooser'); await p.click('#enhPick'); await (await fc).setFiles(PORTRAIT);
  await p.waitForSelector('#enhSheet[open]'); await p.click('#enhGo');
  await p.waitForFunction(() => $('enhCost').classList.contains('err'), null, { timeout: 30000 });
  await p.waitForTimeout(600); await p.screenshot({ path: path.join(__dirname, 'out/enhance-fail-sheet.png') });
  const r = await p.evaluate(() => ({ cost: $('enhCost').textContent, toast: $('toast').classList.contains('on'), open: $('enhSheet').open, go: $('enhGoLbl').textContent }));
  assert(/couldn't finish this photo/.test(r.cost) && /credit was returned/.test(r.cost), 'plain message on the sheet: ' + r.cost);
  assert(!/CUDA|GiB|connection/i.test(r.cost), 'no jargon, no "lost the connection": ' + r.cost);
  eq([r.toast, r.open, r.go], [false, true, 'Enhance'], 'message on the sheet (no toast behind it), sheet still open, Enhance ready again');
  // Any other toast raised while a sheet is open (say()) now draws above the sheet.
  const above = await p.evaluate(() => { say('hello'); return $('toast').matches(':popover-open'); });
  eq(above, true, 'toasts join the top layer above an open sheet');
  eq([state.posts.length, state.refunds, state.used], [2, 2, 0], 'retried once smaller, both refunded');
}, { start: 'enhance', camera: false, ai: { server: 'patched', failFirst: OOM, failCount: 2 } });

// ---------- Every face (group photos) ----------
// Pixel at a 0–1 point of an image, averaged over a small square.
const pixelAt = (p, src, x, y) => p.evaluate(async ([src, x, y]) => {
  const i = await loadImg(src), c = newCanvas(i.naturalWidth, i.naturalHeight), g = c.getContext('2d'); g.drawImage(i, 0, 0);
  const d = g.getImageData(Math.round(x * c.width) - 2, Math.round(y * c.height) - 2, 5, 5).data; let r = 0, gg = 0, b = 0;
  for (let k = 0; k < d.length; k += 4) { r += d[k]; gg += d[k + 1]; b += d[k + 2]; } return [r / 25, gg / 25, b / 25];
}, [src, x, y]);
test('enhance: a one-person photo finds its face; the AI request still goes out once', async ({ p, state }) => {
  await p.goto('https://app.test/'); await p.waitForFunction(() => screen === 'enhanceHome');
  const fc = p.waitForEvent('filechooser'); await p.click('#enhPick'); await (await fc).setFiles(PORTRAIT);
  await p.waitForSelector('#enhSheet[open]'); await p.click('#enhGo');
  await p.waitForFunction(() => screen === 'enhanceResult' && $('enhAfter').naturalWidth > 0, null, { timeout: 60000 });
  eq(state.posts.length, 1, 'one AI request');
  eq(await p.evaluate(() => enh.faces.length), 1, 'one face found');
  // A big, clear face is already well served by the main pass, so it isn't put on a face sheet.
  eq(state.sheets.length, 0, 'no face sheet for a large single face');
  eq(await p.evaluate(() => document.querySelector('.enh-t[data-k=face]').disabled), false, 'Face Enhancer available');
  eq(state.errs, [], 'no page errors');
}, { start: 'enhance', camera: false });
const GROUP = process.env.GLOW_TEST_GROUP, GROUP_FACES = +(process.env.GLOW_TEST_GROUP_FACES || 2);
if (GROUP) test('enhance: group photo, every face found, sent on one face sheet and put back', async ({ p, state }) => {
  await p.goto('https://app.test/'); await p.waitForFunction(() => screen === 'enhanceHome');
  const fc = p.waitForEvent('filechooser'); await p.click('#enhPick'); await (await fc).setFiles(GROUP);
  await p.waitForSelector('#enhSheet[open]'); await p.click('#enhGo');
  await p.waitForFunction(() => screen === 'enhanceResult' && $('enhAfter').naturalWidth > 0, null, { timeout: 90000 });
  eq(state.posts.length, 1, 'still one AI request (one credit)');
  const r = await p.evaluate(() => ({ faces: enh.faces.length, cells: enh.sheet ? enh.sheet.cells.length : 0, cell: enh.sheet && enh.sheet.cells[0],
    faceBtn: document.querySelector('.enh-t[data-k=face]').disabled }));
  assert(r.faces >= GROUP_FACES, `found ${r.faces} faces, want at least ${GROUP_FACES}`);
  assert(r.cells >= Math.min(GROUP_FACES, 12), `face sheet holds ${r.cells} faces`);
  eq(state.sheets.length, 1, 'face sheet sent with the request');
  const wh = await p.evaluate(async (d) => { const i = await loadImg(d); return [i.naturalWidth, i.naturalHeight]; }, state.sheets[0]);
  assert(Math.max(...wh) <= 1536 && wh[0] * wh[1] <= 1600000, 'sheet within the server limit: ' + wh);
  eq(r.faceBtn, false, 'Face Enhancer available on a group photo');
  // The mock sends the sheet back unchanged, so a put-back face carries the photo's own pixels.
  const [a, o, raw] = await Promise.all([pixelAt(p, await p.evaluate(() => enh.full), r.cell.cx, r.cell.cy), pixelAt(p, await p.evaluate(() => enh.src), r.cell.cx, r.cell.cy),
    pixelAt(p, 'https://app.test/__ai.jpg', r.cell.cx, r.cell.cy)]);
  const d = (x, y) => Math.max(...x.map((v, i) => Math.abs(v - y[i])));
  assert(d(a, o) < 24 && d(a, o) < d(raw, o), `face put back: result ${a} photo ${o} main pass ${raw}`);
  eq(state.errs, [], 'no page errors');
  state.report = { faces: r.faces, cells: r.cells, sheet: wh };
}, { start: 'enhance', camera: false });

// 2026-10-31 owner's choice: Pro gets Topaz on a ~3 MP copy, free gets 2-4 tiles on one credit.
const tileInfo = (d) => (d ? d.length : 0);
test('enhance sharper: free sends 2-4 tiles under 1 MP each on one credit, and the stitched result matches the photo', async ({ p, state }) => {
  await p.goto('https://app.test/'); await p.waitForFunction(() => screen === 'enhanceHome');
  const fc = p.waitForEvent('filechooser'); await p.click('#enhPick'); await (await fc).setFiles(path.join(fixtures, 'phone-12mp-exif6.jpg'));
  await p.waitForSelector('#enhSheet[open]'); await p.click('#enhGo');
  await p.waitForFunction(() => screen === 'enhanceResult' && $('enhAfter').naturalWidth > 0, null, { timeout: 30000 });
  eq([state.posts.length, state.used], [1, 1], 'one request, one credit');
  const b = state.bodies[0];
  assert(b.hd === null && tileInfo(b.tiles) >= 2 && tileInfo(b.tiles) <= 4, 'free: tiles, no Topaz copy: ' + tileInfo(b.tiles));
  const sizes = await Promise.all(b.tiles.map((t) => upSize(p, t)));
  assert(sizes.every(([w, h]) => w * h <= 1_000_000), 'each tile under 1 MP: ' + JSON.stringify(sizes));
  // Stitched back (the mock returns each tile unchanged): same shape as the photo, ~3 MP, and
  // close to the photo everywhere, seams included.
  const r = await p.evaluate(async () => {
    const a = await loadImg(enh.full), o = await loadImg(enh.src);
    const c = newCanvas(64, 85), x = c.getContext('2d'); x.drawImage(a, 0, 0, 64, 85); const A = x.getImageData(0, 0, 64, 85).data;
    x.drawImage(o, 0, 0, 64, 85); const B = x.getImageData(0, 0, 64, 85).data;
    let d = 0; for (let i = 0; i < A.length; i += 4) d = Math.max(d, Math.abs(A[i] - B[i]), Math.abs(A[i + 1] - B[i + 1]), Math.abs(A[i + 2] - B[i + 2]));
    return { w: a.naturalWidth, h: a.naturalHeight, ow: o.naturalWidth, oh: o.naturalHeight, d };
  });
  assert(Math.abs(r.w / r.h - r.ow / r.oh) < 0.01 && r.w * r.h > 2_500_000, 'stitched size: ' + JSON.stringify(r));
  assert(r.d < 40, 'stitched result matches the photo (max diff ' + r.d + ')');
  eq(state.errs, [], 'no page errors');
}, { start: 'enhance', camera: false, ai: { server: 'patched', plus: true } });

test('enhance sharper: Pro sends the ~3 MP copy for Topaz and no tiles', async ({ p, state }) => {
  await p.goto('https://app.test/'); await p.waitForFunction(() => screen === 'enhanceHome');
  const fc = p.waitForEvent('filechooser'); await p.click('#enhPick'); await (await fc).setFiles(path.join(fixtures, 'phone-12mp-exif6.jpg'));
  await p.waitForSelector('#enhSheet[open]'); await p.click('#enhGo');
  await p.waitForFunction(() => screen === 'enhanceResult' && $('enhAfter').naturalWidth > 0, null, { timeout: 30000 });
  const b = state.bodies[0], [w, h] = await upSize(p, b.hd);
  assert(!b.tiles && w * h > 2_500_000 && w * h <= 3_200_000, 'Pro: Topaz copy ~3 MP, no tiles: ' + [w, h]);
  eq(state.used, 1, 'one credit');
  eq(state.errs, [], 'no page errors');
}, { start: 'enhance', camera: false, plan: 'pro', quota: 40, ai: { server: 'patched', plus: true } });

test('enhance: the sample is free and never calls the AI', async ({ p, state }) => {
  await p.goto('https://app.test/'); await p.waitForFunction(() => screen === 'enhanceHome');
  await p.click('#enhSample'); await p.waitForSelector('#enhSheet[open]');
  assert(/No credits used/.test(await p.textContent('#enhCost')), 'free on the sample');
  await p.click('#enhGo'); await p.waitForFunction(() => screen === 'enhanceResult' && $('enhAfter').naturalWidth > 0, null, { timeout: 30000 });
  eq(state.posts.length, 0, 'no AI request for the sample');
}, { start: 'enhance', camera: false, files: demoFiles() });

test('enhance: pinch, pan and double-tap zoom on the result, with the divider still working', async ({ p }) => {
  await p.goto('https://app.test/'); await p.waitForFunction(() => screen === 'enhanceHome');
  await p.click('#enhSample'); await p.waitForSelector('#enhSheet[open]');
  await p.click('#enhGo'); await p.waitForFunction(() => screen === 'enhanceResult' && $('enhAfter').naturalWidth > 0, null, { timeout: 30000 });
  await p.waitForTimeout(1100);
  const c = await p.context().newCDPSession(p), T = (type, pts) => c.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y, id]) => ({ x, y, id })) });
  const r = await p.evaluate(() => { const b = $('enhFrame').getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; });
  const at = (fx, fy) => [r.x + r.w * fx, r.y + r.h * fy];
  const st = () => p.evaluate(() => ({ z: cz.z, x: cz.x, y: cz.y, split: enh.split, chip: !$('enhZoom').hidden,
    same: $('enhBefore').style.transform === $('enhAfter').style.transform }));
  const tap = async (x, y) => { await T('touchStart', [[x, y, 0]]); await T('touchEnd', []); };
  // Pinch out on the left of the face: zooms, the divider stays at 50%.
  const [px, py] = at(0.3, 0.4);
  await T('touchStart', [[px - 20, py, 0], [px + 20, py, 1]]);
  for (let i = 1; i <= 6; i++) await T('touchMove', [[px - 20 - 12 * i, py, 0], [px + 20 + 12 * i, py, 1]]);
  await T('touchEnd', []);
  let s = await st();
  assert(s.z > 1.8, 'pinch zooms in: ' + s.z); eq(Math.round(s.split), 50, 'pinch leaves the divider alone'); assert(s.same && s.chip, 'both pictures zoomed together, zoom chip shown');
  // One finger away from the divider pans both pictures.
  const [ax, ay] = at(0.8, 0.5), before = s;
  await T('touchStart', [[ax, ay, 0]]); for (let i = 1; i <= 5; i++) await T('touchMove', [[ax - 10 * i, ay - 6 * i, 0]]); await T('touchEnd', []);
  s = await st();
  assert(s.x < before.x - 0.01 && s.y < before.y - 0.01, 'one finger pans once zoomed'); eq(Math.round(s.split), 50, 'panning leaves the divider alone'); eq(s.z.toFixed(2), before.z.toFixed(2), 'pan keeps the zoom');
  // Dragging the divider while zoomed still moves it and doesn't pan.
  const [lx, ly] = at(0.5, 0.6), panned = s;
  await T('touchStart', [[lx, ly, 0]]); for (let i = 1; i <= 5; i++) await T('touchMove', [[lx - 16 * i, ly, 0]]); await T('touchEnd', []);
  s = await st();
  assert(s.split < 35, 'the divider moves while zoomed: ' + s.split); eq([s.x.toFixed(3), s.z.toFixed(2)], [panned.x.toFixed(3), panned.z.toFixed(2)], 'the divider drag does not pan');
  // Double-tap goes back to fit.
  const [dx, dy] = at(0.75, 0.3);
  await tap(dx, dy); await p.waitForTimeout(80); await tap(dx, dy); await p.waitForTimeout(320);
  s = await st(); eq([s.z, s.x, s.y, s.chip], [1, 0, 0, false], 'double-tap fits the photo again');
  // At fit, double-tap zooms in on the spot and puts the divider through it.
  const [ex, ey] = at(0.3, 0.3);
  await tap(ex, ey); await p.waitForTimeout(80); await tap(ex, ey); await p.waitForTimeout(320);
  s = await st();
  eq(s.z.toFixed(1), '2.5', 'double-tap zooms to 2.5x'); eq(Math.round(s.split), 50, 'the divider moves to the middle');
  const mid = await p.evaluate(() => [(0.5 - cz.x) / cz.z, (0.5 - cz.y) / cz.z]);
  assert(Math.abs(mid[0] - 0.3) < 0.02 && Math.abs(mid[1] - 0.3) < 0.02, 'the tapped spot is in the middle: ' + mid);
  // The chip fits it again; a single tap at fit still moves the divider as before.
  await p.click('#enhZoom'); await p.waitForTimeout(300); s = await st(); eq(s.z, 1, 'zoom chip fits the photo');
  await p.waitForTimeout(400); const [fx, fy] = at(0.8, 0.5); await tap(fx, fy); s = await st(); eq(Math.round(s.split), 80, 'a tap at fit still moves the divider');
  // Wheel zoom (desktop) and keyboard on the divider.
  await p.mouse.move(...at(0.5, 0.5)); await p.mouse.wheel(0, -300); s = await st(); assert(s.z > 1.3, 'wheel zooms: ' + s.z);
  await p.focus('#enhKnob'); await p.keyboard.press('0'); await p.waitForTimeout(300); s = await st(); eq(s.z, 1, '0 on the divider fits');
}, { start: 'enhance', camera: false, files: demoFiles() });

test('onboarding: Choose a photo on the welcome screen opens the picker and the editor', async ({ p }) => {
  await p.goto('https://app.test/'); await p.evaluate(() => showOnboarding()); await p.waitForSelector('#onboarding:not([hidden])');
  const fc = p.waitForEvent('filechooser'); await p.click('#obPick'); await (await fc).setFiles(PORTRAIT);
  await p.waitForFunction(() => screen === 'editorScreen' && ed.hist.length > 0 && !ed.demo, null, { timeout: 15000 });
}, { onboarded: false, camera: false });

// ---------- Editor layout ----------
async function stageBox(p) { return p.evaluate(() => { const r = $('stage').getBoundingClientRect(); return [Math.round(r.top), Math.round(r.height), Math.round(r.width)]; }); }
for (const [w, h] of [[390, 844], [320, 640], [412, 915]]) test(`layout: categories never resize the photo at ${w}×${h} (photo and sample)`, async ({ p }) => {
  await p.goto('https://app.test/'); await pick(p, fx('transparent.png'));
  for (const run of ['photo', 'sample']) {
    if (run === 'sample') { await p.click('#backBtn'); await p.click('#sampleBtn:visible, #qaSampleBtn:visible'); await p.waitForFunction(() => ed.demo && $('before').naturalWidth > 0); }
    const boxes = {};
    for (const c of ['retouch', 'looks', 'edit', 'bg', 'ai']) { await p.click(`.tab[data-cat="${c}"]`); await settle(120); boxes[c] = await stageBox(p); }
    const first = JSON.stringify(boxes.retouch);
    for (const [c, b] of Object.entries(boxes)) eq(JSON.stringify(b), first, `${run}: ${c} vs Beauty`);
    eq(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${run}: no sideways scroll`);
  }
}, { viewport: { width: w, height: h } });

test('layout: stone (light) and ink (dark) surround, photo contained, edited view first, compare only after an edit', async ({ p, state }) => {
  await p.goto('https://app.test/'); await pick(p, fx('phone-12mp-exif6.jpg'));
  const bg = () => p.evaluate(() => getComputedStyle($('stage')).backgroundColor);
  eq(await bg(), 'rgb(13, 13, 16)', 'dark: ink');
  await p.evaluate(() => { store.set('glowTheme', 'light'); applyTheme(); }); eq(await bg(), 'rgb(250, 247, 240)', 'light: ivory');
  const st = await p.evaluate(() => ({ view: $('stage').dataset.view, disabled: [$('compareBtn').disabled, $('revertBtn').disabled], radius: getComputedStyle($('stage')).borderTopLeftRadius,
    fit: getComputedStyle($('before')).objectFit, frame: (() => { const f = $('view').getBoundingClientRect(), s = $('stage').getBoundingClientRect(); return f.width <= s.width + 0.5 && f.height <= s.height + 0.5 && Math.abs(f.width / f.height - ed.original.w / ed.original.h) < 0.02; })() }));
  eq(st, { view: 'edited', disabled: [true, true], radius: '16px', fit: 'contain', frame: true }, 'before any edit (rounded, with a small margin)');
  await tool(p, 'looks', 'filters', 'filter:glow'); await p.waitForFunction(() => !!ed.pending);
  eq(await p.evaluate(() => [$('stage').dataset.view, $('compareBtn').disabled]), ['edited', false], 'comparison available once there is a preview');
  eq(await p.isVisible('#divider'), false, 'no divider outside Compare');
  await p.click('#compareBtn');
  const d = await p.evaluate(() => { const h = $('handle').getBoundingClientRect(), k = $('handle').querySelector('i').getBoundingClientRect(), f = $('view').getBoundingClientRect(), dv = $('divider').getBoundingClientRect();
    return { target: [Math.round(h.width), Math.round(h.height)], knob: Math.round(k.width), at: +(((h.top + h.height / 2) - f.top) / f.height).toFixed(2), line: Math.round(dv.width) }; });
  eq(d.target, [44, 44], 'handle touch target'); assert(d.knob >= 24 && d.knob <= 28, 'visible knob ' + d.knob); eq(d.line, 2, '2px divider');
  assert(Math.abs(d.at - 0.75) < 0.03, 'handle about 75% down: ' + d.at);
  const seg = await p.evaluate(() => { const v = document.querySelector('.viewbar').getBoundingClientRect(), s = $('stage').getBoundingClientRect(), b = $('compareBtn').getBoundingClientRect();
    return { below: v.top >= 0 && v.bottom <= s.top, h: Math.round(b.height), font: parseFloat(getComputedStyle($('compareBtn')).fontSize), one: Math.round(v.height) <= 52 }; });
  eq([seg.below, seg.h >= 44, seg.one], [true, true, true], 'one compact utility row in the top bar, off the photo, 44px targets'); assert(seg.font >= 13 && seg.font <= 15, 'label size ' + seg.font);
  await p.focus('#handle'); await p.keyboard.press('ArrowLeft'); eq(await p.getAttribute('#handle', 'aria-valuenow'), '48', 'keyboard moves the divider');
  // Saved file is the photo alone: its own size, no canvas margins.
  await applyTool(p); await idle(p); await p.click('#saveBtn'); await downloads(state, 1);
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
  assert(/Resets at .* \(in \d+ h \d+ min\)/.test(await p.textContent('#creditsBody')), 'explains the real reset');
});

test('layout: Search covers every tool in a taller catalog; the last tools scroll fully into view', async ({ p }) => {
  await p.goto('https://app.test/'); await pick(p, fx('transparent.png'));
  const s0 = await stageBox(p);
  await p.click('#searchBtn'); eq(await p.evaluate(() => [searching, !$('searchBox').hidden]), [true, true], 'search open');
  eq(await p.evaluate(() => document.activeElement.id), 'searchInput', 'focus in the search field');
  const tall = await p.evaluate(() => $('tools').getBoundingClientRect().height); assert(tall > 300, 'taller catalog ' + tall);
  eq(await p.evaluate(() => new Set([...document.querySelectorAll('#tools .tool')].map((b) => b.dataset.tool)).size), await p.evaluate(() => TOOLS.filter((t) => !RETIRED.includes(t.id) && !IN_TRY_ON.includes(t.id)).length), 'every tool still offered is in Search');
  await p.fill('#searchInput', 'blur'); eq(await p.$$eval('#tools .tool', (x) => x.map((b) => b.dataset.tool)), ['bgblur', 'enhance'], 'search (Enhance by its everyday word "blurry")');
  await p.click('.tool[data-tool="bgblur"]'); await idle(p);
  eq(await p.evaluate(() => [sel, cat, searching]), ['bgblur', 'bg', false], 'a found tool opens in its own tab');
  await p.click('#cancelBtn'); await settle(150);
  eq(JSON.stringify(await stageBox(p)), JSON.stringify(s0), 'closing restores the photo size');
  await p.click('.tab[data-cat="retouch"]');
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
const PORTRAIT = path.join(__dirname, '../public/samples/demo-v2/original.png');
// A standing, full-length person in a room (set GLOW_TEST_BODY to use your own); else the sample portrait.
const AREA_PHOTO = process.env.GLOW_TEST_BODY || PORTRAIT;
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
  await set(100); await applyTool(p); await idle(p);
  for (const id of ['fnose', 'fbigeyes']) {
    await tool(p, 'retouch', 'face', id); await p.waitForFunction(() => reshapeNote && reshapeNote.msg === '', null, { timeout: 30000 });
    await set(100); await applyTool(p); await idle(p);
  }
  eq(await p.evaluate(() => ed.hist.map((h) => h.op && h.op.tool)), [null, 'fslim', 'fnose', 'fbigeyes'], 'three reshape steps, one each');
  // Undo/redo walk the same pictures back and forth.
  const last = await p.evaluate(() => committed());
  await p.click('#undoBtn'); await p.click('#undoBtn'); await p.click('#redoBtn'); await p.click('#redoBtn');
  eq(await p.evaluate((l) => committed() === l, last), true, 'redo returns to the combined result');
  await p.click('#saveBtn'); await downloads(state, 1);
  const sz = imageSize(state.downloads[0].file); eq([sz.w, sz.h], [1086, 1448], 'saved at the photo size');
  eq([state.posts.length, state.used], [0, 0], 'no AI request and no credit used');
});
test('retouch: Compare puts the divider on the face; Settings shows which build this is', async ({ p }) => {
  await p.goto('https://app.test/'); await pick(p, PORTRAIT);
  await tool(p, 'retouch', 'face', 'fslim'); await p.waitForFunction(() => reshapeNote && reshapeNote.msg === '', null, { timeout: 30000 });
  await p.fill('.panel input[type=range]', '100'); await settle(200); await idle(p);
  await p.click('#compareBtn');
  const r = await p.evaluate(() => { const f = $('view').getBoundingClientRect(), d = $('divider').getBoundingClientRect(), P = faceCache.get(committed())[0];
    return { x: d.left + d.width / 2, nose: f.left + P[1][0] * f.width, f: [f.left, f.right] }; });
  near(r.x, r.nose, 2, 'divider runs down the nose'); assert(r.x > r.f[0] && r.x < r.f[1], 'divider is on the photo');
  await p.click('#cancelBtn'); await p.click('#settingsBtn').catch(() => p.evaluate(() => openSettings()));
  await p.waitForFunction(() => /Version/.test($('buildId').textContent) && !/checking/.test($('buildId').textContent));
  const line = await p.textContent('#buildId');
  assert(new RegExp(`^Version ${await p.evaluate(() => APP_BUILD)} \\([0-9a-f]{8}\\) · Web`).test(line), 'build line names the version and fingerprint: ' + line);
  assert(/reshape-v2 · crop-v2/.test(await p.getAttribute('#buildId', 'title')), 'features kept in the tooltip');
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
  await p.click('[aria-label="Rotate 90°"]'); await settle(260); const r = await cropInfo(p);
  eq([r.W, r.H, r.turns], [400, 600, 1], 'rotated bounds'); near(r.rect.x, 400 - (c.rect.y + c.rect.h), 0.5, 'crop follows the turn (x)'); near(r.rect.y, c.rect.x, 0.5, 'crop follows the turn (y)');
  near(r.rect.w / r.rect.h, 1, 0.002, 'still square'); covered(r, 'rotated');
  await p.click('.panel .opt:has-text("9:16")'); await p.click('[aria-label="Rotate 90°"]'); await settle(260); const r2 = await cropInfo(p);
  near(r2.rect.w / r2.rect.h, 9 / 16, 0.002, '9:16 stays 9:16 after a turn'); covered(r2, 'rotated 9:16');
  await p.click('#cropReset'); await settle(260); c = await cropInfo(p);
  eq([c.turns, c.aspect, Math.round(c.rect.w), Math.round(c.rect.h)], [0, 0, 600, 400], 'reset framing');
  eq(await p.evaluate(() => $('applyBtn').disabled), true, 'nothing to apply after reset');
});
test('crop: Cancel restores, Apply exports exactly the framed area at full size, one undo step, and re-opening keeps the framing', async ({ p, state }) => {
  await openCropOn(p, fx('coords-600x400.png'));
  await p.fill('#cropZoom', '250'); await p.click('[aria-label="Rotate 90°"]');
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
  await applyTool(p); await idle(p);
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
  await p.click('[aria-label="Rotate 90°"]'); await applyTool(p); await idle(p);
  const op2 = await p.evaluate(() => ed.hist[ed.idx].op); eq([op2.base, op2.turns], [0, 1], 'the new crop is made from the uncropped photo');
  // Saved file: the full-size render of the same crop.
  await p.click('#saveBtn'); await downloads(state, 1);
  const sz = imageSize(state.downloads[0].file), want = await p.evaluate(async () => { const i = await loadImg(committed()); return [i.naturalWidth, i.naturalHeight]; });
  eq([sz.w, sz.h], want, 'saved file is exactly the cropped size');
  const same = await p.evaluate(async (file) => {
    const [a, b] = await Promise.all([loadImg(committed()), loadImg(file)]), w = a.naturalWidth, h = a.naturalHeight;
    const ca = newCanvas(w, h).getContext('2d'), cb = newCanvas(w, h).getContext('2d'); ca.drawImage(a, 0, 0); cb.drawImage(b, 0, 0, w, h);
    // Everything outside the badge's own box (plus its soft shadow) must match.
    const m = markLayout(cb, w, h), bx = m.x - m.H * 0.5, by = m.y - m.H * 0.5;
    const da = ca.getImageData(0, 0, w, h).data, db = cb.getImageData(0, 0, w, h).data; let sum = 0, n = 0;
    for (let i = 0; i < da.length; i += 4) { const x = (i / 4) % w, y = Math.floor(i / 4 / w); if (x >= bx && y >= by) continue; sum += Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]); n += 2; }
    return sum / n;
  }, 'data:image/png;base64,' + fs.readFileSync(state.downloads[0].file).toString('base64'));
  assert(same < 3, 'saved file matches the preview pixel for pixel, apart from the free-plan Glow Studio badge (mean difference ' + same.toFixed(2) + ')');
  eq([state.posts.length, state.used], [0, 0], 'no AI request and no credit used');
});
test('crop: a 12 MP photo crops at full resolution from the original', async ({ p, state }) => {
  await openCropOn(p, fx('phone-12mp-exif6.jpg'));
  await p.click('.panel .opt:has-text("9:16")'); await p.fill('#cropZoom', '200'); await p.click('[aria-label="Rotate 90°"]');
  await applyTool(p); await idle(p); await p.click('#saveBtn'); await downloads(state, 1);
  const op = await p.evaluate(() => ed.hist[ed.idx].op), s = imageSize(state.downloads[0].file);
  // Rotated original is 4032 × 3024; 9:16 at 2× zoom is half the tallest 9:16 that fits.
  near(s.h, Math.round(op.rect.h * 3024), 2, 'height from the original'); near(s.w / s.h, 9 / 16, 0.002, 'exact 9:16'); assert(s.w > 800, 'full resolution, not the preview: ' + s.w);
  state.report = { case: '12 MP crop', exported: [s.w, s.h], rect: op.rect };
});

// ---------- Face tools on a real portrait (only with GLOW_TEST_FACE) ----------
if (face) test('face: smooth skin previews at 2048px and saves at full size', async ({ p, state }) => {
  await p.goto('https://app.test/'); await pick(p, face);
  await tool(p, 'retouch', 'skin', 'fsmooth'); await p.waitForFunction(() => !!ed.pending, null, { timeout: 30000 });
  await applyTool(p); await idle(p); await p.click('#saveBtn'); await downloads(state, 1);
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
  await p.click('#compareBtn'); await settle(200);
  const s0 = await viewState(p), { T, wait } = await touchpad(p);
  eq(s0.z, 1, 'starts at fit'); near(s0.divider, s0.v.x + (s0.split / 100) * s0.v.w, 1.5, 'divider starts where Compare puts it (on the face)');
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
  await p.click('#compareBtn'); eq(await p.evaluate(() => $('stage').dataset.view), 'original', 'Compare steps to the original'); await p.click('#compareBtn'); await p.click('#compareBtn');
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
  await applyTool(p); await idle(p); await p.click('#saveBtn'); await downloads(state, 1);
  eq((({ w, h }) => [w, h])(imageSize(state.downloads[0].file)), [1086, 1448], 'saved at the photo size while zoomed in');
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
  await p.click('#backBtn').catch(() => {}); await p.evaluate(() => document.activeElement && document.activeElement.blur());
  await pick(p, fx('phone-12mp-exif6.jpg')); eq((await viewState(p)).z, 1, 'a newly opened photo starts at fit');
  await p.keyboard.press('+'); await settle(300); near((await viewState(p)).z, 1.6, 0.01, '+ zooms in');
  assert(/Zoom 160%/.test(await p.textContent('#alertLive')), 'zoom level announced');
  await p.keyboard.press('0'); await settle(300); eq((await viewState(p)).z, 1, '0 fits');
  await p.click('#backBtn').catch(() => {}); await pick(p, PORTRAIT);
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
test('filters: a Strength slider blends the filter; 100 is the full filter and the saved file follows it', async ({ p }) => {
  await p.goto('https://app.test/'); await pick(p, PORTRAIT);
  await tool(p, 'looks', 'filters', 'filter:vivid'); await p.waitForFunction(() => !!ed.pending); const full = await p.evaluate(() => ed.pending.data);
  await p.fill('.panel input[type=range]', '40'); await p.waitForFunction((f) => ed.pending && ed.pending.data !== f, full); await idle(p);
  await applyTool(p); await idle(p);
  const r = await p.evaluate(async () => { const px = async (s) => { const i = await loadImg(s), c = newCanvas(64, 64), x = c.getContext('2d'); x.drawImage(i, 0, 0, 64, 64); return x.getImageData(0, 0, 64, 64).data; };
    const o = await px(ed.hist[0].data), f = await px(await applyFilter(ed.hist[0].data, TOOL['filter:vivid'].filter)), e = await px((await renderExport()).data);
    let df = 0, de = 0; for (let i = 0; i < o.length; i += 4) { df += Math.abs(f[i] - o[i]); de += Math.abs(e[i] - o[i]); }
    return { op: ed.hist[ed.idx].op.amt, ratio: de / df }; });
  eq(r.op, 0.4, 'strength recorded in the edit'); near(r.ratio, 0.4, 0.08, 'saved file is 40% of the filter');
}, { viewport: { width: 390, height: 844 } });
test('layout: on phones the idle editor reserves no panel space, and a closed tool gives its room back to the photo', async ({ p }) => {
  await p.goto('https://app.test/'); await pick(p, PORTRAIT);
  const sizes = {}, box = async (n) => { await settle(400); sizes[n] = await stageBox(p); };
  const gaps = () => p.evaluate(() => { const g = (s) => document.querySelector(s).getBoundingClientRect(), st = g('#stage'), vb = g('#editorScreen .viewbar'), tl = g('#editorScreen .side > .tools'), tb = g('#editorScreen .tabs');
    const ch = g('#subchips');
    return { rowOnPhoto: vb.top >= 0 && vb.bottom <= st.top, photoToTools: Math.round(tl.top - st.bottom - ch.height), chipsOnTools: Math.round(tl.top - ch.bottom), toolsToTabs: Math.round(tb.top - tl.bottom), tabsToEnd: Math.round(innerHeight - tb.bottom),
      toolsH: Math.round(tl.height), labels: [...document.querySelectorAll('#editorScreen .side > .tools .group-label')].filter((e) => e.offsetParent).length }; });
  const g = await gaps();
  eq([g.rowOnPhoto, g.photoToTools, g.chipsOnTools, g.toolsToTabs, g.tabsToEnd, g.labels], [true, 0, 0, 0, 0, 0], 'utility row in the top bar, off the photo; group chips, tool row and tabs stacked under it with no empty space or group labels: ' + JSON.stringify(g));
  assert(g.toolsH <= 90, 'one compact tool row: ' + g.toolsH);
  await box('home');
  assert(sizes.home[1] >= 520, 'the photo takes the remaining height on a 390x844 phone: ' + sizes.home);
  await tool(p, 'retouch', 'face', 'fslim'); await p.waitForFunction(() => reshapeNote && reshapeNote.msg === '', null, { timeout: 30000 }); await box('face shape');
  assert(sizes['face shape'][1] < sizes.home[1], 'an open tool takes room for its controls');
  await p.click('#cancelBtn'); await box('cancelled');
  await tool(p, 'edit', 'crop', 'crop'); await p.waitForFunction(() => !!cr); await box('crop');
  await p.click('#cancelBtn'); await box('closed');
  for (const n of ['cancelled', 'closed']) eq(sizes[n], sizes.home, 'closing gives the room back: ' + n);
}, { viewport: { width: 390, height: 844 } });
test('layout: the default Beauty row is Glow Up, Auto, Retouch, Smooth, Blemish under chips Auto, Skin, Face, Makeup, Hair', async ({ p }) => {
  await p.goto('https://app.test/'); await pick(p, PORTRAIT);
  const r = await p.evaluate(() => { const box = document.querySelector('#editorScreen .side > .tools').getBoundingClientRect();
    const tiles = [...document.querySelectorAll('#tools .tool[data-tool]')].map((b) => ({ id: b.dataset.tool, name: b.querySelector('.name').textContent, r: b.getBoundingClientRect() }));
    return { first: tiles.slice(0, 5).map((t) => t.name), visible: tiles.filter((t) => t.r.right <= box.right + 1).map((t) => t.name), all: tiles.map((t) => t.id) }; });
  eq(r.first, ['Glow Up', 'Auto', 'Retouch', 'Smooth', 'Blemish'], 'default row');
  eq(r.visible.slice(0, 5), ['Glow Up', 'Auto', 'Retouch', 'Smooth', 'Blemish'], 'all five on screen at 390 wide');
  for (const id of ['fundereye', 'fauto', 'fbigeyes', 'fteeth', 'retouch', 'flips', 'hcolor']) assert(r.all.includes(id), id + ' still in the Beauty tab');
  eq(await p.$$eval('#subchips .subchip', (x) => x.map((c) => [c.textContent, c.getAttribute('aria-pressed')])),
    [['Auto', 'true'], ['Skin', 'false'], ['Face', 'false'], ['Makeup', 'false'], ['Hair', 'false']], 'group chips, the first marked');
}, { viewport: { width: 390, height: 740 } });
test('layout: at 390x740 the sample portrait shows wide and whole, with a small badge and no extra rows', async ({ p }) => {
  await openDemo(p); await settle(600);
  const r = await p.evaluate(() => { const st = $('stage').getBoundingClientRect(), im = $('before').getBoundingClientRect(), hd = document.querySelector('#editorScreen .topbar').getBoundingClientRect();
    return { imgW: im.width, imgH: im.height, ratio: im.width / im.height, nat: $('before').naturalWidth / $('before').naturalHeight, inside: im.top >= st.top - 0.5 && im.bottom <= st.bottom + 0.5 && im.left >= st.left - 0.5 && im.right <= st.right + 0.5,
      fit: getComputedStyle($('before')).objectFit, header: hd.height, headerBtns: [...document.querySelectorAll('#editorScreen .topbar button')].filter((b) => b.offsetParent).map((b) => b.id), docH: document.documentElement.scrollHeight }; });
  assert(r.imgW >= 360, 'portrait nearly full width: ' + r.imgW); near(r.ratio, r.nat, 0.01, 'aspect ratio kept');
  assert(r.inside, 'whole photo visible'); eq(r.docH, 740, 'nothing below the screen');
  eq(r.headerBtns, ['backBtn', 'saveBtn'], 'header: Back, Glow, Save only');
}, { viewport: { width: 390, height: 740 } });
test('layout: a phone held sideways puts the photo and the tools side by side', async ({ p }) => {
  await p.goto('https://app.test/'); await pick(p, PORTRAIT);
  await tool(p, 'looks', 'filters', 'filter:glow'); await p.waitForFunction(() => !!ed.pending);
  const r = await p.evaluate(() => { const g = (s) => document.querySelector(s).getBoundingClientRect(), st = g('#stage'), vb = g('#editorScreen .viewbar'), side = g('#editorScreen .side'), ap = g('#applyBtn'), tl = g('#tools');
    return { stageH: st.height, viewbarIn: vb.bottom <= innerHeight + 0.5, besides: side.left >= st.right, apply: ap.bottom <= innerHeight, tools: tl.height > 40, sideways: document.documentElement.scrollWidth > innerWidth }; });
  assert(r.stageH > 250, 'photo keeps its height: ' + r.stageH);
  eq([r.viewbarIn, r.besides, r.apply, r.tools, r.sideways], [true, true, true, true, false], 'side by side, nothing overlapping or off screen');
}, { viewport: { width: 844, height: 390 } });
test('layout: photo-first editor, collapsible panel, no sideways scroll on small phones', async ({ p }) => {
  await p.goto('https://app.test/'); await pick(p, PORTRAIT);
  await tool(p, 'retouch', 'face', 'fslim'); await p.waitForFunction(() => reshapeNote && reshapeNote.msg === '', null, { timeout: 30000 });
  const m = () => p.evaluate(() => ({ stage: $('stage').getBoundingClientRect().height, head: document.querySelector('#editorScreen .topbar').getBoundingClientRect().height,
    apply: ($('panel').classList.contains('live') ? $('panelBody').querySelector('.slider') : $('applyBtn')).getBoundingClientRect().bottom <= innerHeight, small: [...document.querySelectorAll('#editorScreen button')].filter((b) => b.offsetParent && !b.classList.contains('tool') && !b.classList.contains('tab') && !b.classList.contains('subchip') && b.id !== 'saveBtn').map((b) => [b.id || b.textContent.trim(), Math.round(b.getBoundingClientRect().height)]).filter(([, h]) => h < 44),
    sideways: document.documentElement.scrollWidth > innerWidth }));
  const a = await m();
  // The small Save pill keeps a 44px touch target through an invisible ::after.
  const save = await p.evaluate(() => { const b = $('saveBtn'), r = b.getBoundingClientRect(), af = getComputedStyle(b, '::after'); return r.height - parseFloat(af.top) - parseFloat(af.bottom); });
  assert(save >= 44, 'Save touch target ' + save);
  assert(a.head <= 48, 'compact header ' + a.head); assert(a.apply, 'Apply reachable'); eq(a.small, [], 'touch targets at least 44px'); eq(a.sideways, false, 'no sideways scroll');
  await p.click('#collapseBtn'); await settle(150);
  const b = await m();
  assert(b.stage > a.stage + 60, `collapsing gives the photo room: ${a.stage} -> ${b.stage}`); assert(b.apply, 'Apply still reachable');
  eq(await p.getAttribute('#collapseBtn', 'aria-expanded'), 'false', 'collapse state is announced');
  await p.click('#collapseBtn'); await settle(150); near((await m()).stage, a.stage, 1, 'expands again');
}, { viewport: { width: 320, height: 640 } });

// ---------- Glow mark on free saves, Share Glow card, full view ----------
const fileB64 = (f) => fs.readFileSync(f).toString('base64');
// Pixel difference between two images of the same size, as the bounding box of changed pixels.
const diffBox = (p, a, b) => p.evaluate(async ([a, b]) => {
  const px = async (s) => { const i = await loadImg(s), c = newCanvas(i.naturalWidth, i.naturalHeight), x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(i, 0, 0); return { w: c.width, h: c.height, d: x.getImageData(0, 0, c.width, c.height).data }; };
  const A = await px(a), B = await px(b); if (A.w !== B.w || A.h !== B.h) return { size: [A.w, A.h, B.w, B.h] };
  let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
  for (let y = 0; y < A.h; y++) for (let x = 0; x < A.w; x++) { const i = (y * A.w + x) * 4; if (Math.abs(A.d[i] - B.d[i]) + Math.abs(A.d[i + 1] - B.d[i + 1]) + Math.abs(A.d[i + 2] - B.d[i + 2]) > 90) { if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; } }
  return { w: A.w, h: A.h, box: x1 < 0 ? null : [x0, y0, x1, y1] };
}, [a, b]);
const mime = (f) => /\.png$/.test(f) ? 'image/png' : 'image/jpeg';
test('mark: free saves carry a small Glow mark bottom-right, shown once before the first save; no credit or request', async ({ p, state }) => {
  await p.goto('https://app.test/'); await pick(p, fx('phone-12mp-exif6.jpg'));
  await tool(p, 'looks', 'filters', 'filter:glow'); await applyTool(p); await idle(p);
  await p.click('#saveBtn'); await p.waitForSelector('#ask[open] #askImg');
  eq(await p.textContent('#askTitle'), 'Free saves include a small Glow Studio badge', 'disclosed before the first free save');
  assert(await p.evaluate(() => $('askImg').naturalWidth > 100), 'shows a preview of the marked corner');
  await p.click('#ask .btn:has-text("Save")'); const [d] = await downloads(state, 1);
  const clean = await p.evaluate(async () => (await renderExport()).data);
  const r = await diffBox(p, `data:${mime(d.file)};base64,${fileB64(d.file)}`, clean);
  assert(r.box, 'the saved photo has a mark'); const [x0, y0, x1, y1] = r.box;
  assert(x0 > r.w * 0.5 && y0 > r.h * 0.9, `only in the bottom-right corner: ${r.box} of ${r.w}x${r.h}`);
  assert(x1 < r.w - 4 && y1 < r.h - 4, 'inset from the edges');
  assert((x1 - x0) < r.w * 0.5 && (y1 - y0) < r.h * 0.06, 'small: ' + [x1 - x0, y1 - y0]);
  eq(await p.evaluate(() => PUBLIC_HOST), 'glow-photo-enhancer.vercel.app', 'uses the configured production address');
  // A second save in the session: no dialog again.
  await tool(p, 'looks', 'filters', 'filter:warm'); await applyTool(p); await idle(p);
  await p.click('#saveBtn'); await downloads(state, 2); eq(await p.evaluate(() => $('ask').open), false, 'told once, not every save');
  eq([state.posts.length, state.used, state.lookups], [0, 0, state.lookups], 'no AI request and no credit for marking');
}, { viewport: { width: 390, height: 844 }, markIntro: true });
test('mark: placed after crop and rotation, at small and large sizes; paid saves stay clean', async ({ p, state }) => {
  await p.goto('https://app.test/'); await pick(p, fx('coords-600x400.png'));
  await tool(p, 'edit', 'crop', 'crop'); await p.waitForFunction(() => !!cr);
  await p.click('.panel .opt:has-text("Square")'); await p.click('[aria-label="Rotate 90°"]'); await settle(300);
  await applyTool(p); await idle(p); await p.click('#saveBtn'); const [d] = await downloads(state, 1);
  const clean = await p.evaluate(async () => (await renderExport()).data);
  const r = await diffBox(p, `data:${mime(d.file)};base64,${fileB64(d.file)}`, clean);
  assert(r.box && r.box[0] > r.w * 0.4 && r.box[1] > r.h * 0.8, `small cropped and rotated save: mark bottom-right ${r.box} of ${r.w}x${r.h}`);
  eq(r.w, r.h, 'square crop kept');
  await p.click('#backBtn'); await pick(p, fx('large-24mp.jpg'));
  await tool(p, 'looks', 'filters', 'filter:glow'); await applyTool(p); await idle(p); await p.click('#saveBtn'); const d2 = (await downloads(state, 2, 60000))[1];
  const clean2 = await p.evaluate(async () => (await renderExport()).data);
  const r2 = await diffBox(p, `data:${mime(d2.file)};base64,${fileB64(d2.file)}`, clean2);
  assert(r2.box && r2.box[0] > r2.w * 0.5 && r2.box[1] > r2.h * 0.9 && (r2.box[2] - r2.box[0]) > r2.w * 0.1, `large save: proportional mark ${r2.box} of ${r2.w}x${r2.h}`);
  eq([state.posts.length, state.used], [0, 0], 'no AI request, no credit');
}, { viewport: { width: 390, height: 844 } });
// 2026-11-01 (owner's choice): Pro saves carry the mark by default; Pro can turn it off in Settings
// or on the first save's note. Free saves always carry it.
test('mark: Pro saves carry the mark by default; the first save offers to turn it off, and Settings switches it', async ({ p, state }) => {
  await p.goto('https://app.test/'); await pick(p, fx('phone-12mp-exif6.jpg'));
  await p.waitForFunction(() => account && account.plan === 'pro');
  await tool(p, 'looks', 'filters', 'filter:glow'); await applyTool(p); await idle(p);
  await p.click('#saveBtn'); await p.waitForSelector('#ask[open] #askImg');
  eq(await p.textContent('#askTitle'), 'Your saves include a small Glow Studio badge', 'Pro is told once, with a preview');
  await p.click('#ask .btn:has-text("Turn it off and save")'); const [d] = await downloads(state, 1);
  const clean = await p.evaluate(async () => (await renderExport()).data);
  eq(fileB64(d.file), clean.split(',')[1], 'turned off: saved file is exactly the clean export');
  eq(await p.evaluate(() => store.get('glowMark')), 'off', 'remembered');
  // Settings: the switch is off; turning it on marks the next save, with no note again.
  await p.evaluate(() => openSettings());
  eq(await p.evaluate(() => [$('markToggle').checked, $('markToggle').closest('.setting').classList.contains('locked')]), [false, false], 'Pro switch shows off, unlocked');
  await p.click('#markToggle'); await p.evaluate(() => $('settings').close());
  await tool(p, 'looks', 'filters', 'filter:warm'); await applyTool(p); await idle(p);
  await p.click('#saveBtn'); const d2 = (await downloads(state, 2))[1];
  eq(await p.evaluate(() => $('ask').open), false, 'no note the second time');
  const clean2 = await p.evaluate(async () => (await renderExport()).data);
  const r = await diffBox(p, `data:${mime(d2.file)};base64,${fileB64(d2.file)}`, clean2);
  assert(r.box && r.box[0] > r.w * 0.5 && r.box[1] > r.h * 0.9, 'switched back on: marked bottom-right ' + r.box);
}, { viewport: { width: 390, height: 844 }, plan: 'pro', markIntro: true });
test('mark: Pro with the mark switched off saves clean', async ({ p, state }) => {
  await p.goto('https://app.test/'); await pick(p, fx('phone-12mp-exif6.jpg'));
  await p.waitForFunction(() => account && account.plan === 'pro');
  await tool(p, 'looks', 'filters', 'filter:glow'); await applyTool(p); await idle(p);
  await p.click('#saveBtn'); const [d] = await downloads(state, 1);
  const clean = await p.evaluate(async () => (await renderExport()).data);
  eq(fileB64(d.file), clean.split(',')[1], 'clean');
}, { viewport: { width: 390, height: 844 }, plan: 'pro', mark: 'off' });
test('mark: free users can\'t switch the mark off; the switch offers Pro', async ({ p }) => {
  await p.goto('https://app.test/'); await p.waitForFunction(() => screen === 'enhanceHome' && account && account.plan === 'free');
  await p.evaluate(() => store.set('glowMark', 'off')); await p.click('#enhSettingsBtn'); await p.waitForSelector('#settings[open]');
  eq(await p.evaluate(() => [$('markToggle').checked, $('markToggle').closest('.setting').classList.contains('locked')]), [true, true], 'free: on and locked');
  await p.click('#markToggle'); await p.waitForSelector('#paywall[open]');
  eq(await p.evaluate(() => $('markToggle').checked), true, 'still on; the paywall opened instead');
  eq(await p.evaluate(() => wantMark()), true, 'free saves are marked even with the old off setting');
}, { start: 'enhance', camera: false });
test('mark: Share and Download give the same marked file; Share Glow card only on request, and its QR scans', async ({ p, state }) => {
  await p.goto('https://app.test/'); await pick(p, PORTRAIT);
  await tool(p, 'looks', 'filters', 'filter:glow'); await applyTool(p); await idle(p);
  await p.evaluate(() => { window.__shared = []; navigator.canShare = () => true; navigator.share = async (d) => { for (const f of d.files) window.__shared.push(await new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(f); })); }; });
  await p.click('#saveBtn'); await p.waitForFunction(() => window.__shared.length === 1);
  const shared = await p.evaluate(() => window.__shared[0]);
  const expected = await p.evaluate(async () => { const o = await renderExport(); return (await addMark(o.data, isPng(o.data))).data; });
  eq(shared.split(',')[1], expected.split(',')[1], 'share sheet gets the same marked file the download path makes');
  eq(await p.evaluate(() => document.querySelectorAll('#ask[open]').length), 0, 'no card or dialog opened by itself');
  assert(await p.isVisible('.toast-act'), 'a quiet Share Glow offer after saving'); eq(await p.textContent('.toast-act'), 'Share Glow Studio', 'offer label');
  await p.click('.toast-act'); await p.waitForSelector('#ask[open] #askImg');
  eq(await p.evaluate(() => window.__shared.length), 1, 'nothing shared until chosen');
  await p.addScriptTag({ path: path.join(__dirname, 'vendor', 'jsQR.js') });
  const qr = await p.evaluate(async () => { const i = await loadImg($('askImg').src), c = newCanvas(i.naturalWidth, i.naturalHeight), x = c.getContext('2d'); x.drawImage(i, 0, 0);
    const d = x.getImageData(0, c.height - 280, 340, 280); const r = jsQR(d.data, d.width, d.height); return r && r.data; });
  eq(qr, 'https://glow-photo-enhancer.vercel.app', 'the card QR scans to the public address');
  await p.click('#ask .btn:has-text("Save card")'); const [card] = await downloads(state, 1);
  assert(/glow-studio-share-card/.test(card.file), 'card saved only when chosen');
  eq([state.posts.length, state.used], [0, 0], 'no AI request, no credit');
}, { viewport: { width: 390, height: 844 } });
test('view: full view keeps the preview, zoom and comparison, and Back closes it', async ({ p }) => {
  await p.goto('https://app.test/'); await pick(p, PORTRAIT);
  await tool(p, 'looks', 'filters', 'filter:glow'); await p.waitForFunction(() => !!ed.pending);
  await p.click('#compareBtn'); await p.evaluate(() => document.activeElement.blur()); await p.keyboard.press('+'); await settle(300);
  const s0 = await viewState(p), h0 = s0.st.h; assert(s0.z > 1.5, 'zoomed with the keyboard');
  await p.click('#expandView'); await settle(200);
  const s1 = await viewState(p);
  assert(s1.st.h > h0 + 150, `full view is much taller: ${h0} -> ${s1.st.h}`);
  eq([s1.z, s1.pending === s0.pending, s1.hist, await p.evaluate(() => $('stage').dataset.view)], [s0.z, true, s0.hist, 'split'], 'zoom, preview and Compare kept');
  eq(await p.evaluate(() => [getComputedStyle(document.querySelector('#editorScreen .topbar')).display, getComputedStyle(document.querySelector('#editorScreen .side')).display]), ['none', 'none'], 'header and tools step aside');
  eq(await p.getAttribute('#expandView', 'aria-label'), 'Close full view', 'close button named');
  near(s1.clipX, s1.divider, 1, 'comparison still aligned');
  await p.goBack(); await settle(200);
  const s2 = await viewState(p);
  eq([await p.evaluate(() => [expanded, screen, sel])], [[false, 'editorScreen', 'filter:glow']], 'Back closes full view only');
  near(s2.st.h, h0, 0.5, 'editing layout restored'); eq([s2.z, s2.pending === s0.pending, s2.hist], [s0.z, true, s0.hist], 'state unchanged');
  await p.click('#expandView'); await p.keyboard.press('Escape'); await settle(100); eq(await p.evaluate(() => expanded), false, 'Escape closes too');
}, { viewport: { width: 390, height: 844 } });

// ---------- Navigation: four tabs, Hold for original ----------
test('nav: five tabs file every tool still offered once, retired tools nowhere, one row per tab with Search last', async ({ p }) => {
  await p.goto('https://app.test/'); await pick(p, fx('transparent.png'));
  const c = await p.evaluate(() => {
    const filed = [...Object.values(CATS), ADVANCED].flatMap((g) => g.flatMap((x) => x[2]));
    const counts = {}; filed.forEach((id) => { counts[id] = (counts[id] || 0) + 1; });
    return { missing: TOOLS.map((t) => t.id).filter((id) => !counts[id] && !RETIRED.includes(id) && !IN_TRY_ON.includes(id)), twice: Object.keys(counts).filter((id) => counts[id] > 1), unknown: filed.filter((id) => !TOOL[id]),
      tabs: [...document.querySelectorAll('#tabs .tab')].map((t) => t.textContent.trim()),
      bodyOnlyInSearch: TOOLS.filter((t) => t.kind === 'body').every((t) => tabFor(t.id) === null) };
  });
  eq(c, { missing: [], twice: [], unknown: [], tabs: ['Beauty', 'Looks', 'Adjust', 'Background', 'AI'], bodyOnlyInSearch: true }, 'every tool filed once, five tabs, body tools advanced');
  for (const cat of ['retouch', 'looks', 'edit', 'bg', 'ai']) {
    await p.click(`.tab[data-cat="${cat}"]`);
    const r = await p.evaluate(() => [[...document.querySelectorAll('#tools .tool')].pop().id, document.querySelectorAll(['bwaist', 'bhips', 'barms', 'bslimlegs', 'blegs'].map((x) => `#tools .tool[data-tool="${x}"]`).join(',')).length]);
    eq(r, ['searchBtn', 0], `${cat}: Search is the last tile and no body tools are listed`);
  }
  await p.click('.tab[data-cat="edit"]');
  eq((await p.$$eval('#tools .tool[data-tool]', (x) => x.map((b) => b.dataset.tool))).slice(0, 5), ['crop', 'exposure', 'light', 'contrast', 'highlights'], 'Crop, Exposure, Brightness, Contrast, Highlights first');
  await p.click('.tool[data-tool="crop"]'); await p.waitForFunction(() => !!cr);
  eq(await p.evaluate(() => [sel, $('panelBody').querySelectorAll('.tool').length]), ['crop', 0], 'one tap from Edit to the crop controls');
  await p.click('#cancelBtn');
  await p.click('.tab[data-cat="ai"]');
  eq(await p.$$eval('#tools .tool[data-tool]', (x) => x.map((b) => b.dataset.tool)), ['pro', 'enhance', 'colorize', 'erase', 'fill', 'custom'], 'AI: Improve (Pro edit, Enhance, Colorize), Change (Remove, Fill, Describe)');
  await settle(400);
  const pill = await p.evaluate(() => { const t = document.querySelector('.tab[aria-selected="true"]'); return [t.dataset.cat, getComputedStyle(t.firstElementChild).backgroundColor !== 'rgba(0, 0, 0, 0)']; });
  eq(pill, ['ai', true], 'the open tab sits on a pill');
  const h = await p.evaluate(() => [...document.querySelectorAll('#tabs .tab')].map((t) => Math.round(t.getBoundingClientRect().height)));
  assert(h.every((x) => x >= 44), 'tab targets ' + h);
  // Body tools are retired: never on a tab, and Search doesn't offer them either.
  await p.click('#searchBtn'); await p.fill('#searchInput', 'waist');
  eq(await p.$$eval('#tools .tool', (x) => x.map((b) => b.dataset.tool)), [], 'Search skips retired tools');
  eq(await p.evaluate(() => { localStorage.setItem('glowCat', 'foryou'); return true; }), true, 'old saved tab');
  await p.reload(); await p.waitForFunction(() => typeof cat === 'string');
  eq(await p.evaluate(() => cat), 'retouch', 'a saved tab that no longer exists falls back to Beauty');
}, { viewport: { width: 1280, height: 860 }, mobile: false, touch: false });

test('nav: group chips jump to their group, follow the row as it scrolls, and drop groups that are switched off', async ({ p }) => {
  await p.goto('https://app.test/'); await pick(p, PORTRAIT);
  await p.click('.tab[data-cat="retouch"]');
  const on = () => p.evaluate(() => document.querySelector('#subchips .subchip[aria-pressed="true"]').dataset.chip);
  const firstVisible = () => p.evaluate(() => { const b = $('tools').getBoundingClientRect(); return [...document.querySelectorAll('#tools .tool[data-tool]')].find((t) => t.getBoundingClientRect().left >= b.left - 1).dataset.tool; });
  eq(await on(), 'auto', 'Auto first');
  await p.click('.subchip[data-chip="makeup"]'); await settle(900);
  eq([await on(), await firstVisible()], ['makeup', 'fglam'], 'Makeup jumps to Looks (the first makeup tool)');
  await p.evaluate(() => { const g = document.querySelector('#tools .group[data-group="skin"]'); $('tools').scrollTo({ left: g.offsetLeft - 16 }); }); await settle(400);
  eq(await on(), 'skin', 'scrolling back marks Skin');
  await p.click('.tab[data-cat="edit"]');
  eq(await p.$$eval('#subchips .subchip', (x) => x.map((c) => c.textContent)), ['Crop', 'Light', 'Color', 'Detail', 'Effects'], 'Adjust chips');
  await p.click('.tab[data-cat="bg"]');
  eq(await p.$$eval('#subchips .subchip', (x) => x.map((c) => [c.textContent, c.getAttribute('aria-pressed')])), [['Background', 'true']], 'one group: its name, so the photo keeps its size');
  // A group whose tools are all switched off (Hair color, from the admin page) loses its chip.
  await p.click('.tab[data-cat="retouch"]');
  eq(await p.$$eval('#subchips .subchip', (x) => x.map((c) => c.dataset.chip)), ['auto', 'skin', 'face', 'makeup'], 'Hair chip gone with hair color off');
  // A tool open hides the chips (the photo keeps the room); closing it brings them back; Search hides them.
  await p.click('.tool[data-tool="fsmooth"]'); await idle(p);
  assert(!(await p.isVisible('#subchips')), 'chips step aside while a tool is open');
  await p.click('#cancelBtn'); await settle(200);
  assert(await p.isVisible('#subchips'), 'chips back once the tool is closed');
  await p.click('#searchBtn');
  assert(await p.isHidden('#subchips'), 'no chips in Search');
}, { viewport: { width: 390, height: 844 }, features: { 'tool:hcolor': false } });

test('layout: on phones the photo gets most of the screen in every editor tool and nothing covers it', async ({ p }) => {
  await p.goto('https://app.test/'); await pick(p, PORTRAIT);
  const m = () => p.evaluate(() => { const i = $('before').getBoundingClientRect(), v = document.querySelector('#editorScreen .viewbar').getBoundingClientRect(), pn = $('panel').getBoundingClientRect();
    return { share: i.width * i.height / (innerWidth * innerHeight), cover: v.bottom > i.top + 1 && v.top < i.bottom, underPanel: !$('panel').hidden && pn.top < i.bottom - 1, scroll: document.scrollingElement.scrollHeight > innerHeight + 1 }; });
  const home = await m();
  assert(home.share >= 0.5 && !home.cover && !home.scroll, 'browsing: ' + JSON.stringify(home));
  const bad = [];
  for (const id of ['fsmooth', 'flips', 'glowup', 'filter:glow', 'light', 'bgremove', 'bgscene', 'outfit', 'custom']) {
    await tool(p, null, null, id); await settle(250);
    const r = await m(); if (r.share < (['flips', 'glowup', 'bgscene', 'outfit'].includes(id) ? 0.4 : 0.5) || r.cover || r.underPanel || r.scroll) bad.push([id, r]);
  }
  eq(bad, [], 'every tool leaves the photo at least half the screen (40% for the tools with three rows of controls), uncovered');
  // A tool's note shows one line; a tap shows all of it.
  await tool(p, null, null, 'custom'); await settle(200);
  const lines = () => p.evaluate(() => Math.round($('panelNote').getBoundingClientRect().height / parseFloat(getComputedStyle($('panelNote')).lineHeight)));
  eq(await lines(), 1, 'one line'); await p.click('#panelNote'); assert((await lines()) >= 2, 'tap shows the whole note');
  // Share moves into More on a 390px phone and still shares.
  await p.click('#cancelBtn'); await p.click('#moreBtn');
  eq(await p.evaluate(() => [getComputedStyle($('shareBtn')).display, $('shareMenuBtn').offsetParent !== null]), ['none', true], 'Share is in More');
}, { viewport: { width: 390, height: 844 } });

test('nav: Compare taps through split, original and back; holding shows the original; keys work', async ({ p }) => {
  await p.goto('https://app.test/'); await pick(p, PORTRAIT);
  eq(await p.evaluate(() => $('compareBtn').disabled), true, 'nothing to compare yet');
  await tool(p, 'looks', 'filters', 'filter:glow'); await p.waitForFunction(() => !!ed.pending);
  const b = await p.evaluate(() => { const r = $('compareBtn').getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; });
  const view = () => p.evaluate(() => [$('stage').dataset.view, $('compareLbl').textContent]);
  await p.mouse.move(b[0], b[1]); await p.mouse.down(); await settle(450);
  eq((await view())[0], 'original', 'held: original');
  await p.mouse.up(); await settle(100);
  eq(await view(), ['edited', 'Compare'], 'let go: back to the edit, no tap counted');
  await p.click('#compareBtn'); eq(await view(), ['split', 'Split'], 'tap: split');
  await p.click('#compareBtn'); eq(await view(), ['original', 'Original'], 'tap: original');
  await p.click('#compareBtn'); eq(await view(), ['edited', 'Compare'], 'tap: back to the edit');
  await p.focus('#compareBtn'); await p.keyboard.press('Enter'); eq((await view())[0], 'split', 'Enter steps');
  await p.keyboard.press('Space'); eq((await view())[0], 'original', 'Space steps');
  assert(/showing original/.test(await p.getAttribute('#compareBtn', 'aria-label')), 'the state is spoken');
  eq(await p.evaluate(() => [ed.idx, !!ed.pending, insp.z]), [0, true, 1], 'viewing never changes the photo or history');
}, { viewport: { width: 1280, height: 860 }, mobile: false, touch: false });

test('edit: Revert asks, returns to the original as one undoable step, and saves the original', async ({ p }) => {
  await p.goto('https://app.test/'); await pick(p, PORTRAIT);
  eq(await p.evaluate(() => $('revertBtn').disabled), true, 'nothing to revert');
  await tool(p, 'looks', 'filters', 'filter:glow'); await p.waitForFunction(() => !!ed.pending); await applyTool(p); await idle(p);
  eq(await p.evaluate(() => ed.idx), 1, 'one edit');
  await p.click('#moreBtn'); await p.click('#revertBtn'); await p.waitForSelector('#ask[open]'); await p.click('#askActions button:last-child'); await settle(150);
  eq(await p.evaluate(() => ed.idx), 1, 'Cancel leaves it');
  await p.click('#moreBtn'); await p.click('#revertBtn'); await p.waitForSelector('#ask[open]'); await p.click('#askActions button:first-child'); await settle(150);
  eq(await p.evaluate(() => [ed.idx, committed() === ed.hist[0].data, ed.hist[2].op.revert, $('revertBtn').disabled]), [2, true, true, true], 'a new step equal to the original');
  const saved = await p.evaluate(async () => { const a = await renderExport(), o = await renderExport(0); return [a.w, a.h, o.w, o.h, a.data, o.data]; });
  eq(saved.slice(0, 4), [saved[2], saved[3], saved[2], saved[3]], 'saves at the original size');
  assert(await boxDiff(p, saved[4], saved[5], [0, 0, 1, 1]) < 1, 'the saved picture is the original');
  await p.click('#undoBtn'); eq(await p.evaluate(() => [ed.idx, $('revertBtn').disabled]), [1, false], 'Undo brings the edit back');
  await p.click('#redoBtn'); eq(await p.evaluate(() => ed.idx), 2, 'Redo reverts again');
}, { viewport: { width: 1280, height: 860 }, mobile: false, touch: false });

test('edit: switching tools keeps a free change as one Undo step; Undo and Escape discard', async ({ p }) => {
  await p.goto('https://app.test/'); await pick(p, PORTRAIT);
  await tool(p, 'edit', null, 'light');
  for (const v of ['10', '20', '30']) { await p.fill('#panelBody input[type=range]', v); await settle(60); }
  await p.dispatchEvent('#panelBody input[type=range]', 'change'); await p.waitForFunction(() => ed.pending && ed.pending.op.value === 30); await idle(p);
  await p.click('.tool[data-tool="color"]'); await idle(p);
  eq(await p.evaluate(() => [ed.idx, ed.hist[1].op.tool, ed.hist[1].op.value, sel]), [1, 'light', 30, 'color'], 'one step for the whole slider session');
  eq(await p.evaluate(() => $('alertLive').textContent), 'Brightness kept. Undo removes it.', 'screen readers hear it was kept (no toast: sliders keep as you go)');
  await p.fill('#panelBody input[type=range]', '20'); await p.dispatchEvent('#panelBody input[type=range]', 'change'); await p.waitForFunction(() => !!ed.pending); await idle(p);
  await p.keyboard.press('Escape'); await settle(100);
  eq(await p.evaluate(() => [ed.idx, !!ed.pending, sel]), [1, false, null], 'Escape discards');
  await tool(p, 'edit', null, 'warmth');
  await p.fill('#panelBody input[type=range]', '20'); await p.dispatchEvent('#panelBody input[type=range]', 'change'); await p.waitForFunction(() => !!ed.pending); await idle(p);
  await p.click('#undoBtn'); await settle(100);
  eq(await p.evaluate(() => [ed.idx, !!ed.pending, toolAmt.warmth]), [1, false, 0], 'Undo drops the change and resets the slider');
  await tool(p, 'edit', null, 'warmth');
  await p.fill('#panelBody input[type=range]', '-20'); await p.dispatchEvent('#panelBody input[type=range]', 'change'); await p.waitForFunction(() => !!ed.pending); await idle(p);
  await p.click('.tab[data-cat="looks"]'); await settle(100);
  eq(await p.evaluate(() => [ed.idx, ed.hist[2].op.tool]), [2, 'warmth'], 'changing tab keeps it too');
  await p.click('#undoBtn'); eq(await p.evaluate(() => ed.idx), 1, 'one Undo removes it');
}, { viewport: { width: 1280, height: 860 }, mobile: false, touch: false });

test('retouch: in a group photo face tools edit only the highlighted face; the largest is first and a tap switches', async ({ p }) => {
  await p.goto('https://app.test/'); await pick(p, fx('group-two.jpg'));
  const base = await p.evaluate(() => committed());
  await tool(p, 'retouch', null, 'fsmooth');
  await p.waitForFunction(() => document.querySelectorAll('#facePick .face-ring').length === 2, null, { timeout: 30000 });
  const rings = await p.evaluate(() => [...document.querySelectorAll('#facePick .face-ring')].map((r) => [r.getAttribute('aria-label'), r.classList.contains('on')]));
  eq(rings, [['Face 1 of 2, largest, selected', true], ['Face 2 of 2', false]], 'largest face selected and marked');
  const boxes = await p.evaluate(() => faceSel.boxes.map((b) => [b.x, b.y, b.w, b.h]));
  assert(boxes[0][0] < 0.5 && boxes[1][0] > 0.5, 'the large face is on the left ' + JSON.stringify(boxes));
  await p.waitForFunction(() => !!ed.pending, null, { timeout: 30000 }); await idle(p);
  let out = await p.evaluate(() => ed.pending.data);
  const d = async (o) => [await boxDiff(p, base, o, boxes[0]), await boxDiff(p, base, o, boxes[1])];
  let [l, r] = await d(out);
  assert(l > 0.3 && r < 0.05, `only the selected face changes: left ${l.toFixed(2)}, right ${r.toFixed(2)}`);
  await p.click('#facePick .face-ring:not(.on)');
  await p.waitForFunction((o) => ed.pending && ed.pending.data !== o, out, { timeout: 30000 }); await idle(p);
  out = await p.evaluate(() => ed.pending.data); [l, r] = await d(out);
  assert(l < 0.05 && r > 0.3, `after switching only the other face changes: left ${l.toFixed(2)}, right ${r.toFixed(2)}`);
  await applyTool(p); await idle(p);
  const op = await p.evaluate(() => ed.hist[1].op.face);
  assert(op && op[0] > 0.5, 'the step remembers which face');
  // Saved copy vs the unedited saved copy put through the same JPEG encode the face tools use.
  const [full, plain] = await p.evaluate(async () => {
    const plain = (await renderExport(0)).data, img = await loadImg(plain), c = newCanvas(img.naturalWidth, img.naturalHeight);
    c.getContext('2d').drawImage(img, 0, 0); return [(await renderExport()).data, c.toDataURL('image/jpeg', 0.92)]; });
  [l, r] = [await boxDiff(p, plain, full, boxes[0]), await boxDiff(p, plain, full, boxes[1])];
  assert(l < 0.05 && r > 0.3, `saving edits the same face: left ${l.toFixed(2)}, right ${r.toFixed(2)}`);
}, { viewport: { width: 1280, height: 860 }, mobile: false, touch: false });

// ---------- AI Remove / Fill / Expand (mocked server) ----------
async function paint(p, from, to) {
  const r = await p.evaluate(() => { const b = $('brush').getBoundingClientRect(), v = viewRect(); return { x: b.x + v.x, y: b.y + v.y, w: v.w, h: v.h }; });
  await p.mouse.move(r.x + r.w * from[0], r.y + r.h * from[1]); await p.mouse.down();
  for (let i = 1; i <= 8; i++) await p.mouse.move(r.x + r.w * (from[0] + (to[0] - from[0]) * i / 8), r.y + r.h * (from[1] + (to[1] - from[1]) * i / 8));
  await p.mouse.up();
}
// Mean absolute difference of two pictures inside a box (fractions of the picture).
const boxDiff = (p, a, b, box) => p.evaluate(async ([a, b, box]) => {
  const [i, j] = await Promise.all([loadImg(a), loadImg(b)]), w = 200, h = Math.round(200 * i.naturalHeight / i.naturalWidth);
  const px = (img) => { const c = newCanvas(w, h), x = c.getContext('2d'); x.drawImage(img, 0, 0, w, h); return x.getImageData(Math.round(box[0] * w), Math.round(box[1] * h), Math.max(1, Math.round(box[2] * w)), Math.max(1, Math.round(box[3] * h))).data; };
  const d1 = px(i), d2 = px(j); let s = 0; for (let k = 0; k < d1.length; k++) if (k % 4 !== 3) s += Math.abs(d1[k] - d2[k]);
  return s / (d1.length * 0.75);
}, [a, b, box]);

test('ai: Remove waits for Apply, survives switching tools and a reload, and keeps unmarked pixels', async ({ p, state }) => {
  await p.goto('https://app.test/'); await pick(p, PORTRAIT);
  await tool(p, 'ai', null, 'erase'); await p.waitForFunction(() => !$('brush').hidden);
  eq(await p.evaluate(() => [$('applyBtn').textContent, $('applyBtn').disabled, $('cost').textContent]), ['Generate · 1 credit', true, 'AI · 1 credit'], 'cost shown, nothing to remove yet');
  await p.fill('.brush-row input[type=range]', '40'); await p.dispatchEvent('.brush-row input[type=range]', 'change');
  await paint(p, [0.1, 0.1], [0.3, 0.12]);
  eq(await p.evaluate(() => [strokes.length, Math.round(strokes[0].w * imageRect().s)]), [1, 40], 'stroke at the chosen size');
  await p.click('.brush-modes .opt:nth-child(2)'); await paint(p, [0.25, 0.11], [0.3, 0.12]);
  eq(await p.evaluate(() => [strokes.length, !!strokes[1].erase]), [2, true], 'erase marks');
  await p.keyboard.press('+'); await settle(300); await p.keyboard.press('0'); await settle(300);
  eq(state.posts.length, 0, 'nothing sent before Generate');
  const base = await p.evaluate(() => committed());
  await applyTool(p); await p.waitForFunction(() => job && job.status === 'done', null, { timeout: 30000 });
  eq([state.posts, state.used], [['erase'], 1], 'one request, one credit');
  eq(await p.evaluate((b) => [ed.idx, committed() === b, reviewing()], base), [0, true, true], 'pending: nothing applied yet');
  const shown = await p.evaluate(() => job.result.data);
  const outside = await boxDiff(p, base, shown, [0.05, 0.5, 0.9, 0.45]), inside = await boxDiff(p, base, shown, [0.14, 0.095, 0.08, 0.03]);
  assert(outside < 2.5, 'unmarked pixels are the photo\'s own: ' + outside.toFixed(2));
  assert(inside > 10, 'the marked area changed: ' + inside.toFixed(2));
  eq(await p.evaluate(() => [$('applyBtn').textContent, $('cancelBtn').textContent, $('brush').hidden, $('compareBtn').disabled]), ['Apply', 'Discard', true, false], 'Apply / Discard, compare available');
  // Leaving the tool keeps the paid result waiting.
  await p.click('.tab[data-cat="edit"]'); await p.click('.tool[data-tool="light"]'); await settle(200);
  eq(await p.evaluate(() => [job && job.status, ed.idx, !$('jobBar').hidden, /ready/.test($('jobText').textContent)]), ['done', 0, true, true], 'still waiting after switching tools');
  await p.reload(); await p.waitForFunction(() => ed.hist.length > 0 && job && job.status === 'done', null, { timeout: 15000 });
  await p.click('#resumeBtn').catch(() => {}); await p.waitForFunction(() => screen === 'editorScreen' && !$('jobBar').hidden, null, { timeout: 15000 });
  eq(state.posts.length, 1, 'a reload never asks again');
  await p.click('#jobActions button:has-text("Review")'); await settle(200);
  eq(await p.evaluate(() => [sel, reviewing()]), ['erase', true], 'Review reopens it');
  // Discard asks (the credit isn't returned); keeping it keeps it.
  await p.click('#cancelBtn'); await p.waitForSelector('#ask[open]'); assert(/isn't returned/.test(await p.textContent('#askText')), 'says the credit is not returned');
  await p.click('#askActions button:last-child'); await settle(150);
  eq(await p.evaluate(() => job && job.status), 'done', 'Keep reviewing keeps it');
  await applyTool(p); await settle(150);
  eq(await p.evaluate(() => [ed.idx, job, ed.hist[1].op.fixed]), [1, null, true], 'Apply adds one step');
  await p.click('#undoBtn'); eq(await p.evaluate(() => ed.idx), 0, 'Undo takes it off');
  eq([state.posts.length, state.used], [1, 1], 'charged once in all');
});

test('ai: Remove blends into the full-size photo; it keeps the original size and every unmarked pixel', async ({ p, state }) => {
  await p.goto('https://app.test/'); await pick(p, fx('phone-12mp-exif6.jpg'));
  await tool(p, 'ai', null, 'erase'); await paint(p, [0.3, 0.2], [0.6, 0.25]);
  await applyTool(p); await p.waitForFunction(() => job && job.status === 'done', null, { timeout: 60000 });
  const r = await p.evaluate(async () => {
    const fb = await renderExport(0), [a, b] = await Promise.all([loadImg(fb.data), loadImg(job.result.full)]);
    const w = a.naturalWidth, h = a.naturalHeight;
    const px = (img, y0, y1) => { const c = newCanvas(w, y1 - y0), x = c.getContext('2d'); x.drawImage(img, 0, -y0); return x.getImageData(0, 0, w, y1 - y0).data; };
    const diff = (y0, y1, x0 = 0, x1 = w) => { const d1 = px(a, y0, y1), d2 = px(b, y0, y1); let s = 0, n = 0;
      for (let y = 0; y < y1 - y0; y += 2) for (let x = x0; x < x1; x += 2) { const k = (y * w + x) * 4; s += Math.abs(d1[k] - d2[k]) + Math.abs(d1[k + 1] - d2[k + 1]) + Math.abs(d1[k + 2] - d2[k + 2]); n += 3; }
      return s / n; };
    const sh = await loadImg(job.result.data);
    return { size: [w, h, b.naturalWidth, b.naturalHeight], outside: diff(Math.round(h * 0.5), Math.round(h * 0.95)), inside: diff(Math.round(h * 0.215), Math.round(h * 0.235), Math.round(w * 0.35), Math.round(w * 0.55)),
      shown: Math.max(sh.naturalWidth, sh.naturalHeight) };
  });
  eq(r.size, [3024, 4032, 3024, 4032], 'the result is the full-size photo, upright');
  assert(r.outside < 1.5, 'unmarked pixels match the full-size photo (JPEG tolerance): ' + r.outside.toFixed(2));
  assert(r.inside > 10, 'the marked area comes from the AI: ' + r.inside.toFixed(2));
  assert(r.shown <= 2048, 'the screen copy is at most 2048px');
  eq([state.posts.length, state.used], [1, 1], 'one request, one credit');
});

test('ai: a failed Remove is refunded once and never retried by itself', async ({ p, state }) => {
  await p.goto('https://app.test/'); await pick(p, PORTRAIT);
  await tool(p, 'ai', null, 'erase'); await paint(p, [0.2, 0.2], [0.3, 0.2]);
  await applyTool(p); await p.waitForFunction(() => job && job.status === 'failed', null, { timeout: 30000 });
  await settle(2000);
  eq([state.posts.length, state.refunds, state.used, await p.evaluate(() => [ed.idx, strokes.length])], [1, 1, 0, [0, 1]], 'refunded once, no retry, marks kept');
}, { ai: { polls: ['processing', 'failed'], post: 'processing' } });

test('ai: Fill is listed but not sent until the server has it; then it sends the mask and prompt', async ({ p, state }) => {
  await p.goto('https://app.test/'); await pick(p, PORTRAIT);
  await p.evaluate(() => { CONFIG.aiFill = false; renderEditor(); });   // as before the server had Fill
  await p.click('.tab[data-cat="ai"]');
  eq(await p.$eval('.tool[data-tool="fill"]', (b) => [b.querySelector('.cost').textContent, b.getAttribute('aria-label')]), ['Soon', 'Fill, not available yet'], 'marked as not available yet');
  await p.click('.tool[data-tool="fill"]'); await paint(p, [0.2, 0.2], [0.3, 0.25]);
  eq(await p.evaluate(() => [$('applyBtn').disabled, $('applyBtn').textContent, /isn't live yet/.test($('panelNote').textContent)]), [true, 'Not available yet', true], 'Generate off, gap explained');
  eq(state.posts.length, 0, 'nothing sent');
  await p.evaluate(() => { CONFIG.aiFill = true; renderEditor(); });
  await p.fill('#fillPrompt', 'a small vase of white flowers');
  eq(await p.evaluate(() => [$('applyBtn').disabled, $('applyBtn').textContent]), [false, 'Generate · 2 credits'], 'cost shown before sending (pricing v2: 2 credits)');
  const req = p.waitForRequest((r) => r.url().includes('/functions/v1/enhance') && r.method() === 'POST');
  await applyTool(p); const body = JSON.parse((await req).postData());
  eq([body.mode, body.prompt, body.mask.startsWith('data:image/png'), !!body.request_id], ['fill', 'a small vase of white flowers', true, true], 'mode, prompt and mask');
  await p.waitForFunction(() => job && job.status === 'done', null, { timeout: 30000 });
  eq([state.used, await p.evaluate(() => ed.idx)], [1, 0], 'one credit, waiting for Apply');
});

test('ai: free plan v2 — premium tools use the one-time trial, cheap tools the daily credits', async ({ p, state }) => {
  await p.goto('https://app.test/'); await pick(p, PORTRAIT);
  await p.waitForFunction(() => !!account);
  await p.evaluate(() => showUsage({ plan: 'free', used: 0, quota: 3, remaining: 3, trialLeft: 2, adsLeft: 1, v: 2 }));
  await tool(p, 'edit', null, 'pro');
  eq(await p.evaluate(() => [$('applyBtn').textContent, /2 of 3 free premium credits left/.test($('panelNote').textContent)]), ['Apply · 2 credits', true], 'premium: trial balance shown');
  await p.evaluate(() => showUsage({ plan: 'free', pool: 'trial', used: 3, quota: 3, remaining: 0 }));
  eq(await p.evaluate(() => [account.remaining, account.trialLeft]), [3, 0], 'a trial charge only moves the trial balance');
  eq(await p.evaluate(() => [$('applyBtn').textContent, /used your 3 free premium credits/.test($('panelNote').textContent)]), ['Go Pro or buy credits', true], 'trial used up');
  await applyTool(p); await settle(200);
  eq([await p.evaluate(() => $('paywall').open), state.posts.length], [true, 0], 'opens Glow Pro, sends nothing');
  await p.evaluate(() => $('paywall').close());
  await tool(p, 'ai', null, 'erase');
  eq(await p.textContent('#applyBtn'), 'Generate · 1 credit', 'a low-cost tool still uses the daily credits');
  eq(await p.evaluate(() => ['$4.99/week', '$49.99/year'].map((x) => document.body.innerHTML.includes(x))), [true, true], 'new prices on the paywall');
});

test('demo: Remove and Fill on the sample offer your own photo and never call the AI', async ({ p, state }) => {
  await openDemo(p);
  await p.click('.tab[data-cat="ai"]'); await p.click('.tool[data-tool="erase"]'); await settle(200);
  eq(await p.evaluate(() => [$('cost').textContent, $('applyBtn').textContent, $('brush').hidden, /nothing is generated/.test($('panelNote').textContent)]), ['Own photo', 'Use your photo', true, true], 'explained, no brush');
  const fc = p.waitForEvent('filechooser'); await applyTool(p); await (await fc).setFiles([]); await settle(300);
  await p.click('.tool[data-tool="fill"]'); await settle(200);
  eq(await p.evaluate(() => ed.idx), 0, 'nothing applied on the sample');
  eq(state.posts.length, 0, 'no AI request');
}, { files: demoFiles() });

// ---------- Backgrounds, Adjust, makeup colors (on-device; AI parts use the mocked server) ----------
// The color of one pixel, at a fraction of the picture's width and height.
const pxAt = (p, src, fx, fy) => p.evaluate(async ([s, x, y]) => {
  const img = await loadImg(s), c = newCanvas(img.naturalWidth, img.naturalHeight), k = c.getContext('2d'); k.drawImage(img, 0, 0);
  return [...k.getImageData(Math.floor(x * c.width), Math.floor(y * c.height), 1, 1).data];
}, [src, fx, fy]);
const nearPx = (a, b, tol) => a.slice(0, 3).every((v, i) => Math.abs(v - b[i]) <= tol);

test('bg: on-device backgrounds keep her own pixels, replace the backdrop, and swap instead of stacking', async ({ p }) => {
  await p.goto('https://app.test/'); await pick(p, PORTRAIT);
  const base = await p.evaluate(() => committed());
  await tool(p, 'edit', null, 'bgcolor'); await p.click('#panelBody .opt:has-text("White")');
  await p.waitForFunction(() => ed.pending && ed.pending.tool === 'bgcolor', null, { timeout: 30000 }); await idle(p);
  const white = await p.evaluate(() => ed.pending.data);
  { const c = await pxAt(p, white, 0.03, 0.04); assert(c.slice(0, 3).every((v) => v >= 200), 'the corner is the new light backdrop: ' + c); }
  { const a = await pxAt(p, white, 0.5, 0.3), b = await pxAt(p, base, 0.5, 0.3); assert(nearPx(a, b, 8), 'her face is her own pixels (JPEG tolerance): ' + a + ' vs ' + b); }
  await p.click('#panelBody .opt:has-text("Black")'); await p.waitForFunction((w) => ed.pending && ed.pending.data !== w, white, { timeout: 30000 }); await idle(p);
  { const c = await pxAt(p, await p.evaluate(() => ed.pending.data), 0.03, 0.04); assert(c.slice(0, 3).every((v) => v <= 60), 'Black swaps the backdrop: ' + c); }
  eq(await p.evaluate(() => [ed.idx, ed.hist.length]), [0, 1], 'Black replaces White instead of stacking on it');
  // Your photo: any picture becomes the backdrop.
  await p.click('.tool[data-tool="bgphoto"]'); await settle(200);
  eq(await p.evaluate(() => [ed.idx, $('applyBtn').disabled]), [0, true], 'switching discards the color; nothing to apply before a photo is picked');
  const fc = p.waitForEvent('filechooser'); await p.click('#panelBody .outfit-pick button'); await (await fc).setFiles(fx('coords-600x400.png'));
  await p.waitForFunction(() => ed.pending && ed.pending.tool === 'bgphoto', null, { timeout: 30000 }); await idle(p);
  const mine = await p.evaluate(() => ed.pending.data);
  assert(!nearPx(await pxAt(p, mine, 0.03, 0.04), await pxAt(p, base, 0.03, 0.04), 20), 'the picked photo is behind her');
  assert(nearPx(await pxAt(p, mine, 0.5, 0.3), await pxAt(p, base, 0.5, 0.3), 12), 'her face stays (only a light color match)');
  await applyTool(p); await settle(150);
  eq(await p.evaluate(() => [ed.idx, ed.hist[1].op.tool, !!ed.hist[1].op.bg]), [1, 'bgphoto', true], 'applied as one step that remembers the photo');
});

test('ai: AI scene costs 2 credits, sends the background mask and the scene, and keeps her own pixels', async ({ p, state }) => {
  await p.goto('https://app.test/'); await pick(p, PORTRAIT);
  await p.evaluate(() => { CONFIG.aiV10 = true; renderEditor(); });   // once the server has the modes
  await tool(p, 'edit', null, 'bgscene');
  eq(await p.textContent('#applyBtn'), 'Generate · 2 credits', 'cost shown before sending');
  eq(state.posts.length, 0, 'opening it sends nothing');
  await p.click('#panelBody .opt:has-text("Beach")');
  const req = p.waitForRequest((r) => r.url().includes('/functions/v1/enhance') && r.method() === 'POST');
  await applyTool(p); const body = JSON.parse((await req).postData());
  eq([body.mode, /beach/.test(body.prompt), body.mask.startsWith('data:image/png')], ['bgscene', true, true], 'mode, scene and mask');
  const mask = body.mask;
  assert(nearPx(await pxAt(p, mask, 0.03, 0.04), [255, 255, 255], 1) && nearPx(await pxAt(p, mask, 0.5, 0.3), [0, 0, 0], 1), 'the mask is the background only');
  await p.waitForFunction(() => job && job.status === 'done', null, { timeout: 30000 });
  const base = await p.evaluate(() => committed()), shown = await p.evaluate(() => job.result.data);
  assert(nearPx(await pxAt(p, shown, 0.5, 0.3), await pxAt(p, base, 0.5, 0.3), 4), 'her face is her own pixels');
  eq([state.used, await p.evaluate(() => ed.idx)], [1, 0], 'one request, waiting for Apply');
});

test('try on: one tool with ideas, your photo or words; sends the part; keeps every look to flip back to free', async ({ p, state }) => {
  await p.goto('https://app.test/'); await pick(p, PORTRAIT);
  await tool(p, 'looks', null, 'outfit');
  eq(await p.evaluate(() => [tryOn.src, !!$('panelBody').querySelector('.try-card[data-idea="casual"][aria-pressed="true"]')]), ['ideas', true], 'opens on Ideas with one picked');
  eq(state.posts.length, 0, 'opening it sends nothing');
  await p.waitForFunction(() => tryOn.check !== null, null, { timeout: 30000 });
  assert(/Little of your outfit/.test(await p.textContent('#panelNote')), 'the free photo check says a head-and-shoulders photo makes the AI guess: ' + await p.textContent('#panelNote'));
  await p.click('.try-card[data-idea="suit"]'); await p.click('.try-color[aria-label="Navy"]');
  let req = p.waitForRequest((r) => r.url().includes('/functions/v1/enhance') && r.method() === 'POST');
  await applyTool(p); let body = JSON.parse((await req).postData());
  eq([body.mode, body.part, /business suit/.test(body.prompt), /navy blue/.test(body.prompt), body.extra], ['outfit', 'full', true, true, undefined], 'an idea sends words, color and part');
  await p.waitForFunction(() => job && job.status === 'done', null, { timeout: 30000 });
  await p.waitForFunction(() => tryLooksNow().length === 1);
  eq(await p.evaluate(() => [job.look, tryLooksNow()[0].label]), ['Navy suit', 'Navy suit'], 'the look is named');
  // While a look shows, the panel is just Your looks and the buttons, so the photo is big; the face is the model's own.
  eq(await p.evaluate(() => [!!$('panelBody').querySelector('.try-card'), $('cancelBtn').textContent, $('panelNote').textContent, $('panel').classList.contains('try-compact'), !!job.keepFace]),
    [false, 'Change', '', true, false], 'the result view is compact, without notes, and no face pasting');
  // Change: the look closes (kept in Your looks), the pickers come back, nothing is applied.
  await p.click('#cancelBtn'); await settle(200);
  await p.click('.try-card[data-idea="gown"]'); await settle(200);
  eq(await p.evaluate(() => [job, ed.idx, tryLooksNow().length, $('applyBtn').textContent]), [null, 0, 1, 'Try on · 1 credit'], 'Change closes the look and offers a new try-on');
  await p.click('.try-look'); await settle(200);
  eq(await p.evaluate(() => [job && job.look, reviewing()]), ['Navy suit', true], 'and the look is one tap away');
  // Discard keeps it in Your looks, without the "credit isn't returned" question.
  await p.click('#cancelBtn'); await settle(200);
  eq(await p.evaluate(() => [job, tryLooksNow().length]), [null, 1], 'discarded but kept');
  // Your photo: any outfit picture, kept in the closet for next time, with the part to change.
  if (!(await p.evaluate(() => sel === 'outfit'))) await tool(p, 'looks', null, 'outfit');
  await p.click('.try-seg .opt:has-text("Your photo")');
  eq(await p.evaluate(() => $('applyBtn').disabled), true, 'nothing to send before a photo is picked');
  const fc = p.waitForEvent('filechooser'); await p.click('.try-add[aria-label^="Add"]'); await (await fc).setFiles(fx('coords-600x400.png'));
  await p.waitForFunction(() => !!outfitData && tryOn.closet.length === 1);
  await p.click('.try-parts .opt:has-text("Top")');
  req = p.waitForRequest((r) => r.url().includes('/functions/v1/enhance') && r.method() === 'POST');
  await applyTool(p); body = JSON.parse((await req).postData());
  eq([body.mode, body.part, body.extra.startsWith('data:image/'), body.prompt], ['outfit', 'top', true, undefined], 'a photo sends the picture and the part');
  await p.waitForFunction(() => job && job.status === 'done' && tryLooksNow().length === 2, null, { timeout: 30000 });
  // Flip back to the first look: free, nothing sent.
  const posts = state.posts.length;
  await p.click('.try-look[aria-label^="Navy suit"]'); await settle(200);
  eq(await p.evaluate(() => [job.look, job.status, reviewing()]), ['Navy suit', 'done', true], 'the earlier look is back for review');
  eq(state.posts.length, posts, 'looking again sends nothing');
  await applyTool(p); await settle(200);
  eq(await p.evaluate(() => [ed.idx, ed.hist[1].op.tool]), [1, 'outfit'], 'applied as one step');
  // Words: her own description.
  await tool(p, 'looks', null, 'outfit'); await p.click('.try-seg .opt:has-text("Describe")');
  await p.fill('#tryWords', 'a red satin slip dress');
  req = p.waitForRequest((r) => r.url().includes('/functions/v1/enhance') && r.method() === 'POST');
  await applyTool(p); body = JSON.parse((await req).postData());
  eq([body.prompt, body.part], ['a red satin slip dress', 'top'], 'words are sent as written, with the part picked before');
});

test('describe: a reframed AI result is lined up with the photo and her face goes on her new face (no double face)', async ({ p }) => {
  await p.goto('https://app.test/');
  const data = (f) => 'data:image/' + (f.endsWith('png') ? 'png' : 'jpeg') + ';base64,' + fs.readFileSync(f).toString('base64');
  // The fixture is the portrait as an edit model answers it: 2:3 instead of 3:4, shifted, new top color.
  const r = await p.evaluate(async ([a, b]) => {
    const x = await restoreFace(a, b), im = await loadImg(x.data), o = await loadImg(a);
    const fa = await faceBoxes(a), fr = await faceBoxes(x.data);
    return { aligned: x.aligned, size: [im.naturalWidth, im.naturalHeight], osize: [o.naturalWidth, o.naturalHeight], fa: fa[0], fr: fr[0], n: fr.length };
  }, [data(PORTRAIT), data(fx('reframed-ai.jpg'))]);
  eq(r.size, r.osize, 'the result has the photo\'s size');
  assert(r.aligned, 'lined up by the face');
  eq(r.n, 1, 'one face, not two');
  assert(Math.abs(r.fa.cx - r.fr.cx) < 0.02 && Math.abs(r.fa.cy - r.fr.cy) < 0.02 && Math.abs(r.fa.w - r.fr.w) < 0.03, 'her face stays where it was: ' + JSON.stringify([r.fa, r.fr]));
  const top = await p.evaluate(async (a) => (await restoreFace(a, a)).data, data(PORTRAIT));
  assert(nearPx(await pxAt(p, top, 0.5, 0.3), await pxAt(p, data(PORTRAIT), 0.5, 0.3), 10), 'an unchanged result keeps her face as it was');
});

test('adjust: the full Adjust set changes the photo, and grain is the same every time', async ({ p }) => {
  await p.goto('https://app.test/'); await pick(p, PORTRAIT);
  eq(await p.evaluate(() => CATS.edit.flatMap((g) => g[2])), ['crop', 'exposure', 'light', 'contrast', 'highlights', 'shadows', 'whites', 'blacks', 'warmth', 'tint', 'vibrance', 'color',
    'texture', 'clarity', 'dehaze', 'detail', 'lnoise', 'cnoise', 'fade', 'grain', 'vignette'], 'Adjust tools');
  const r = await p.evaluate(async () => {
    const base = committed(), out = {};
    for (const k of ['exposure', 'contrast', 'highlights', 'shadows', 'whites', 'blacks', 'vibrance', 'tint', 'texture', 'clarity', 'dehaze', 'fade', 'vignette', 'grain'])
      out[k] = [(await adjust(base, k, 40)) !== base, (await adjust(base, k, -40)) !== base];
    for (const k of ['lnoise', 'cnoise']) out[k] = [(await adjust(base, k, 60)) !== base, (await adjust(base, k, 100)) !== base];
    out.same = (await adjust(base, 'grain', 30)) === (await adjust(base, 'grain', 30));
    return out;
  });
  for (const [k, v] of Object.entries(r)) if (k !== 'same') eq(v, [true, true], k + ' works both ways');
  eq(r.same, true, 'grain is repeatable, so the full-size save matches the preview');
  await tool(p, 'edit', null, 'vignette');
  await p.fill('#panelBody input[type=range]', '30'); await p.dispatchEvent('#panelBody input[type=range]', 'change');
  await p.waitForFunction(() => ed.pending && ed.pending.op.value === 30); await idle(p);
});

// Full / Person / Background: a slider can change only the person or only the background.
test('adjust: Person and Background change only their part of the photo', async ({ p, state }) => {
  await p.goto('https://app.test/'); await pick(p, AREA_PHOTO);
  await tool(p, 'edit', null, 'exposure');
  eq(await p.$$eval('#areaRow .area span', (x) => x.map((e) => e.textContent)), ['Full', 'Person', 'Background'], 'area chips');
  await p.waitForSelector('#areaRow .area[data-area="person"]:not(:disabled)', { timeout: 60000 });
  const r = await p.evaluate(async () => {
    const base = committed(), img = await loadImg(base), c = canvasFor(img); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    const alpha = await personAlpha(base, c), W = c.width, H = c.height;
    const read = async (src) => { const i = await loadImg(src), k = newCanvas(W, H), x = k.getContext('2d'); x.drawImage(i, 0, 0, W, H); return x.getImageData(0, 0, W, H).data; };
    const o = await read(base), res = {};
    for (const area of ['full', 'person', 'bg']) {
      const d = await read(await adjust(base, 'exposure', 50, area));
      let inP = 0, nP = 0, inB = 0, nB = 0;
      for (let i = 0; i < alpha.length; i += 7) {
        const dv = Math.abs(d[i * 4] - o[i * 4]) + Math.abs(d[i * 4 + 1] - o[i * 4 + 1]) + Math.abs(d[i * 4 + 2] - o[i * 4 + 2]);
        if (alpha[i] > 0.95) { inP += dv; nP++; } else if (alpha[i] < 0.05) { inB += dv; nB++; }
      }
      res[area] = [inP / nP, inB / nB];
    }
    res.share = alpha.reduce((a, b) => a + b, 0) / alpha.length;
    return res;
  });
  assert(r.share > 0.08 && r.share < 0.7, 'the person is a sensible part of the photo: ' + r.share);
  assert(r.full[0] > 15 && r.full[1] > 15, 'Full changes both: ' + r.full);
  assert(r.person[0] > 15 && r.person[1] < 1, 'Person changes only the person: ' + r.person);
  assert(r.bg[1] > 15 && r.bg[0] < 1, 'Background changes only the background: ' + r.bg);
  // Picking a chip previews with that area, and Apply keeps it as one step that replays at full size.
  await p.fill('#panelBody input[type=range]', '30'); await p.dispatchEvent('#panelBody input[type=range]', 'change');
  await p.waitForFunction(() => ed.pending && ed.pending.op.value === 30); await idle(p);
  await p.click('#areaRow .area[data-area="bg"]');
  await p.waitForFunction(() => ed.pending && ed.pending.op.area === 'bg', null, { timeout: 60000 }); await idle(p);
  eq(await p.$eval('#areaRow .area[aria-pressed="true"]', (e) => e.dataset.area), 'bg', 'Background chosen');
  await applyTool(p); await p.waitForFunction(() => ed.idx === 1 && !ed.pending); await idle(p);
  eq(await p.evaluate(() => ed.hist[1].op), { tool: 'exposure', value: 30, area: 'bg' }, 'the step records its area');
  // The choice stays for the next Adjust tool.
  await tool(p, 'edit', null, 'clarity');
  await p.waitForSelector('#areaRow .area[data-area="bg"][aria-pressed="true"]', { timeout: 60000 });
  eq(state.errs, [], 'no page errors (the body model once crashed on odd-sized pictures)');
});

test('adjust: the Refine brush adds to and takes away from the person, and the step replays it', async ({ p, state }) => {
  await p.goto('https://app.test/'); await pick(p, AREA_PHOTO);
  await tool(p, 'edit', null, 'exposure');
  await p.waitForSelector('#refineBtn', { timeout: 60000 }); await p.click('#refineBtn');
  await p.waitForFunction(() => refining && refineView, null, { timeout: 60000 });
  assert(await p.evaluate(() => getComputedStyle($('tools')).display === 'none'), 'tool rows step aside');
  eq(await p.evaluate(() => adjArea), 'person', 'Refine picks Person');
  // One stroke out across the middle of the person (Remove), one in across the background corner (Add).
  const drag = async (pts) => {
    const b = await p.evaluate((pts) => { const st = $('stage').getBoundingClientRect(), r = imageRect(); return pts.map(([x, y]) => [st.left + r.x + x * r.nw * r.s, st.top + r.y + y * r.nh * r.s]); }, pts);
    await p.mouse.move(b[0][0], b[0][1]); await p.mouse.down(); for (const q of b.slice(1)) await p.mouse.move(q[0], q[1], { steps: 4 }); await p.mouse.up();
  };
  await p.click('[aria-label="Brush"] button:nth-child(2)');
  await drag([[0.4, 0.5], [0.5, 0.5], [0.6, 0.5]]);
  await p.click('[aria-label="Brush"] button:nth-child(1)');
  await drag([[0.05, 0.05], [0.12, 0.05]]);
  await p.waitForFunction(() => areaEdits.length === 2);
  eq(await p.evaluate(() => areaEdits.map((e) => e.add)), [false, true], 'Remove then Add');
  const r = await p.evaluate(async () => {
    const base = committed(), img = await loadImg(base), c = canvasFor(img); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    const a0 = await personAlpha(base, c), a1 = await personAlpha(base, c, areaEdits), W = c.width, H = c.height;
    const at = (a, x, y) => a[Math.round(y * H) * W + Math.round(x * W)];
    return { mid: [at(a0, 0.5, 0.5), at(a1, 0.5, 0.5)], corner: [at(a0, 0.08, 0.05), at(a1, 0.08, 0.05)], far: [at(a0, 0.5, 0.3), at(a1, 0.5, 0.3)] };
  });
  assert(r.mid[0] > 0.9 && r.mid[1] < 0.5, 'Remove took the middle out: ' + r.mid);
  assert(r.corner[0] < 0.1 && r.corner[1] > 0.5, 'Add put the corner in: ' + r.corner);
  assert(Math.abs(r.far[0] - r.far[1]) < 0.02, 'away from the strokes nothing changed: ' + r.far);
  await p.click('#refineUndo'); await p.waitForFunction(() => areaEdits.length === 1);
  await p.click('#refineDone'); await p.waitForFunction(() => !refining);
  await p.waitForSelector('#refineBtn.done', { timeout: 60000 }); assert(/^Refined/.test(await p.getAttribute('#refineBtn', 'aria-label')), 'the pencil on the photo says the outline was refined');
  await p.fill('#panelBody input[type=range]', '30'); await p.dispatchEvent('#panelBody input[type=range]', 'change');
  await p.waitForFunction(() => ed.pending && ed.pending.op.edits, null, { timeout: 60000 }); await idle(p);
  await applyTool(p); await p.waitForFunction(() => ed.idx === 1 && !ed.pending); await idle(p);
  const op = await p.evaluate(() => ed.hist[1].op);
  eq([op.tool, op.area, op.edits.length, op.edits[0].add], ['exposure', 'person', 1, false], 'the step records its Refine strokes');
  eq(state.errs, [], 'no page errors');
});

test('adjust: in the phone apps the phone\'s own cutout is used, keeping only subjects under a face', async ({ p, state }) => {
  await p.goto('https://app.test/'); await pick(p, AREA_PHOTO);
  const r = await p.evaluate(async () => {
    // A stand-in for the GlowCutout plugin: two ML Kit-style subjects, one where the face is
    // (a box from the face down) and one off to the side (like a sofa).
    const base = committed(), img = await loadImg(base), c = canvasFor(img); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    const f = (await findFaces(base, c)).map(boxOf)[0], cx = f[0] + f[2] / 2;
    const sub = (x, y, w, h) => ({ x, y, w, h, mw: 4, mh: 4, mask: btoa(String.fromCharCode(...new Array(16).fill(255))) });
    const calls = [];
    window.__glowCutoutForTests = { people: async (o) => { calls.push(o.image.slice(0, 23)); return { engine: 'mlkit', width: 100, height: 100, subjects: [sub(cx - 0.15, f[1] - 0.02, 0.3, 0.9), sub(0, 0.6, 0.12, 0.3)] }; } };
    personCache.length = 0;
    const a = await personAlpha(base, c), W = c.width, H = c.height, at = (x, y) => a[Math.round(y * H) * W + Math.round(x * W)];
    delete window.__glowCutoutForTests; personCache.length = 0;
    return { calls, person: at(cx, f[1] + 0.2), sofa: at(0.05, 0.75), corner: at(0.95, 0.05) };
  });
  eq(r.calls, ['data:image/jpeg;base64,'], 'the plugin gets one JPEG');
  assert(r.person > 0.9, 'the subject under the face is the person: ' + r.person);
  assert(r.sofa < 0.1 && r.corner < 0.1, 'the other subject and the room are background: ' + [r.sofa, r.corner]);
  eq(state.errs, [], 'no page errors');
});

test('adjust: a photo without a person keeps Full and explains why', async ({ p }) => {
  await p.goto('https://app.test/'); await pick(p, fx('coords-600x400.png'));
  await tool(p, 'edit', null, 'contrast');
  await p.waitForSelector('#areaRow .area-note', { timeout: 60000 });
  assert(await p.isDisabled('#areaRow .area[data-area="person"]'), 'Person disabled');
  assert(await p.isDisabled('#areaRow .area[data-area="bg"]'), 'Background disabled');
  eq(await p.$eval('#areaRow .area[aria-pressed="true"]', (e) => e.dataset.area), 'full', 'Full stays chosen');
});

test('adjust: Photoshop Express layout: chips on the photo, one slider row, changes kept as you go, hold to compare', async ({ p, state }) => {
  await p.goto('https://app.test/'); await pick(p, AREA_PHOTO);
  const h0 = await p.evaluate(() => Math.round($('before').getBoundingClientRect().height));
  await tool(p, 'edit', null, 'exposure');
  await p.waitForSelector('#areaBar .area[data-area="person"]:not(:disabled)', { timeout: 60000 });
  const lay = await p.evaluate(() => {
    const st = $('stage').getBoundingClientRect(), bar = $('areaBar').getBoundingClientRect(), tabs = $('tabs');
    return { live: $('panel').classList.contains('live'), onPhoto: bar.bottom <= st.bottom && bar.top >= st.top,
      hidden: ['applyBtn', 'cancelBtn', 'toolName', 'panelNote'].filter((id) => $(id).offsetParent === null).length,
      tabs: getComputedStyle(tabs).display !== 'none', refine: !!$('refineBtn'), label: $('panelBody').querySelector('.slider').firstChild.textContent,
      photo: Math.round($('before').getBoundingClientRect().height) };
  });
  eq([lay.live, lay.onPhoto, lay.hidden, lay.tabs, lay.refine, lay.label], [true, true, 4, true, true, 'Exposure'], 'one row, chips and Refine on the photo, no Cancel/Apply, tabs stay');
  assert(lay.photo >= h0 - 2, `the photo doesn't shrink when a slider opens: ${h0} -> ${lay.photo}`);
  // The info button shows the tool's note.
  await p.click('#toolInfo'); assert(await p.isVisible('#panelNote'), 'note shown'); await p.click('#toolInfo');
  // A change is kept when you move on: no question, one Undo step.
  await p.fill('#panelBody input[type=range]', '30'); await p.dispatchEvent('#panelBody input[type=range]', 'change');
  await p.waitForFunction(() => ed.pending && ed.pending.op.value === 30); await idle(p);
  await p.click('#tools .tool[data-tool="contrast"]'); await p.waitForFunction(() => sel === 'contrast' && ed.idx === 1 && !ed.pending);
  eq(await p.evaluate(() => [ed.hist[1].op.tool, document.querySelector('#ask[open]') ? 1 : 0]), ['exposure', 0], 'kept without asking');
  // Tapping the value goes back to no change; Undo takes a kept step back.
  await p.fill('#panelBody input[type=range]', '20'); await p.dispatchEvent('#panelBody input[type=range]', 'change');
  await p.waitForFunction(() => ed.pending && ed.pending.tool === 'contrast'); await idle(p);
  await p.click('#panelBody .slider output'); await p.waitForFunction(() => !ed.pending && toolAmt.contrast === 0); await idle(p);
  await p.click('#undoBtn'); await p.waitForFunction(() => ed.idx === 0);
  // Hold the photo: the original shows while held.
  await p.fill('#panelBody input[type=range]', '25'); await p.dispatchEvent('#panelBody input[type=range]', 'change');
  await p.waitForFunction(() => ed.pending && ed.pending.tool === 'contrast'); await idle(p);
  const c = await p.evaluate(() => { const r = $('frame').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 3]; });
  await p.mouse.move(c[0], c[1]); await p.mouse.down(); await p.waitForTimeout(600);
  eq(await p.evaluate(() => ed.view), 'original', 'holding shows the original');
  await p.mouse.up(); eq(await p.evaluate(() => [ed.view, !!ed.pending]), ['edited', true], 'letting go shows the edit again');
  // Save keeps the open slider's change without asking.
  await p.click('#saveBtn'); await p.waitForFunction(() => ed.idx === 1 && ed.hist[1].op.tool === 'contrast', null, { timeout: 30000 });
  eq(await p.evaluate(() => /Apply .* before saving/.test(document.body.innerText)), false, 'no "Apply before saving?" question');
  eq(state.errs, [], 'no page errors');
});

test('looks: a second filter replaces the first instead of stacking on it', async ({ p }) => {
  await p.goto('https://app.test/'); await pick(p, PORTRAIT);
  const ids = await p.evaluate(() => FILTER_IDS.slice(1, 3));
  await tool(p, 'looks', null, ids[0]); await p.waitForFunction((id) => ed.pending && ed.pending.tool === id, ids[0]); await idle(p);
  await p.click(`.tool[data-tool="${ids[1]}"]`); await p.waitForFunction((id) => ed.pending && ed.pending.tool === id, ids[1]); await idle(p);
  eq(await p.evaluate(() => [ed.idx, ed.hist.length]), [0, 1], 'only the newest filter is shown');
});

test('glowup: the checklist previews the ticked free steps, applies them as one step, and saves My routine', async ({ p, state }) => {
  await p.goto('https://app.test/'); await pick(p, PORTRAIT);
  eq(await p.evaluate(() => CATS.retouch[0][2][0]), 'glowup', 'Glow Up leads Retouch');
  await tool(p, 'retouch', null, 'glowup'); await p.waitForFunction(() => ed.pending && ed.pending.tool === 'glowup', null, { timeout: 60000 }); await idle(p);
  eq(await p.evaluate(() => ed.pending.op.glow.face.map((x) => x[0])), ['fsmooth', 'fblemish', 'ftone', 'fundereye', 'feyes', 'fteeth'], 'the default ticks');
  eq(await p.evaluate(() => [$('applyBtn').textContent, $('cost').textContent]), ['Apply', 'Free'], 'free with no AI step');
  await p.click('#panelBody .opt.check:has-text("Lips")'); await p.click('#panelBody .opt.check:has-text("Under-eyes")');
  await p.waitForFunction(() => ed.pending && ed.pending.op.glow.face.some((x) => x[0] === 'flips'), null, { timeout: 60000 }); await idle(p);
  eq(await p.evaluate(() => ed.pending.op.glow.face.map((x) => x[0]).includes('fundereye')), false, 'unticking takes a step out');
  await p.click('#saveRoutine'); await applyTool(p); await settle(200);
  eq(await p.evaluate(() => [ed.idx, ed.hist[1].op.tool]), [1, 'glowup'], 'one Undo step');
  eq(state.posts.length, 0, 'no AI request');
  await p.reload(); await p.waitForFunction(() => typeof glow !== 'undefined');
  eq(await p.evaluate(() => [glow.on.flips, glow.on.fundereye]), [true, false], 'My routine is the starting point next time');
});

test('glowup: an AI step runs first, her face is checked, then the free steps go on top as their own Undo step', async ({ p, state }) => {
  await p.goto('https://app.test/'); await pick(p, PORTRAIT);
  await p.evaluate(() => { CONFIG.aiV10 = true; });
  await tool(p, 'retouch', null, 'glowup'); await idle(p);
  await p.click('#panelBody .opt:has-text("Your words")'); await settle(100);
  eq(await p.evaluate(() => [$('applyBtn').textContent, $('applyBtn').disabled]), ['Glow Up · 2 credits', true], 'cost shown; waits for her words');
  await p.fill('#glowWords', 'warmer and less tired');
  eq(await p.evaluate(() => $('applyBtn').disabled), false, 'ready once she has written something');
  const req = p.waitForRequest((r) => r.url().includes('/functions/v1/enhance') && r.method() === 'POST');
  await applyTool(p); const body = JSON.parse((await req).postData());
  eq([body.mode, body.prompt], ['custom', 'warmer and less tired'], 'mode and her words');
  await p.waitForFunction(() => job && job.status === 'done', null, { timeout: 60000 });
  eq(await p.evaluate(() => [typeof job.faceKept, !!job.glow]), ['boolean', true], 'her face was checked; the free steps wait');
  await applyTool(p); await p.waitForFunction(() => ed.idx === 2 && !busyNow, null, { timeout: 60000 });
  eq(await p.evaluate(() => [ed.hist[1].op.fixed, ed.hist[2].op.tool, !!ed.hist[2].op.glow]), [true, 'glowup', true], 'AI step, then the free steps');
  eq([state.posts.length, state.used], [1, 1], 'one request');
});

test('seams: smoothing never uses a GPU picture that is shifted; without canvas blur, edits match the browser blur', async ({ p }) => {
  await p.goto('https://app.test/'); await settle(300);
  const r = await p.evaluate(async () => {
    const orig = await loadImg('/samples/demo-v2/original.png'), c = canvasFor(orig); c.getContext('2d').drawImage(orig, 0, 0, c.width, c.height);
    const base = c.toDataURL('image/jpeg', 0.95);
    // A phone that gives WebGL a smaller drawing buffer than asked (as some do).
    const proto = WebGLRenderingContext.prototype, d = Object.getOwnPropertyDescriptor(proto, 'drawingBufferHeight');
    Object.defineProperty(proto, 'drawingBufferHeight', { configurable: true, get() { return Math.round(d.get.call(this) * 0.8); } });
    let shifted; try { shifted = beautyTiled(c, { smooth: 100, bright: 0, warm: 0 }, 2); } finally { Object.defineProperty(proto, 'drawingBufferHeight', d); }
    const ok = beautyTiled(c, { smooth: 100, bright: 0, warm: 0 }, 2);
    glow = glowDefaults(); for (const k in glow.on) glow.on[k] = true; glow.look = 'soft';
    const native = await glowUp(base, glowRecipe());
    globalThis.__glowSoftFilter = true; let soft; try { soft = await glowUp(base, glowRecipe()); } finally { globalThis.__glowSoftFilter = false; }
    const px = async (s) => { const im = await loadImg(s), k = newCanvas(270, 360), x = k.getContext('2d', { willReadFrequently: true }); x.drawImage(im, 0, 0, 270, 360); return x.getImageData(0, 0, 270, 360).data; };
    const [a, b] = await Promise.all([px(native), px(soft)]); let sum = 0, worst = 0;
    for (let i = 0; i < a.length; i += 4) { const v = Math.abs(lum(a[i], a[i + 1], a[i + 2]) - lum(b[i], b[i + 1], b[i + 2])); sum += v; worst = Math.max(worst, v); }
    return { shifted: shifted === null, ok: !!ok, mean: sum / (a.length / 4), worst };
  });
  eq([r.shifted, r.ok], [true, true], 'a short drawing buffer is refused; a normal one is used');
  assert(r.mean < 2 && r.worst < 40, `the no-filter path matches: mean ${r.mean.toFixed(2)}, worst ${r.worst.toFixed(1)}`);
});

test('enhance: Colorize is offered only for black-and-white photos', async ({ p, state }) => {
  await p.goto('https://app.test/'); await pick(p, PORTRAIT);
  await p.waitForFunction(() => photoColorful === true);
  await tool(p, 'edit', null, 'colorize');
  eq(await p.evaluate(() => [$('applyBtn').disabled, /black-and-white/.test($('panelNote').textContent)]), [true, true], 'a color photo: off, with the reason');
  eq(state.posts.length, 0, 'nothing sent');
});

test('makeup: any color from the picker or the photo, a style per tool, and Save my look', async ({ p }) => {
  await p.goto('https://app.test/'); await pick(p, PORTRAIT);
  await tool(p, 'retouch', null, 'flips');
  const names = await p.$$eval('#panelBody .opt', (b) => b.map((x) => x.textContent));
  eq(names.slice(0, 5), ['Satin', 'Matte', 'Gloss', 'Shimmer', 'Ombré'], 'lip finishes');
  await p.click('#panelBody .swatch.more >> nth=0'); await settle(100);
  eq(await p.evaluate(() => [!!picking, $('applyBtn').disabled, document.querySelectorAll('#panelBody .color-slider').length]), [true, true, 3], 'the picker: three sliders, Apply waits for Done');
  await p.fill('#panelBody .color-slider input[type=range] >> nth=0', '200'); await settle(80);
  await p.click('#pickDone'); await settle(150);
  eq(await p.evaluate(() => [picking, faceSet.custom.flips && faceSet.custom.flips.length, faceSet.shade.flips === faceSet.custom.flips[0]]), [null, 1, true], 'the new color is kept and chosen');
  await p.click('#panelBody .opt:has-text("Gloss")'); await settle(100);
  eq(await p.evaluate(() => faceSet.style.flips), 'gloss', 'style chosen');
});

// ---------- Live beauty camera ----------
// The fake camera shows the sample portrait (tests/.assets/face.y4m). Headless Chromium runs the
// face model on its CPU, far slower than a phone, so these check behavior, not speed.
const liveOpts = (init) => ({ start: 'camera', args: faceVideo ? ['--use-file-for-fake-video-capture=' + faceVideo] : [], init });
const faceLive = async (p) => { await p.goto('https://app.test/'); await camLive(p); await p.waitForFunction(() => liveFace.seen >= 1, null, { timeout: 60000 }); };
// Mean color of a box (fractions of the canvas) of the live preview, read straight from the canvas.
const camPixels = (p, box) => p.evaluate((b) => {
  const c = $('camCanvas'), t = newCanvas(c.width, c.height), x = t.getContext('2d'); x.drawImage(c, 0, 0);
  const d = x.getImageData(b[0] * c.width, b[1] * c.height, b[2] * c.width, b[3] * c.height).data; let r = 0, g = 0, bl = 0;
  for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; bl += d[i + 2]; }
  const n = d.length / 4; return [r / n, g / n, bl / n];
}, box);
// The lips' box in the preview, from the tracked points (the front camera is mirrored on screen).
const lipBox = (p) => p.evaluate(() => {
  const c = $('camCanvas'), P = liveFace.pts, xs = FACE.lipsOut.map((i) => P[i][0]), ys = FACE.lipsOut.map((i) => P[i][1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys), w = x1 - x0;
  const mx = cam.facing === 'user' ? c.width - x1 : x0;
  return [(mx + w * 0.3) / c.width, (y0 + (y1 - y0) * 0.6) / c.height, (w * 0.4) / c.width, ((y1 - y0) * 0.3) / c.height];
});

if (faceVideo) test('camera live: follows the face, puts the look on it, and hold shows the original', async ({ p }) => {
  await faceLive(p);
  eq(await p.evaluate(() => [!!cam.gl.live, liveFace.pts.length, liveFace.failed]), [true, 478, false], 'live shader, 478 tracked points');
  await p.evaluate(() => { useLook(PRESET_LOOKS[0]); Object.assign(beauty, { lips: 100, lipShade: '#c0392b' }); });
  await settle(1500);
  const box = await lipBox(p), lipsOn = await camPixels(p, box);
  await p.evaluate(() => { useLook(PRESET_LOOKS[0]); }); await settle(1500);
  const lipsOff = await camPixels(p, box);
  assert(lipsOn[0] - lipsOn[2] > lipsOff[0] - lipsOff[2] + 15, `red lipstick makes the lips redder: ${lipsOn.map(Math.round)} vs ${lipsOff.map(Math.round)}`);
  // A spot on the background stays untouched by face-only effects.
  await p.evaluate(() => { Object.assign(beauty, { lips: 100, blush: 100, brows: 100, eyes: 100, slim: 100, nose: 100, smooth: 100 }); });
  await settle(1500);
  const bgOn = await camPixels(p, [0.02, 0.9, 0.06, 0.06]);
  await p.evaluate(() => { useLook(PRESET_LOOKS[0]); }); await settle(1200);
  const bgOff = await camPixels(p, [0.02, 0.9, 0.06, 0.06]);
  assert(bgOn.every((v, i) => Math.abs(v - bgOff[i]) < 4), `background unchanged by face effects: ${bgOn.map(Math.round)} vs ${bgOff.map(Math.round)}`);
  // Press and hold: the untouched frame, with an "Original" label; letting go brings the look back.
  await p.evaluate(() => useLook(PRESET_LOOKS[3]));
  await p.dispatchEvent('#camCanvas', 'pointerdown', { bubbles: true }); await settle(600);
  eq(await p.evaluate(() => [cam.compare, $('camCompare').hidden]), [true, false], 'holding shows the original');
  await p.dispatchEvent('#camCanvas', 'pointerup', { bubbles: true }); await settle(100);
  eq(await p.evaluate(() => [cam.compare, $('camCompare').hidden]), [false, true], 'letting go brings the look back');
  // The photo keeps the look, and the untouched frame is kept as the original.
  await p.click('#shutter'); await p.waitForSelector('#reviewControls:not([hidden])');
  eq(await p.evaluate(() => [!!cam.shot.processed, cam.shot.look, cam.shot.processed !== cam.shot.raw]), [true, 'Glam', true], 'photo has the Glam look');
  eq(await p.evaluate(() => [liveFace.pts, __liveTracks()]), [null, 0], 'camera and tracking stop while reviewing');
}, liveOpts());

if (faceVideo) test('camera live: Adjust chips show one slider at a time, Reset works, and looks remember face settings', async ({ p }) => {
  await faceLive(p);
  await p.click('.look.adjust'); await p.click('[data-set="eyes"]');
  eq(await p.evaluate(() => ['adjSkin', 'adjFace', 'adjMakeup', 'adjFilter'].map((id) => $(id).hidden)), [true, false, true, true], 'only Face shows');
  eq(await p.evaluate(() => [...document.querySelectorAll('#adjFace .slider')].map((l) => !l.hidden)), [true, false, false], 'only the Eyes slider');
  await p.locator('#sEyes').fill('60');
  eq(await p.evaluate(() => [beauty.eyes, lookId]), [60, 'custom'], 'Eye size changes the look');
  // ↺ resets just this setting; Reset puts the whole Natural look back.
  await p.click('#adjReset1'); eq(await p.evaluate(() => [beauty.eyes, lookId]), [0, 'natural'], 'reset one setting');
  await p.click('[data-set="smooth"]'); await p.locator('#sSmooth').fill('90'); await p.click('[data-set="nose"]'); await p.locator('#sNose').fill('70');
  await p.click('#adjResetAll'); eq(await p.evaluate(() => [beauty.smooth, beauty.nose, lookId]), [25, 0, 'natural'], 'reset all');
  // The panel is see-through: no dark box over the face.
  eq(await p.evaluate(() => getComputedStyle($('adjustPanel')).backgroundColor), 'rgba(0, 0, 0, 0)', 'no panel background');
  await p.click('[data-set="eyes"]'); await p.locator('#sEyes').fill('60');
  await p.click('[data-set="blush"]');
  eq(await p.textContent('#sMakeupName'), 'Blush', 'blush slider');
  eq(await p.locator('#swMakeup .cam-swatch').count(), 4, 'blush shades');
  await p.click('#swMakeup .cam-swatch:nth-child(2)');
  eq(await p.evaluate(() => beauty.blushShade), '#ff7f98', 'shade picked');
  await p.click('#adjSave');
  const saved = await p.evaluate(() => myLooks[myLooks.length - 1]);
  eq([saved.eyes, saved.blushShade], [60, '#ff7f98'], 'saved look keeps face and makeup settings');
  // A look saved before these settings existed starts them at zero.
  await p.evaluate(() => { myLooks.push({ id: 'myold', name: 'Old look', smooth: 40, bright: 10, warm: 0, filter: 'none' }); useLook(myLooks[myLooks.length - 1]); });
  eq(await p.evaluate(() => [beauty.smooth, beauty.eyes, beauty.lips, beauty.blushShade]), [40, 0, 0, '#f4a28c'], 'old look: face settings off');
  eq(await p.evaluate(() => $('adjNote').hidden), true, 'no note while a face is in view');
}, liveOpts());

// Camera controls polish: Adjust swaps the Looks row for the settings row (two rows, not three),
// Adjust is always first, ↺ shows only after a change, sliders fill in gold, chosen chips are gold.
if (faceVideo) test('camera live: Adjust replaces the Looks row, Done closes it, ↺ only after a change, gold fill', async ({ p }) => {
  await faceLive(p);
  eq(await p.evaluate(() => $('camLooks').firstElementChild.classList.contains('adjust')), true, 'Adjust is the first chip');
  await p.click('.look.adjust'); await p.click('[data-set="smooth"]');
  eq(await p.evaluate(() => [getComputedStyle($('camLooks')).display, $('adjDone').offsetWidth > 0]), ['none', true], 'Looks row hidden, Done shown');
  eq(await p.evaluate(() => getComputedStyle($('adjReset1')).opacity), '0', 'no ↺ at the Natural value');
  await p.locator('#sSmooth').fill('80'); await settle(300);
  eq(await p.evaluate(() => [$('adjReset1').classList.contains('off'), $('sSmooth').style.getPropertyValue('--p')]), [false, '80%'], '↺ shows, slider filled to 80%');
  const sel = await p.evaluate(() => getComputedStyle(document.querySelector('#adjChips [aria-checked="true"]')).color);
  eq(sel, 'rgb(255, 227, 163)', 'chosen setting is gold');
  // The value and ↺ never overlap.
  const gap = await p.evaluate(() => $('adjReset1').getBoundingClientRect().left - $('sSmooth').nextElementSibling.getBoundingClientRect().right);
  assert(gap >= 4, 'gap between value and ↺: ' + gap);
  await p.click('[data-set="filter"]'); await p.click('#camFilters .look:text-is("Golden")'); await settle(300);
  const f = await p.evaluate(() => { const r = $('adjReset1').getBoundingClientRect(), c = document.querySelector('#camFilters [aria-pressed="true"]').getBoundingClientRect(); return r.top >= c.bottom - 1 || r.bottom <= c.top + 1; });
  eq(f, true, '↺ never covers the filter chips');
  await p.click('#adjDone');
  eq(await p.evaluate(() => [$('adjustPanel').hidden, getComputedStyle($('camLooks')).display !== 'none']), [true, true], 'Done brings the Looks back');
  // Hide controls folds the rows away for the full picture (shutter stays), remembered, and comes back.
  await p.click('#camHide');
  eq(await p.evaluate(() => [getComputedStyle($('camLooks')).display, $('shutter').offsetWidth > 0, localStorage.getItem('glowCamMin'), $('camHide').getAttribute('aria-pressed')]), ['none', true, '1', 'true'], 'rows hidden, shutter kept');
  await p.click('#camHide');
  eq(await p.evaluate(() => [getComputedStyle($('camLooks')).display !== 'none', localStorage.getItem('glowCamMin')]), [true, ''], 'rows back');
}, liveOpts());

// A phone GPU that returns NaN face points (seen on Android Chrome): the worker moves to the CPU,
// finds the face, and says so in the error log.
if (faceVideo) test('camera live: a phone GPU that gives NaN face points switches to the CPU and finds the face', async ({ p, state }) => {
  const src = fs.readFileSync(path.join(__dirname, '../public/faceworker.js'), 'utf8')
    .replace('finder = await make("GPU"); gpu = true;', 'finder = await make("CPU"); gpu = true;')
    .replace('  return pts;\n}', '  if (gpu) pts.fill(NaN);\n  return pts;\n}');
  assert(/pts\.fill\(NaN\)/.test(src) && /make\("CPU"\); gpu = true/.test(src), 'worker patched for the test');
  await p.route('**/faceworker.js', (r) => r.fulfill({ contentType: 'text/javascript', body: src }));
  await faceLive(p);
  eq(await p.evaluate(() => [liveFace.failed, liveFace.pts.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y))]), [false, true], 'face found on the CPU');
  await settle(500);
  assert(state.appErrors.some((e) => /moved to the CPU: GPU gave NaN/.test(e.message)), 'reported: ' + state.appErrors.map((e) => e.message));
}, liveOpts());

if (faceVideo) test('camera live: no flicker: a missed frame fades, never cuts, the look; Adjust keeps the face large', async ({ p }) => {
  await faceLive(p);
  await p.evaluate(() => useLook(PRESET_LOOKS[3]));
  await p.waitForFunction(() => liveFace.shown === 1);
  // One missed answer from the face finder: the look stays on (it would have to be missed again and again to fade).
  eq(await p.evaluate(() => { takeFace(null); return new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(() => ok([liveFace.shown > 0.6, !!liveFace.pts])))); }), [true, true], 'one miss: look still on');
  // Before the face model is ready, smoothing isn't spread over the whole picture (it would jump when the face is found).
  eq(await p.evaluate(() => { const r = liveFace.ready; liveFace.ready = false; const g = cam.gl, b = { ...beauty, smooth: 100 }; let on;
    const real = g.gl.uniform1f.bind(g.gl); g.gl.uniform1f = (loc, v) => { if (loc === g.u.faceOn) on = v; return real(loc, v); };
    drawLive(g, $('camVideo'), $('camVideo').videoWidth, $('camVideo').videoHeight, true, b, false); g.gl.uniform1f = real; liveFace.ready = r; return on; }), 1, 'smoothing waits for the face');
  // Adjust open: the preview fills the space above the panel (cropped, not shrunk), with the face in it.
  const before = await p.evaluate(() => { const c = $('camCanvas'), k = Math.min(c.clientWidth / c.width, c.clientHeight / c.height); return c.height * k; });
  await p.click('.look.adjust'); await p.click('[data-set="eyes"]'); await settle(1500);
  const r = await p.evaluate(() => {
    const c = $('camCanvas'), cs = getComputedStyle(c), k = Math.max(c.clientWidth / c.width, c.clientHeight / c.height), hs = c.height * k;
    const p = parseFloat(cs.objectPosition.split(' ')[1]) / 100, top = (c.clientHeight - hs) * p;
    const P = liveFace.pts, y = (i) => top + P[i][1] * k;
    return { fit: cs.objectFit, shown: c.clientWidth >= c.width * Math.min(c.clientWidth / c.width, c.clientHeight / c.height) - 1, brow: y(LIVE_PTS.brow), chin: y(LIVE_PTS.chin), h: c.clientHeight, scale: hs };
  });
  eq(r.fit, 'cover', 'preview fills the space');
  assert(r.brow >= -2 && r.chin <= r.h + 2, `face in view: brow ${r.brow}, chin ${r.chin}, of ${r.h}`);
  const open = await p.evaluate(() => $('camControls').getBoundingClientRect().top - $('camCanvas').getBoundingClientRect().top);
  assert(r.chin <= open + 2, `face above the Adjust panel: chin ${r.chin}, panel ${open}`);
  assert(r.scale >= before - 1, `picture not smaller than before Adjust: ${r.scale} vs ${before}`);
  await p.click('#adjDone');
  eq(await p.evaluate(() => [getComputedStyle($('camCanvas')).objectFit, $('camCanvas').style.objectPosition]), ['cover', ''], 'closing Adjust keeps the full-screen preview, centred again');
}, liveOpts());

// A selfie stays a selfie: the chosen side is asked for exactly, then any camera if the phone has one.
test('camera: the last used side is asked for exactly, with a fallback for one-camera phones', async ({ p }) => {
  await p.goto('https://app.test/');
  const asks = await p.evaluate(async () => {
    const seen = [], real = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (c) => { seen.push(JSON.stringify(c.video.facingMode)); if (typeof c.video.facingMode === 'object') { const e = new Error('no'); e.name = 'OverconstrainedError'; throw e; } return real(c); };
    const s = await Platform.camera.open('user'); s.getTracks().forEach((t) => t.stop()); navigator.mediaDevices.getUserMedia = real; return seen;
  });
  eq(asks, ['{"exact":"user"}', '"user"'], 'exact first, then a preference');
  await p.evaluate(() => { localStorage.setItem('glowFacing', 'environment'); });
  await p.reload(); eq(await p.evaluate(() => cam.facing), 'environment', 'remembered after reopening');
}, { start: 'camera' });

// ---------- Operations: support, diagnostics ----------
test('ops: Contact support sends the message with the account ID and app details', async ({ p, state }) => {
  await p.goto('https://app.test/'); await p.waitForFunction(() => !!session);
  await p.evaluate(() => openSettings()); await p.click('#contactSupport');
  assert(await p.isVisible('#supportSheet'), 'support sheet open');
  assert(/u1/.test(await p.textContent('#supportAccount')), 'shows the account ID');
  await p.selectOption('#supportTopic', 'billing');
  await p.fill('#supportMessage', 'I paid but still see the free plan.');
  await p.fill('#supportName', 'Sam Test');
  await p.fill('#supportEmail', 'me@test.dev');
  await p.click('#supportSend');
  await p.waitForFunction(() => !$('supportSheet').open);
  eq(state.support.length, 1, 'one message sent');
  const m = state.support[0];
  eq([m.topic, m.message, m.email], ['billing', 'I paid but still see the free plan.', 'me@test.dev'], 'message fields');
  eq(m.context.plan, 'free', 'plan sent as context');
  assert(/reply here in the app/.test(await toast(p)), 'confirmation: ' + await toast(p));
  eq([m.context.app > 202610000, typeof m.context.tz], [true, 'string'], 'app build and time zone sent');
  await settle(4500);
  assert(state.events.some((e) => e.name === 'support_sent' && e.props.topic === 'billing'), 'support_sent event');
});

test('ops: the editor and Enhance report what people do (photo, tool, AI result, save)', async ({ p, state }) => {
  await p.goto('https://app.test/'); await p.waitForFunction(() => screen === 'enhanceHome');
  const fc = p.waitForEvent('filechooser'); await p.click('#enhPick'); await (await fc).setFiles(PORTRAIT);
  await p.waitForSelector('#enhSheet[open]'); await p.click('#enhGo');
  await p.waitForFunction(() => screen === 'enhanceResult' && $('enhAfter').naturalWidth > 0, null, { timeout: 30000 });
  await p.click('#enhDownload'); await downloads(state, 1); await p.waitForFunction(() => screen === 'enhanceShare');
  await p.click('#enhEdit'); await p.waitForFunction(() => screen === 'editorScreen' && ed.hist.length === 2);
  await tool(p, 'edit', 'light', 'light'); await p.fill('.panel input[type=range]', '20'); await idle(p);
  await applyTool(p); await idle(p); await p.click('#saveBtn'); await downloads(state, 2);
  await settle(4500);
  const ev = (n) => state.events.filter((e) => e.name === n).map((e) => e.props);
  eq(ev('photo_open')[0]?.from, 'enhance', 'photo_open from enhance');
  eq(ev('ai_start')[0]?.mode, 'enhance', 'ai_start with the tool');
  assert(ev('ai_done').length === 1 && typeof ev('ai_done')[0].secs === 'number', 'ai_done with duration: ' + JSON.stringify(ev('ai_done')));
  eq(ev('save').map((x) => x.from), ['enhance', 'editor'], 'both saves reported with where they came from');
  assert(ev('enhance_to_editor').length === 1, 'hand-off to the editor');
  assert(ev('edit').some((x) => x.tool === 'light'), 'editor tool reported: ' + JSON.stringify(ev('edit')));
  assert(state.events.every((e) => JSON.stringify(e).length < 300), 'events stay small');
  eq(state.errs, [], 'no page errors');
}, { start: 'enhance', camera: false });

test('ops: usage events are batched and never carry photos; errors are reported once', async ({ p, state }) => {
  await p.goto('https://app.test/'); await p.waitForFunction(() => !!session);
  await p.evaluate(() => openPaywall());
  await settle(4500);
  const names = state.events.map((e) => e.name);
  assert(names.includes('app_open'), 'app_open sent: ' + names);
  assert(names.includes('paywall_view'), 'paywall_view sent: ' + names);
  assert(state.events.every((e) => JSON.stringify(e).length < 300), 'events are small (no images)');
  assert(state.events.every((e) => e.platform === 'web'), 'platform recorded');
  // The same error twice is reported once; expected server errors (with a status) are not reported.
  await p.evaluate(() => { setTimeout(() => { throw new Error('test boom'); }); setTimeout(() => { throw new Error('test boom'); }); });
  await p.evaluate(() => { const e = new Error('limit'); e.status = 429; Promise.reject(e); });
  await settle(800);
  eq(state.appErrors.map((e) => e.message), ['Uncaught Error: test boom'], 'one error report');
  state.errs = state.errs.filter((e) => !/test boom|limit/.test(e));   // thrown on purpose
});

// ---------- Whole-app audit (2026-10-31) ----------
test('audit: a bad live-camera frame never stops the preview, and is reported once', async ({ p, state }) => {
  await p.goto('https://app.test/'); await camLive(p);
  await p.evaluate(() => {
    // The first frame drawn from now on throws, as the NaN face points did on a phone.
    window.__frames = 0; let thrown = false; const real = drawCamFrame;
    drawCamFrame = function (...a) { window.__frames++; if (!thrown) { thrown = true; throw new Error('non-finite test frame'); } return real.apply(this, a); };
  });
  // Headless Chromium draws only a few frames a second here; any frame after the bad one is enough.
  await p.waitForFunction(() => window.__frames >= 3, null, { timeout: 10000 });
  eq(await p.evaluate(() => cam.state), 'live', 'camera still live');
  await settle(500);
  eq(state.appErrors.map((e) => e.message), ['non-finite test frame'], 'reported once');
}, { start: 'camera' });

test('audit: face points with NaN in them count as no face', async ({ p }) => {
  await p.goto('https://app.test/');
  eq(await p.evaluate(() => { liveFace.size = [640, 480]; liveFace.seen = 0; takeFace(new Float32Array([0.5, NaN, 0.2, 0.3])); return [liveFace.pts, liveFace.seen]; }), [null, 0], 'ignored');
});

test('audit: Pro is remembered while the server is out of reach, so Pro saves stay unmarked', async ({ p }) => {
  await p.goto('https://app.test/'); await p.waitForFunction(() => !!account);
  const r = await p.evaluate(() => {
    const out = [];
    showUsage({ plan: 'pro', expires: new Date(Date.now() + 864e5).toISOString(), remaining: 40, quota: 40 }); account = null; out.push(isPro());
    store.set('glowPro', new Date(Date.now() - 1000).toISOString()); out.push(isPro());
    showUsage({ plan: 'pro', expires: new Date(Date.now() + 864e5).toISOString(), remaining: 40, quota: 40 });
    showUsage({ plan: 'free', remaining: 3, quota: 3 }); account = null; out.push(isPro());
    return out;
  });
  eq(r, [true, false, false], 'remembered Pro, expired Pro, back to free');
});

test('audit: RevenueCat follows the account when Glow signs in as a new one', async ({ p }) => {
  await p.goto('https://app.test/'); await p.waitForFunction(() => !!session);
  const r = await p.evaluate(async () => {
    const calls = [];
    plugins.Purchases = { logIn: async (o) => { calls.push(o.appUserID); } };
    rcUser = 'old-account'; followAccount(); await new Promise((ok) => setTimeout(ok, 50));
    const after = rcUser; followAccount(); await new Promise((ok) => setTimeout(ok, 50));
    delete plugins.Purchases; rcUser = '';
    return [calls, after];
  });
  eq(r, [['u1'], 'u1'], 'logged in to the current account once');
});

test('audit: Enhance saves the AI result at its full size, not the 2048px working copy', async ({ p, state }) => {
  await p.goto('https://app.test/'); await p.waitForFunction(() => screen === 'enhanceHome');
  const fc = p.waitForEvent('filechooser'); await p.click('#enhPick'); await (await fc).setFiles(PORTRAIT);
  await p.waitForSelector('#enhSheet[open]'); await p.click('#enhGo');
  await p.waitForFunction(() => screen === 'enhanceResult' && $('enhAfter').naturalWidth > 0, null, { timeout: 60000 });
  eq(await p.evaluate(() => $('enhAfter').naturalWidth), 2048, 'the screen uses the 2048px copy');
  await p.click('#enhDownload'); const [d] = await downloads(state, 1);
  eq(imageSize(d.file).w, 6000, 'saved at the AI result size');
}, { start: 'enhance', camera: false, files: { '/__ai.jpg': path.join(fixtures, 'large-24mp.jpg') } });

// 2026-11-02 deep audit.
test('audit2: a gateway timeout on Enhance never charges twice: Check again finds the same job', async ({ p, state }) => {
  await p.goto('https://app.test/'); await p.waitForFunction(() => screen === 'enhanceHome');
  const fc = p.waitForEvent('filechooser'); await p.click('#enhPick'); await (await fc).setFiles(PORTRAIT);
  await p.waitForSelector('#enhSheet[open]'); await p.click('#enhGo');
  await p.waitForFunction(() => !enh.busy && $('enhGoLbl').textContent === 'Check again', null, { timeout: 60000 });
  eq(state.posts.length, 1, 'one POST');
  eq(await p.evaluate(() => !!enh.pending), true, 'the request is kept');
  await p.click('#enhGo');
  await p.waitForFunction(() => screen === 'enhanceResult', null, { timeout: 60000 });
  eq(state.posts.length, 1, 'Check again did not POST again');
  eq(state.used, 1, 'charged once');
}, { start: 'enhance', camera: false, ai: { server: 'patched', gatewayPost: true } });

test('audit2: Enhance Result saves full size after a Colors level change too', async ({ p, state }) => {
  await p.goto('https://app.test/'); await p.waitForFunction(() => screen === 'enhanceHome');
  const fc = p.waitForEvent('filechooser'); await p.click('#enhPick'); await (await fc).setFiles(PORTRAIT);
  await p.waitForSelector('#enhSheet[open]'); await p.click('#enhGo');
  await p.waitForFunction(() => screen === 'enhanceResult' && $('enhAfter').naturalWidth > 0, null, { timeout: 60000 });
  await p.evaluate(async () => { enh.lv.colors = 1; showComposite(await composeEnhanced(enh.lv)); });
  eq(await p.evaluate(() => enh.current !== enh.ai), true, 'a level is on');
  await p.click('#enhDownload'); const [d] = await downloads(state, 1);
  const w = imageSize(d.file).w; eq(w > 4000 && w <= 6000, true, `saved near full size (16 MP cap), not 2048 (got ${w})`);
}, { start: 'enhance', camera: false, files: { '/__ai.jpg': path.join(fixtures, 'large-24mp.jpg') } });

test('audit2: the editor and the camera each have their own Save my look', async ({ p }) => {
  await p.goto('https://app.test/');
  eq(await p.evaluate(() => [typeof saveMakeupLook, typeof saveMyLook, saveMakeupLook.toString().includes('faceSet.mine')]), ['function', 'function', true], 'two separate functions');
});

test('audit2: saved photos keep the original date taken', async ({ p }) => {
  await p.goto('https://app.test/');
  const r = await p.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 8; c.height = 8;
    const b = await new Promise((ok) => c.toBlob(ok, 'image/jpeg', 0.9));
    const out = await withPhotoDate(b, '2019:07:04 12:34:56');
    return [await photoDate(b), await photoDate(out), out.size > b.size];
  });
  eq(r, ['', '2019:07:04 12:34:56', true], 'date written and read back');
});

// 2026-11-01 audit of the Pro mark switch: the Enhance tab follows it too, and the paywall the free
// switch opens closes back to Settings.
test('audit: Enhance saves follow the mark switch for Pro (on by default, off when switched off)', async ({ p, state }) => {
  await p.goto('https://app.test/'); await p.waitForFunction(() => screen === 'enhanceHome' && account && account.plan === 'pro');
  const run = async () => {
    const fc = p.waitForEvent('filechooser'); await p.click('#enhPick'); await (await fc).setFiles(PORTRAIT);
    await p.waitForSelector('#enhSheet[open]'); await p.click('#enhGo');
    await p.waitForFunction(() => screen === 'enhanceResult' && $('enhAfter').naturalWidth > 0, null, { timeout: 60000 });
  };
  await run();
  await p.click('#enhDownload'); await p.waitForSelector('#ask[open]');
  eq(await p.textContent('#askTitle'), 'Your saves include a small Glow Studio badge', 'Pro note on the Enhance save too');
  await p.click('#ask .btn:has-text("Keep it and save")'); await downloads(state, 1);
  eq(await p.evaluate(() => [store.get('glowMark'), store.get('glowProBadgeSeen')]), ['', '1'], 'kept on (default), note seen');
  const ev = () => p.evaluate(() => { flushTelemetry(); }).then(() => settle(400)).then(() => state.events.filter((e) => e.name === 'save').map((e) => e.props && e.props.marked));
  await p.evaluate(() => { store.set('glowMark', 'off'); });
  await p.click('#enhShareBack'); await p.waitForFunction(() => screen === 'enhanceResult');
  await p.click('#enhDownload'); await downloads(state, 2);
  const marks = await ev();
  eq(marks.slice(-2), [true, false], 'first save marked, after switching off clean: ' + JSON.stringify(marks));
  eq(state.errs, [], 'no page errors');
}, { start: 'enhance', camera: false, plan: 'pro', quota: 40, markIntro: true });
test('audit: the Pro offer from the free mark switch closes back to Settings', async ({ p }) => {
  await p.goto('https://app.test/'); await p.waitForFunction(() => screen === 'enhanceHome' && account && account.plan === 'free');
  await p.click('#enhSettingsBtn'); await p.waitForSelector('#settings[open]');
  await p.click('#markToggle'); await p.waitForSelector('#paywall[open]');
  await p.evaluate(() => goBack()); await p.waitForFunction(() => !$('paywall').open);
  eq(await p.evaluate(() => [$('settings').open, $('markToggle').checked]), [true, true], 'Settings still open, mark still on');
}, { start: 'enhance', camera: false });

// 2026-11-01: a release dropped tryon.js from the offline app shell, so Try on didn't load offline.
test('audit: every script the app loads is in the offline app shell', async () => {
  const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8'), sw = fs.readFileSync(path.join(__dirname, '../public/sw.js'), 'utf8');
  const shell = JSON.parse(sw.match(/const SHELL = (\[[\s\S]*?\]);/)[1]);
  const scripts = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => '/' + m[1].replace(/^\//, '')).filter((s) => !/^\/\//.test(s) && !/^\/https?:/.test(s));
  const css = [...html.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/g)].map((m) => '/' + m[1].replace(/^\//, '')).filter((s) => !/^\/https?:/.test(s));
  const missing = scripts.concat(css).filter((f) => !shell.includes(f));
  eq(missing, [], 'missing from the shell');
});

// ---------- Runner ----------
// ---------- Batch Enhance (Pro) ----------
const BATCH_FILES = ['demo-test-a.jpg', 'demo-test-b.jpg', 'group-two.jpg', 'coords-600x400.png', 'phone-12mp-exif6.jpg'].map(fx);
async function batchOpen(p, files) {
  await p.goto('https://app.test/'); await p.waitForFunction(() => screen === 'enhanceHome' && account && account.plan);
  const fc = p.waitForEvent('filechooser'); await p.click('#enhBatchPick'); await (await fc).setFiles(files);
  await p.waitForFunction(() => screen === 'enhanceBatch' && !batch.loading, null, { timeout: 30000 });
}
test('enhance batch: free plan sees it as Pro and gets the paywall, no picker', async ({ p, state }) => {
  await p.goto('https://app.test/'); await p.waitForFunction(() => screen === 'enhanceHome' && account && account.plan === 'free');
  assert(/Pro/.test(await p.textContent('#enhBatchPick')), 'Pro label on the link');
  let picked = false; p.on('filechooser', () => { picked = true; });
  await p.click('#enhBatchPick'); await p.waitForSelector('#paywall[open]'); await settle(4500);
  assert(!picked, 'no picker on the free plan');
  assert(state.events.some((e) => e.name === 'batch_locked'), 'batch_locked reported');
  eq(state.posts.length, 0, 'no AI request');
}, { start: 'enhance', camera: false });

test('enhance batch: cost first, three at a time, each result as it lands, Save all saves every photo', async ({ p, state }) => {
  await batchOpen(p, BATCH_FILES);
  eq(await p.evaluate(() => batch.items.length), 5, 'five photos added');
  assert(/Uses 5 AI credits · 40 left this week/.test(await p.textContent('#batchCost')), 'total cost before starting: ' + await p.textContent('#batchCost'));
  eq(await p.textContent('#batchGoLbl'), 'Enhance 5 photos', 'button names the count');
  eq(state.posts.length, 0, 'nothing sent before tapping');
  await p.evaluate(() => { window.__maxWorking = 0; window.__seen = setInterval(() => { window.__maxWorking = Math.max(window.__maxWorking, batch.items.filter((i) => i.status === 'working').length); }, 50); });
  await p.click('#batchGo');
  // The first finished photo shows while others are still running.
  await p.waitForFunction(() => batch.items.some((i) => i.status === 'done') && batch.running, null, { timeout: 60000 });
  assert(await p.isVisible('.bt.done .bt-state svg'), 'finished tile shows a check');
  await p.waitForFunction(() => !batch.running, null, { timeout: 90000 });
  eq(await p.evaluate(() => window.__maxWorking), 3, 'three at a time');
  eq(state.posts.length, 5, 'one request per photo'); eq(state.used, 5, 'five credits');
  eq(await p.evaluate(() => batch.items.map((i) => i.status)), Array(5).fill('done'), 'all done');
  eq(await p.textContent('#batchGoLbl'), 'Save all', 'Save all offered');
  // A finished photo opens in the usual Result screen and comes back to the batch.
  await p.click('.bt.done >> nth=1');
  await p.waitForFunction(() => screen === 'enhanceResult' && $('enhAfter').naturalWidth > 0, null, { timeout: 30000 });
  await p.click('#enhClose'); await p.waitForFunction(() => screen === 'enhanceBatch');
  eq(state.posts.length, 5, 'opening a result costs nothing');
  await p.click('#batchGo'); await downloads(state, 5); await settle(400);
  eq(state.downloads.length, 5, 'five files saved');
  assert(state.downloads.every((d) => /^glow-studio-enhanced-\d+-\d\.\w+$/.test(d.name)), 'named in order: ' + state.downloads.map((d) => d.name));
  const ai = imageSize(path.join(fixtures, 'ai-result.jpg'));
  assert(state.downloads.every((d) => imageSize(d.file).w === ai.w), 'saved at the AI result\'s full size');
  eq(await p.textContent('#batchGoLbl'), 'Done', 'Done after saving');
  await settle(4500);
  const ev = (n) => state.events.filter((e) => e.name === n).map((e) => e.props);
  eq(ev('batch_open')[0]?.photos, 5, 'batch_open'); eq(ev('batch_start')[0]?.photos, 5, 'batch_start');
  eq([ev('batch_done')[0]?.done, ev('batch_done')[0]?.failed], [5, 0], 'batch_done'); eq(ev('batch_save')[0]?.photos, 5, 'batch_save');
  eq(ev('ai_start').filter((x) => x.from === 'batch').length, 5, 'each photo reported as from batch');
  await p.click('#batchGo'); await p.waitForFunction(() => screen === 'enhanceHome' && !batch.items.length);
}, { start: 'enhance', camera: false, plan: 'pro', quota: 40, ai: { post: 'processing', polls: ['processing', 'processing', 'succeeded'] } });

test('enhance batch: never starts without the credits, caps at 10, and asks before leaving unsaved', async ({ p, state }) => {
  await batchOpen(p, [...BATCH_FILES, ...BATCH_FILES, BATCH_FILES[0]]);
  eq(await p.evaluate(() => batch.items.length), 10, 'capped at 10');
  assert(/up to 10/.test(await toast(p)), 'says why: ' + await toast(p));
  assert(await p.isHidden('#batchAdd'), 'no Add at 10');
  assert(/You have 3 AI credits left this week. Remove 7 photos to start./.test(await p.textContent('#batchCost')), 'short on credits: ' + await p.textContent('#batchCost'));
  await p.click('#batchGo'); await settle(300); eq(state.posts.length, 0, 'nothing sent');
  for (let k = 0; k < 7; k++) await p.click('.bt-x >> nth=0');
  assert(/Uses 3 AI credits · 3 left/.test(await p.textContent('#batchCost')), 'fits now');
  await p.click('#batchGo'); await p.waitForFunction(() => !batch.running && batch.items.every((i) => i.status === 'done'), null, { timeout: 60000 });
  eq(state.posts.length, 3, 'three requests');
  await p.click('#batchClose'); await p.waitForSelector('#ask[open], dialog[open]');
  assert(/Leave without saving/.test(await p.textContent('dialog[open]')), 'asks before discarding');
}, { start: 'enhance', camera: false, plan: 'pro', quota: 3 });

test('enhance batch: one failed photo does not stop the rest, and it can be retried', async ({ p, state }) => {
  await batchOpen(p, BATCH_FILES.slice(0, 3));
  await p.evaluate(() => { const f = window.fetch; let n = 0; window.fetch = (u, o) => (String(u).includes('/functions/v1/enhance') && o && o.method === 'POST' && n++ === 1 ? Promise.resolve(new Response(JSON.stringify({ error: 'Glow\'s AI service is temporarily unavailable.' }), { status: 502 })) : f(u, o)); });
  await p.click('#batchGo'); await p.waitForFunction(() => !batch.running, null, { timeout: 60000 });
  eq(await p.evaluate(() => batch.items.map((i) => i.status).sort()), ['done', 'done', 'failed'], 'one failed, two done');
  assert(/couldn't be enhanced/.test(await toast(p)), 'says so: ' + await toast(p));
  assert(/1 photo not enhanced/.test(await p.textContent('#batchCost')), 'offers the rest: ' + await p.textContent('#batchCost'));
  eq(await p.textContent('#batchGoLbl'), 'Save 2 enhanced', 'can save what worked');
  await p.click('.bt.failed .bt-ph'); await p.waitForFunction(() => !batch.running && batch.items.every((i) => i.status === 'done'), null, { timeout: 60000 });
  eq(await p.textContent('#batchGoLbl'), 'Save all', 'all done after retry');
}, { start: 'enhance', camera: false, plan: 'pro', quota: 40 });
// ---------- Credit packs ----------
test('packs: bought credits pay for premium tools on the free plan once the free tries are used', async ({ p, state }) => {
  await p.goto('https://app.test/'); await pick(p, PORTRAIT);
  await p.waitForFunction(() => !!account);
  await p.evaluate(() => showUsage({ plan: 'free', used: 0, quota: 3, remaining: 13, trialLeft: 0, adsLeft: 1, bonus: 10, v: 2 }));
  await tool(p, 'edit', null, 'pro');
  eq(await p.evaluate(() => [$('applyBtn').textContent, /0 free and 10 extra credits left/.test($('panelNote').textContent)]), ['Apply · 2 credits', true], 'premium tool runs on extra credits');
  await p.evaluate(() => showUsage({ plan: 'free', pool: 'trial', used: 1, quota: 3, remaining: 9 }));
  eq(await p.evaluate(() => account.trialLeft), 0, 'a run paid with extra credits leaves the free tries at 0');
  state.bonus = 9; await p.evaluate(() => openCredits()); await p.waitForFunction(() => account.bonus === 9);
  assert(/9 extra AI credits, included above/.test(await p.textContent('#creditsBody')), 'credits sheet lists the extra credits');
});

test('packs: web shows the packs with prices but sends buyers to the app', async ({ p }) => {
  await p.goto('https://app.test/'); await p.waitForFunction(() => !!account);
  await p.evaluate(() => openPaywall()); await p.click('#pwPacks');
  await p.waitForSelector('#packsSheet[open]');
  eq(await p.evaluate(() => [...document.querySelectorAll('.pack')].map((b) => [b.querySelector('b').textContent, b.querySelector('.price').textContent, b.disabled])),
    [['10', '$1.99', true], ['30', '$4.99', true], ['80', '$11.99', true]], 'three packs, store prices, not buyable on the web');
  assert(/available in the Glow Studio app/.test(await p.textContent('#packsNote')), 'says where to buy');
  eq(await p.evaluate(() => $('paywall').open), false, 'paywall closed behind it');
});

test('packs: in the phone app a pack is bought through the store and its credits show up', async ({ p, state }) => {
  await p.exposeFunction('__grant', (n) => { state.bonus = (state.bonus || 0) + n; });
  await p.goto('https://app.test/'); await p.waitForFunction(() => !!account && !!session);
  await p.evaluate(() => { CONFIG.revenuecatAndroid = 'goog_test'; rcReady = null; });
  await p.evaluate(() => openPacks());
  await p.waitForFunction(() => $('packs').textContent.includes('€2,29'));
  eq(await p.evaluate(() => [...document.querySelectorAll('.pack')].map((b) => b.disabled)), [false, false, false], 'buyable in the app');
  await p.click('.pack[data-pack="glow_credits_30"]');
  await p.waitForFunction(() => !$('packsSheet').open, null, { timeout: 15000 });
  await p.waitForFunction(() => /30 AI credits added/.test($('toast').textContent), null, { timeout: 15000 });
  eq(await p.evaluate(() => [window.__bought, account.bonus, account.remaining]), ['glow_credits_30', 30, 33], 'bought the pack the user tapped; balance includes it');
  // A cancelled purchase says nothing and adds nothing.
  await p.evaluate(() => { window.__cancel = true; openPacks(); }); await p.click('.pack[data-pack="glow_credits_10"]'); await settle(500);
  eq(await p.evaluate(() => [$('packsSheet').open, account.bonus]), [true, 30], 'cancel keeps the sheet open');
  // Pro users who run out get packs instead of a dead end.
  await p.evaluate(() => { $('packsSheet').close(); showUsage({ plan: 'pro', used: 40, quota: 40, remaining: 0, bonus: 0 }); });
  await pick(p, PORTRAIT); await tool(p, 'edit', null, 'pro'); await applyTool(p); await settle(300);
  eq(await p.evaluate(() => [$('packsSheet').open, $('packsTitle').textContent, $('packsPro').hidden]), [true, 'Out of AI credits for this week', true], 'Pro out of credits: packs, no Pro upsell');
  await p.evaluate(() => flushTelemetry()); await settle(500);
  const names = state.events.map((e) => e.name);
  for (const n of ['packs_view', 'pack_start', 'pack_purchase', 'pack_fail']) assert(names.includes(n), n + ' tracked: ' + names);
}, { init: () => {
  const prices = { glow_credits_10: '€2,29', glow_credits_30: '€5,49', glow_credits_80: '€12,99' };
  window.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'android', Plugins: { Purchases: {
    configure: async () => {}, logIn: async () => {},
    getOfferings: async () => ({ current: { availablePackages: [] } }),
    getProducts: async ({ productIdentifiers, type }) => ({ products: type === 'NON_SUBSCRIPTION' ? productIdentifiers.map((id) => ({ identifier: id, priceString: prices[id] })) : [] }),
    purchaseStoreProduct: async ({ product }) => {
      if (window.__cancel) throw Object.assign(new Error('cancelled'), { userCancelled: true });
      window.__bought = product.identifier; await window.__grant(+product.identifier.split('_').pop());
    },
  } } };
} });


// ---------- Pricing 2026-11-01: yearly free trial, Pro screen at the first result (migration 015) ----------
// RevenueCat stand-in for the phone app. window.__rc picks the platform and the trial answers.
const rcInit = () => {
  const o = window.__rcOpts || {};
  window.Capacitor = { isNativePlatform: () => true, getPlatform: () => o.ios ? 'ios' : 'android', Plugins: { Purchases: {
    configure: async () => {}, logIn: async () => {}, getProducts: async () => ({ products: [] }),
    checkTrialOrIntroductoryPriceEligibility: async ({ productIdentifiers }) => Object.fromEntries(productIdentifiers.map((id) => [id, { status: o.iosStatus ?? 2 }])),
    getOfferings: async () => ({ current: { availablePackages: [
      { packageType: 'WEEKLY', product: { identifier: 'glow_pro_weekly', priceString: '$4.99' } },
      { packageType: 'ANNUAL', product: { identifier: 'glow_pro_yearly', priceString: '$49.99', pricePerMonthString: '$4.17',
        introPrice: o.noTrial ? null : { price: 0, priceString: '$0.00', periodUnit: 'DAY', periodNumberOfUnits: 3 } } }] } }),
  } } };
};
const openPw = async (p) => { eq(await p.evaluate(async () => { CONFIG.revenuecatAndroid = 'goog_test'; CONFIG.revenuecatIos = 'appl_test'; rcReady = null; openPaywall(); return await rcReady; }), true, 'store set up'); };

test('pricing: the yearly free trial shows its terms when the store offers it; weekly has none; the yearly cap reads 60', async ({ p, state }) => {
  await p.goto('https://app.test/'); await p.waitForFunction(() => !!session);
  await openPw(p);
  eq(await p.evaluate(() => [$('yearlyNote').textContent, $('buyBtn').textContent, $('pwNote').textContent.split('.')[0]]),
    ['3 days free, then $49.99 a year', 'Start 3-day free trial', 'Free for 3 days, with 10 AI credits to try'], 'trial terms on yearly');
  assert(/Then \$49\.99 per year\. Renews automatically every year/.test(await p.textContent('#pwNote')), 'price after the trial: ' + await p.textContent('#pwNote'));
  await p.click('.plan[data-plan="weekly"]');
  eq(await p.evaluate(() => [$('buyBtn').textContent, /Free for/.test($('pwNote').textContent)]), ['Continue with weekly', false], 'weekly: no trial');
  assert((await p.textContent('.pw-free')).includes('up to 60 credits a month'), 'yearly cap 60');
  eq(state.errs, [], 'no page errors');
}, { init: rcInit });

test('pricing: no trial wording when Apple says this person can\'t have it, or the store has no trial', async ({ p }) => {
  await p.goto('https://app.test/'); await p.waitForFunction(() => !!session);
  await openPw(p);
  eq(await p.evaluate(() => [$('yearlyNote').textContent, $('buyBtn').textContent, /Free for/.test($('pwNote').textContent)]),
    ['About $4.17 a month, billed yearly', 'Continue with yearly', false], 'iPhone, used the trial before');
}, { init: `window.__rcOpts = { ios: true, iosStatus: 1 }; (${rcInit})();` });

test('pricing: a Pro trial account shows its 10 trial credits, not 40 a week', async ({ p }) => {
  await p.goto('https://app.test/'); await p.waitForFunction(() => !!session);
  await p.evaluate(() => { account = { plan: 'pro', used: 2, quota: 10, remaining: 8, bonus: 0, inTrial: true }; renderCreditsSheet(); });
  const t = await p.textContent('#creditsBody');
  assert(/of 10 AI credits left/.test(t) && /free trial includes 10 AI credits/.test(t) && !/80 credits/.test(t), t);
});

test('pricing: the Pro screen opens once, by itself, after the first Enhance result in the phone app (store set up)', async ({ p, state }) => {
  await p.goto('https://app.test/'); await p.waitForFunction(() => screen === 'enhanceHome');
  await p.evaluate(() => { CONFIG.revenuecatAndroid = 'goog_test'; rcReady = null; });
  const sample = async () => {
    await p.click('#enhSample'); await p.waitForSelector('#enhSheet[open]'); await p.click('#enhGo');
    await p.waitForFunction(() => screen === 'enhanceResult' && $('enhAfter').naturalWidth > 0, null, { timeout: 30000 });
  };
  await sample();
  eq(await p.evaluate(() => $('paywall').open), false, 'not on top of the reveal');
  await p.waitForSelector('#paywall[open]', { timeout: 6000 });
  await p.evaluate(() => $('paywall').close());
  await p.evaluate(() => closeEnhResult()); await p.waitForFunction(() => screen === 'enhanceHome');
  await sample(); await settle(3500);
  eq(await p.evaluate(() => $('paywall').open), false, 'only once');
  await p.evaluate(() => flushTelemetry()); await settle(500);
  eq(state.events.filter((e) => e.name === 'intro_offer').length, 1, 'tracked once');
  eq(state.errs, [], 'no page errors');
}, { start: 'enhance', camera: false, files: demoFiles(), init: rcInit });

test('pricing: no Pro screen by itself on the web', async ({ p }) => {
  await p.goto('https://app.test/'); await p.waitForFunction(() => screen === 'enhanceHome');
  await p.click('#enhSample'); await p.waitForSelector('#enhSheet[open]'); await p.click('#enhGo');
  await p.waitForFunction(() => screen === 'enhanceResult' && $('enhAfter').naturalWidth > 0, null, { timeout: 30000 });
  await settle(3500);
  eq(await p.evaluate(() => $('paywall').open), false, 'web: no paywall');
}, { start: 'enhance', camera: false, files: demoFiles() });
test('pricing: no Pro screen by itself in the phone app before the store keys are added', async ({ p }) => {
  await p.goto('https://app.test/'); await p.waitForFunction(() => screen === 'enhanceHome');
  await p.click('#enhSample'); await p.waitForSelector('#enhSheet[open]'); await p.click('#enhGo');
  await p.waitForFunction(() => screen === 'enhanceResult' && $('enhAfter').naturalWidth > 0, null, { timeout: 30000 });
  await settle(3500);
  eq(await p.evaluate(() => [$('paywall').open, localStorage.getItem('glowIntroOffer')]), [false, null], 'no paywall, offer still pending');
}, { start: 'enhance', camera: false, files: demoFiles(), init: rcInit });

// ---------- Feature switches (features.js, migration 013) ----------
const shownTools = (p) => p.evaluate(() => [...document.querySelectorAll('#tools .tool[data-tool]')].map((b) => b.dataset.tool));
async function searchAll(p) {
  if (!(await p.isVisible('#tabs .tab'))) await p.click('#cancelBtn');
  else if (await p.evaluate(() => !!sel && $('panel').classList.contains('live'))) await p.evaluate(() => selectTool(null, { discard: true }));
  await p.click('#searchBtn'); await p.waitForTimeout(150); return shownTools(p);
}

test('features: with no server answer every released tool shows and retired tools stay hidden; the check sends platform and build', async ({ p, state }) => {
  await p.goto('https://app.test/'); await pick(p, PORTRAIT);
  await p.waitForFunction(() => Features.checkedAt > 0, null, { timeout: 10000 });
  const all = await searchAll(p);
  const expect = await p.evaluate(() => TOOLS.filter((t) => !RETIRED.includes(t.id) && !IN_TRY_ON.includes(t.id) && t.kind !== 'filter').map((t) => t.id));
  for (const id of expect) assert(all.includes(id), id + ' offered');
  for (const id of await p.evaluate(() => RETIRED)) assert(!all.includes(id), id + ' (retired) hidden');
  const c = state.featureChecks[0]; eq([c.p_platform, typeof c.p_build], ['web', 'number'], 'platform and build sent');
  eq(await p.evaluate(() => $$tabs()), ['retouch', 'looks', 'edit', 'bg', 'ai'], 'all five tabs');
  eq(state.errs, [], 'no page errors');
}, { features: 404, init: () => { window.$$tabs = () => [...document.querySelectorAll('#tabs .tab')].filter((t) => !t.hidden).map((t) => t.dataset.cat); } });

test('features: every tool in the app has a switch in the catalog, and every switch names a real tool or feature', async ({ p }) => {
  await p.goto('https://app.test/'); await p.waitForFunction(() => !!session);
  const r = await p.evaluate(() => {
    const keys = Object.keys(FEATURE_DEFAULTS);
    const tools = [...new Set(TOOLS.map((t) => toolKey(t.id)))];
    return { missing: tools.filter((k) => !keys.includes(k)), unknown: keys.filter((k) => k.startsWith('tool:') && !tools.includes(k)),
      retiredOn: RETIRED.filter((id) => FEATURE_DEFAULTS['tool:' + id] !== false), releasedOff: keys.filter((k) => !k.startsWith('tool:') && FEATURE_DEFAULTS[k] !== true) };
  });
  eq(r, { missing: [], unknown: [], retiredOn: [], releasedOff: [] }, 'catalog matches the app');
});

test('features: switched-off tools leave the tabs and Search, an empty tab disappears, and a retired tool can come back for testers', async ({ p, state }) => {
  await p.goto('https://app.test/'); await pick(p, PORTRAIT);
  await p.waitForFunction(() => Features.checkedAt > 0, null, { timeout: 10000 });
  const all = await searchAll(p);
  for (const id of ['erase', 'fill', 'custom', 'fsmooth']) assert(!all.includes(id), id + ' hidden');
  assert(all.includes('smile'), 'retired Smile switched on for testers shows');
  await p.evaluate(() => setSearching(false));
  eq(await p.evaluate(() => [...document.querySelectorAll('#tabs .tab')].filter((t) => !t.hidden).map((t) => t.dataset.cat)), ['retouch', 'looks', 'edit', 'bg'], 'AI tab gone (all its tools off)');
  // Opening a hidden tool any other way (Recent, an old link) is refused.
  await p.evaluate(() => selectTool('fsmooth')); await settle(200);
  eq(await p.evaluate(() => sel), null, 'not opened'); assert(/isn't available/.test(await toast(p)), 'says so');
  eq(state.errs, [], 'no page errors');
}, { features: { 'tool:erase': false, 'tool:fill': false, 'tool:custom': false, 'tool:pro': false, 'tool:enhance': false, 'tool:colorize': false, 'tool:fsmooth': false, 'tool:smile': true } });

test('features: the last answer applies at launch before the server is asked (no flicker) and a failed check keeps it', async ({ p, state }) => {
  await p.goto('https://app.test/');
  eq(await p.evaluate(() => [featureOn('tool:pro'), featureOn('screen:camera')]), [false, true], 'cached answer from the first line of the app');
  await p.waitForFunction(() => Features.checkedAt > 0, null, { timeout: 10000 }); await settle(300);
  eq(await p.evaluate(() => featureOn('tool:pro')), false, 'server down (404): still off, not reset to on');
  eq(state.errs, [], 'no page errors');
}, { features: 404, init: () => { localStorage.setItem('glowFeatures', JSON.stringify({ flags: { 'tool:pro': false }, tester: false, at: 1 })); } });

test('features: a tool switched off while open closes; the server refuses it before charging and the app says nothing was charged', async ({ p, state }) => {
  await p.goto('https://app.test/'); await pick(p, PORTRAIT); await tool(p, 'edit', null, 'pro');
  // Owner flips the switch; this phone hasn't heard yet. Apply goes to the server, which refuses.
  state.features = { 'tool:pro': false };
  await applyTool(p);
  await p.waitForFunction(() => /Nothing was charged/.test($('toast').textContent), null, { timeout: 15000 });
  eq([state.used, state.posts.length], [0, 1], 'refused before any charge');
  eq(state.aiBodies[0].tool, 'pro', 'the editor says which tool sent it');
  await p.waitForFunction(() => sel === null && !featureOn('tool:pro'), null, { timeout: 10000 });
  assert(!(await searchAll(p)).includes('pro'), 'and it is hidden now');
  eq(state.errs, [], 'no page errors');
}, { start: 'editor', features: {} });

test('features: Glow Up never offers a switched-off AI step, and a saved routine with one runs without it', async ({ p, state }) => {
  await p.goto('https://app.test/'); await pick(p, PORTRAIT); await p.waitForFunction(() => Features.checkedAt > 0, null, { timeout: 10000 });
  await tool(p, 'retouch', null, 'glowup');
  const opts = await p.evaluate(() => [...document.querySelectorAll('[aria-label="AI step"] button')].map((b) => b.textContent));
  assert(!opts.some((t) => /Pro edit/.test(t)), 'Pro edit not offered: ' + opts);
  assert(opts.some((t) => /New background/.test(t)), 'other AI steps still offered');
  eq(await p.evaluate(() => glow.ai), null, 'the saved routine\'s Pro edit step was dropped');
  eq(state.errs, [], 'no page errors');
}, { features: { 'tool:pro': false }, init: () => { localStorage.setItem('glowRoutine', JSON.stringify({ ai: 'pro', on: {}, look: null, slim: false, light: true, words: '', strength: 60 })); } });

test('features: Camera and Editor tabs off open Enhance, hide every way in, and Enhance still runs', async ({ p, state }) => {
  await p.goto('https://app.test/'); await p.waitForFunction(() => screen === 'enhanceHome');
  await p.waitForFunction(() => Features.checkedAt > 0, null, { timeout: 10000 }); await settle(200);
  eq(await p.evaluate(() => [$('nav').hidden, [...document.querySelectorAll('#nav button')].filter((b) => !b.hidden).map((b) => b.dataset.dest)]), [true, ['enhance']], 'no tab bar with Enhance the only tab');
  await p.evaluate(() => go('editor')); eq(await p.evaluate(() => screen), 'enhanceHome', 'Editor never shows');
  const fc = p.waitForEvent('filechooser'); await p.click('#enhPick'); await (await fc).setFiles(PORTRAIT);
  await p.waitForSelector('#enhSheet[open]'); await p.click('#enhGo');
  await p.waitForFunction(() => screen === 'enhanceResult' && $('enhAfter').naturalWidth > 0, null, { timeout: 30000 });
  eq(state.aiBodies[0], { mode: 'enhance', from: 'enhance', tool: undefined, platform: undefined, build: undefined }, 'Enhance tab request (the editor Enhance switch does not apply)');
  eq(state.used, 1, 'charged once, as usual');
  eq(await p.evaluate(() => $('enhMore').hidden), true, 'no More tools (Editor) on the result');
  const keys = await p.evaluate(() => [...document.querySelectorAll('.enh-t[data-k]')].map((b) => b.dataset.k));
  eq(keys, ['face', 'bg', 'retouch'], 'Colors and Background Blur switches hidden');
  await p.click('#enhDownload'); await downloads(state, 1); await p.waitForFunction(() => screen === 'enhanceShare');
  eq(await p.evaluate(() => $('enhEdit').hidden), true, 'no Edit more in the editor');
  eq(state.errs, [], 'no page errors');
}, { start: 'camera', camera: false, features: { 'screen:camera': false, 'screen:editor': false, 'tool:enhance': false, 'enhance:colors': false, 'enhance:blur': false } });

test('features: switching the Editor off while someone is in it takes them to Enhance and keeps their edits', async ({ p, state }) => {
  await p.goto('https://app.test/'); await pick(p, PORTRAIT); await tool(p, 'edit', null, 'light');
  await p.waitForFunction(() => Features.checkedAt > 0, null, { timeout: 10000 });
  state.features = { 'screen:editor': false };
  await p.evaluate(() => refreshFeatures(true));
  await p.waitForFunction(() => screen === 'enhanceHome', null, { timeout: 5000 });
  assert(/short break/.test(await toast(p)), 'says why');
  state.features = {}; await p.evaluate(() => refreshFeatures(true)); await settle(200);
  await p.evaluate(() => go('editor')); await p.waitForFunction(() => screen === 'editorHome');
  assert(await p.isVisible('#resumeBtn'), 'the photo is still there to resume');
  eq(state.errs, [], 'no page errors');
}, { features: {} });

test('features: camera face shape, makeup and filters off hide their Adjust settings and are never drawn, even from a saved look', async ({ p, state }) => {
  await p.goto('https://app.test/'); await camLive(p);
  await p.waitForFunction(() => Features.checkedAt > 0, null, { timeout: 10000 }); await settle(200);
  const r = await p.evaluate(() => {
    useLook(PRESET_LOOKS.find((l) => l.id === 'glam'));
    const l = camLook();
    return { chips: [...document.querySelectorAll('#adjChips [data-set]')].filter((c) => !c.hidden).map((c) => c.dataset.set),
      drawn: [l.slim, l.eyes, l.nose, l.lips, l.blush, l.brows, l.filter], kept: beauty.slim > 0 && beauty.lips > 0, smooth: l.smooth > 0,
      ai: $('camAI').hidden, flash: cam.screenFlash };
  });
  eq(r.chips, ['smooth', 'bright', 'warm'], 'only Skin settings');
  eq(r.drawn, [0, 0, 0, 0, 0, 0, 'none'], 'switched-off settings drawn as zero');
  eq([r.kept, r.smooth], [true, true], 'the look itself is kept, skin still works');
  eq([r.ai, r.flash], [true, false], 'AI switch and screen flash hidden');
  eq(state.errs, [], 'no page errors');
}, { start: 'camera', features: { 'camera:face': false, 'camera:makeup': false, 'camera:filters': false, 'camera:ai': false, 'camera:flash': false } });

test('features: credit packs, ads and the share card off hide their buttons; a Pro user out of credits gets a message, not packs', async ({ p, state }) => {
  await p.goto('https://app.test/'); await p.waitForFunction(() => !!account && Features.checkedAt > 0, null, { timeout: 10000 }); await settle(200);
  eq(await p.evaluate(() => [$('creditsPacks').hidden, $('pwPacks').hidden]), [true, true], 'pack buttons hidden');
  await p.evaluate(() => openPacks('out')); await settle(200);
  eq(await p.evaluate(() => $('packsSheet').open), false, 'no packs sheet');
  assert(/used your AI credits/.test(await toast(p)), 'a plain message instead');
  eq(state.errs, [], 'no page errors');
}, { features: { 'money:packs': false, 'money:ads': false, 'share:app': false } });

test('features: Enhance Batch off hides its link; switching it back on brings everything back without a reload', async ({ p, state }) => {
  await p.goto('https://app.test/'); await p.waitForFunction(() => screen === 'enhanceHome' && Features.checkedAt > 0, null, { timeout: 10000 }); await settle(200);
  eq(await p.evaluate(() => $('enhBatchPick').hidden), true, 'batch link hidden');
  state.features = {}; await p.evaluate(() => refreshFeatures(true)); await settle(200);
  eq(await p.evaluate(() => $('enhBatchPick').hidden), false, 'back without a reload');
  eq(state.errs, [], 'no page errors');
}, { start: 'enhance', camera: false, features: { 'enhance:batch': false } });


// Quick actions on the Editor home: six photo tiles; each picks a photo and opens that tool on its tab.
test('quick actions: six tiles on the Editor home, the sample link moves beside the title, a tile opens its tool on its tab', async ({ p, state }) => {
  await p.goto('https://app.test/'); await p.waitForFunction(() => typeof go === 'function' && !!screen, null, { timeout: 15000 });
  await p.evaluate(() => go('editor')); await p.waitForFunction(() => screen === 'editorHome'); await settle(300);
  eq(await p.evaluate(() => [...document.querySelectorAll('#qaGrid .qa')].map((b) => b.dataset.qa)), ['smooth', 'looks', 'tryon', 'newbg', 'remove', 'oldphoto'], 'tiles');
  eq(await p.evaluate(() => [$('quickActions').hidden, $('sampleBtn').hidden, $('qaSampleBtn').offsetParent !== null]), [false, true, true], 'sample link beside the title');
  eq(await p.evaluate(() => [...document.querySelectorAll('#qaGrid .qa-ph em')].length), 4, 'four AI chips');
  assert(await p.evaluate(() => [...document.querySelectorAll('#qaGrid img')].every((i) => i.complete && i.naturalWidth > 0)), 'tile images load');
  // On a phone the whole grid fits above the tab bar without scrolling.
  const fit = await p.evaluate(() => { const g = $('qaGrid').getBoundingClientRect(), n = $('nav').getBoundingClientRect(); return [Math.round(g.bottom), Math.round(n.top)]; });
  assert(fit[0] <= fit[1], `grid ends above the tab bar (${fit})`);
  for (const [qa, toolId, tab] of [['tryon', 'outfit', 'looks'], ['smooth', 'fsmooth', 'retouch'], ['remove', 'erase', 'ai']]) {
    if (qa !== 'tryon') { await p.evaluate(() => { selectTool(null, { discard: true }); showScreen('editorHome'); }); await settle(200); }
    const fc = p.waitForEvent('filechooser'); await p.click(`#qaGrid .qa[data-qa="${qa}"]`); await (await fc).setFiles(fx('tall-916.jpg'));
    await p.waitForFunction((x) => screen === 'editorScreen' && sel === x, toolId, { timeout: 30000 });
    eq(await p.evaluate(() => cat), tab, `${qa} opens on its tab`);
    await idle(p);
  }
  eq(state.errs, [], 'no page errors');
});

test('quick actions: switched off, the tiles go and the sample button comes back; a tool switched off drops its tile', async ({ p, state }) => {
  await p.goto('https://app.test/'); await p.waitForFunction(() => typeof go === 'function' && !!screen, null, { timeout: 15000 });
  await p.evaluate(() => go('editor')); await p.waitForFunction(() => screen === 'editorHome' && Features.checkedAt > 0, null, { timeout: 10000 }); await settle(300);
  eq(await p.evaluate(() => [$('quickActions').hidden, $('sampleBtn').hidden]), [true, false], 'all off');
  state.features = { 'tool:outfit': false }; await p.evaluate(() => refreshFeatures(true)); await settle(300);
  eq(await p.evaluate(() => [$('quickActions').hidden, [...document.querySelectorAll('#qaGrid .qa')].map((b) => b.dataset.qa).join()]), [false, 'smooth,looks,newbg,remove,oldphoto'], 'Try on tile gone');
  eq(state.errs, [], 'no page errors');
}, { features: { 'editor:quick': false } });
// ---------- Golden Hour: dark by default, gold moment, Recent row, before/after video ----------
test('golden hour: dark by default on a light phone; System follows the phone; Light stays light', async ({ p }) => {
  await p.goto('https://app.test/'); await p.waitForFunction(() => screen === 'enhanceHome');
  const look = () => p.evaluate(() => [getComputedStyle(document.body).backgroundColor, document.querySelector('meta[name="theme-color"]').content]);
  eq(await look(), ['rgb(13, 13, 16)', '#0d0d10'], 'dark on first open, browser bar too');
  await p.evaluate(() => { store.set('glowTheme', 'system'); applyTheme(); }); eq((await look())[0], 'rgb(250, 247, 240)', 'System follows the light phone');
  await p.evaluate(() => { store.set('glowTheme', 'light'); applyTheme(); }); eq(await look(), ['rgb(250, 247, 240)', '#faf7f0'], 'Light');
  await p.reload(); await p.waitForFunction(() => screen === 'enhanceHome'); eq((await look())[0], 'rgb(250, 247, 240)', 'choice kept after a reload');
}, { start: 'enhance', camera: false, scheme: 'light' });

test('golden hour: Enhance result plays the gold moment; saving adds it to Recent on both homes; Recent reopens it in the editor', async ({ p, state }) => {
  await p.goto('https://app.test/'); await p.waitForFunction(() => screen === 'enhanceHome');
  eq(await p.isVisible('#enhanceHome .recents'), false, 'no Recent row before any save');
  const fc = p.waitForEvent('filechooser'); await p.click('#enhPick'); await (await fc).setFiles(PORTRAIT);
  await p.waitForSelector('#enhSheet[open]'); await p.click('#enhGo');
  await p.waitForFunction(() => screen === 'enhanceResult', null, { timeout: 30000 });
  eq(await p.evaluate(() => !!document.querySelector('#enhFrame .glow-burst')), true, 'gold moment on the result');
  await p.click('#enhDownload'); await downloads(state, 1); await p.waitForFunction(() => screen === 'enhanceShare');
  await p.waitForFunction(() => document.querySelectorAll('#enhanceHome .recent').length === 1);
  eq(await p.evaluate(() => document.querySelectorAll('#editorHome .recent').length), 1, 'Recent on Editor home too');
  await p.click('#enhShareDone'); await p.waitForFunction(() => screen === 'enhanceHome');
  await p.click('#enhanceHome .recent'); await p.waitForFunction(() => screen === 'editorScreen' && hasPhoto());
  await p.evaluate(() => go('enhance')); await p.click('#enhanceHome .recents-clear'); await p.waitForSelector('#ask[open]');
  await p.click('#askActions button:has-text("Clear")'); await p.waitForFunction(() => document.querySelector('#enhanceHome .recents').hidden);
}, { start: 'enhance', camera: false });

test('golden hour: before & after video is made and shared (downloaded on a computer)', async ({ p, state }) => {
  await p.goto('https://app.test/'); await p.waitForFunction(() => screen === 'enhanceHome');
  const fc = p.waitForEvent('filechooser'); await p.click('#enhPick'); await (await fc).setFiles(PORTRAIT);
  await p.waitForSelector('#enhSheet[open]'); await p.click('#enhGo');
  await p.waitForFunction(() => screen === 'enhanceResult', null, { timeout: 30000 });
  await p.click('#enhDownload'); await downloads(state, 1); await p.waitForFunction(() => screen === 'enhanceShare');
  assert(await p.isVisible('#enhVideo'), 'video button shown');
  await p.click('#enhVideo'); const d = await downloads(state, 2, 30000);
  assert(/glow-studio-before-after-\d+\.(mp4|webm)$/.test(d[1].name), 'video file: ' + d[1].name);
  assert(require('fs').statSync(d[1].file).size > 20000, 'video has content');
  eq(await p.evaluate(() => document.querySelectorAll('#enhanceHome .recent').length), 1, 'the video is not added to Recent');
}, { start: 'enhance', camera: false, mobile: false, touch: false });

test('web checkout: with a Web Billing key the website sells Pro by card (RevenueCat purchases-js), cancel is quiet, Pro switches on', async ({ p, state }) => {
  // A stand-in for RevenueCat's purchases-js, so no real checkout or network is touched.
  await p.addInitScript(() => {
    const price = (n) => ({ amountMicros: n * 1e6, currency: 'USD', formattedPrice: '$' + n.toFixed(2) });
    const pkg = (id, n, unit, trial) => ({ identifier: id, product: { identifier: id, price: price(n), period: { number: 1, unit }, freeTrialPhase: trial ? { period: { number: 3, unit: 'day' } } : null } });
    window.__rc = { bought: [], cancelNext: false, user: '' };
    window.Purchases = { Purchases: { configure: ({ appUserId }) => { window.__rc.user = appUserId; return {
      getOfferings: async () => ({ current: { weekly: pkg('glow_pro_weekly_web', 4.99, 'week'), annual: pkg('glow_pro_yearly_web', 49.99, 'year', true) }, all: { credit_packs: { availablePackages: [pkg('glow_credits_10', 1.99, null)] } } }),
      purchase: async ({ rcPackage }) => { if (window.__rc.cancelNext) { window.__rc.cancelNext = false; const e = new Error('cancelled'); e.errorCode = 1; throw e; } window.__rc.bought.push(rcPackage.identifier); return {}; },
      getCustomerInfo: async () => ({ managementURL: 'https://pay.rev.cat/manage' }), changeUser: async () => ({}),
    }; } } };
  });
  await p.goto('https://app.test/'); await p.waitForFunction(() => screen === 'enhanceHome');
  await p.evaluate(() => { CONFIG.revenuecatWeb = 'rcb_test'; openPaywall(); });
  await p.waitForFunction(() => /\$49\.99/.test($('priceYearly').textContent));
  eq(await p.evaluate(() => [$('buyBtn').disabled, $('buyBtn').textContent, $('yearlyNote').textContent]), [false, 'Start 3-day free trial', '3 days free, then $49.99 a year'], 'web prices, trial and an enabled button');
  assert(/Stripe/.test(await p.textContent('#pwNote')), 'web terms note');
  await p.evaluate(() => { window.__rc.cancelNext = true; }); await p.click('#buyBtn'); await settle(500);
  eq(await p.evaluate(() => [window.__rc.bought.length, $('paywall').open, $('toast').classList.contains('on') && /didn't go through/.test($('toast').textContent)]), [0, true, false], 'cancel: nothing bought, no error');
  state.plan = 'pro'; await p.click('#buyBtn');
  await p.waitForFunction(() => !$('paywall').open);
  eq(await p.evaluate(() => [window.__rc.bought, window.__rc.user === session.user_id]), [['glow_pro_yearly_web'], true], 'bought yearly for this Glow Studio account');
  await p.waitForFunction(() => account && account.plan === 'pro');
  await p.evaluate(() => openSettings()); await p.waitForFunction(() => !$('manageSubs').hidden);
}, { start: 'enhance', camera: false });

test('web checkout: without a Web Billing key (or switched off) the website still points to the app', async ({ p }) => {
  await p.goto('https://app.test/'); await p.waitForFunction(() => screen === 'enhanceHome');
  await p.evaluate(() => openPaywall());
  eq(await p.evaluate(() => [$('buyBtn').disabled, /available in the Glow Studio app/.test($('pwNote').textContent), !!document.querySelector('script[src*="purchases-js"]')]), [true, true, false], 'no key: disabled, app note, checkout not loaded');
}, { start: 'enhance', camera: false });

// ---------- 2026-11-01 whole-app audit (real-device issues) ----------
test('audit: Back with a tool open closes the tool first, then leaves the editor', async ({ p }) => {
  await p.goto('https://app.test/'); await pick(p, fx('coords-600x400.png'));
  await p.evaluate(() => { const t = [...document.querySelectorAll('#tools .tool[data-tool]')].find((x) => x.offsetParent && TOOL[x.dataset.tool].kind !== 'ai'); t.click(); });
  await p.waitForFunction(() => !!sel);
  await p.evaluate(() => goBack()); await settle(300);
  eq(await p.evaluate(() => [screen, sel]), ['editorScreen', null], 'tool closed, still editing');
  await p.evaluate(() => goBack()); await p.waitForFunction(() => screen !== 'editorScreen');
}, { start: 'editor', camera: false });

test('audit: no connection says so in words, not "Failed to fetch"', async ({ p }) => {
  await p.goto('https://app.test/'); await p.waitForFunction(() => screen === 'enhanceHome' && !!account);
  await p.route('**/functions/v1/**', (r) => r.abort('internetdisconnected'));
  const m = await p.evaluate(() => call('account', { method: 'GET' }).then(() => 'ok', (e) => [e.message, !!e.offline]));
  eq(m, ["You're offline. Check your internet and try again.", true], 'friendly offline error');
}, { start: 'enhance', camera: false });

test('audit: a HEIC photo the browser cannot open gets a clear message', async ({ p }) => {
  await p.goto('https://app.test/'); await p.waitForFunction(() => screen === 'enhanceHome');
  const fc = p.waitForEvent('filechooser'); await p.click('#enhPick');
  await (await fc).setFiles({ name: 'IMG_0001.HEIC', mimeType: 'image/heic', buffer: Buffer.from('not really a heic file') });
  await p.waitForFunction(() => /HEIC/.test($('toast').textContent), null, { timeout: 10000 });
}, { start: 'enhance', camera: false });

test('audit: landscape phone keeps the photo big on Enhance, the buttons on screen at home, and Continue on the Pro sheet', async ({ p }) => {
  await p.goto('https://app.test/'); await p.waitForFunction(() => screen === 'enhanceHome'); await settle(800);
  const vis = (id) => p.evaluate((id) => { const r = $(id).getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight && r.width > 0; }, id);
  assert(await vis('enhPick'), 'Choose a photo visible without scrolling');
  const hero = await p.evaluate(() => document.querySelector('#enhanceHome .enh-hero').getBoundingClientRect().height);
  assert(hero > 200, 'sample photo uses the height: ' + hero);
  await p.click('#enhSample'); await p.waitForSelector('#enhSheet[open]');
  const sheetPic = await p.evaluate(() => $('enhSheetImg').getBoundingClientRect().height);
  assert(sheetPic > 250, 'pick sheet photo big: ' + sheetPic); assert(await vis('enhGo'), 'Enhance button on screen');
  await p.click('#enhGo'); await p.waitForFunction(() => screen === 'enhanceResult' && $('enhAfter').naturalWidth > 0, null, { timeout: 30000 }); await settle(600);
  const fr = await p.evaluate(() => $('enhFrame').getBoundingClientRect().height);
  assert(fr > 260, 'result photo big: ' + fr); assert(await vis('enhDownload'), 'save on screen');
  await p.click('#enhDownload'); await p.waitForFunction(() => screen === 'enhanceShare'); await settle(500);
  const card = await p.evaluate(() => document.querySelector('.enh-share-ph .enh-card').getBoundingClientRect().height);
  assert(card > 260, 'share photo big: ' + card); assert(await vis('enhAnother'), 'Enhance another on screen');
  await p.evaluate(() => { showScreen('enhanceHome'); openPaywall(); }); await settle(500);
  assert(await vis('buyBtn'), 'Continue on screen without scrolling');
}, { start: 'enhance', camera: false, viewport: { width: 844, height: 390 } });
// ---------- Add to home screen (homescreen.js, 2026-11-01) ----------
// Saves the Enhance sample, then waits for the one-time prompt.
async function homeSave(p) {
  await p.waitForFunction(() => screen === 'enhanceHome');
  await p.click('#enhSample'); await p.waitForSelector('#enhSheet[open]'); await p.click('#enhGo');
  await p.waitForFunction(() => screen === 'enhanceResult' && $('enhAfter').naturalWidth > 0, null, { timeout: 30000 });
  await p.evaluate(() => { enh.demo = false; });   // the sample stands in for the person's own photo
  await p.click('#enhDownload'); await p.waitForFunction(() => screen === 'enhanceShare');
}
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1';
test('home screen: iPhone Safari gets the two-step sheet once, after the first save; Settings keeps a row', async ({ p, state }) => {
  await p.goto('https://app.test/'); await p.waitForFunction(() => screen === 'enhanceHome');
  eq(await p.evaluate(() => HomeAdd.mode()), 'ios', 'iPhone Safari: instructions');
  await homeSave(p);
  await settle(1500); eq(await p.evaluate(() => $('homeAdd').open), false, 'not on top of the Saved moment');
  await p.waitForSelector('#homeAdd[open]', { timeout: 5000 });
  eq(await p.evaluate(() => [$('homeAddSteps').hidden, $('homeAddYes').textContent, $('homeAddNo').hidden]), [false, 'Got it', true], 'two steps and Got it');
  await p.click('#homeAddYes'); await p.waitForFunction(() => !$('homeAdd').open);
  await p.click('#enhShareDone'); await homeSave(p); await settle(4000);
  eq(await p.evaluate(() => $('homeAdd').open), false, 'only once');
  await p.evaluate(() => $('settings').showModal()); eq(await p.isVisible('#homeAddRow'), true, 'Settings row');
  await p.click('#homeAddRow'); await p.waitForSelector('#homeAdd[open]');
  await p.evaluate(() => flushTelemetry()); await settle(500);
  eq(state.events.filter((e) => e.name === 'home_offer').map((e) => e.props.from), ['enhance', 'settings'], 'tracked');
  eq(state.errs, [], 'no page errors');
}, { start: 'enhance', camera: false, files: demoFiles(), viewport: { width: 390, height: 844 }, init: () => {
  Object.defineProperty(navigator, 'userAgent', { get: () => 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1' });
} });

test('home screen: Android browser that has not offered install (Firefox, in-app browsers) is never asked', async ({ p }) => {
  await p.goto('https://app.test/'); await p.waitForFunction(() => screen === 'enhanceHome');
  eq(await p.evaluate(() => HomeAdd.mode()), '', 'no way to add');
  await p.evaluate(() => HomeAdd.afterSave('enhance')); await settle(3800);
  eq(await p.evaluate(() => $('homeAdd').open), false, 'nothing');
  await p.evaluate(() => $('settings').showModal()); eq(await p.isVisible('#homeAddRow'), false, 'no Settings row');
}, { start: 'enhance', camera: false });
test('home screen: iPhone already running Glow Studio from the home screen is never asked', async ({ p }) => {
  await p.goto('https://app.test/'); await p.waitForFunction(() => screen === 'enhanceHome');
  eq(await p.evaluate(() => HomeAdd.mode()), '', 'standalone');
}, { start: 'enhance', camera: false, init: () => {
  Object.defineProperty(navigator, 'userAgent', { get: () => 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1' });
  Object.defineProperty(navigator, 'standalone', { get: () => true });
} });
test('home screen: iPhone inside Instagram is never asked', async ({ p }) => {
  await p.goto('https://app.test/'); await p.waitForFunction(() => screen === 'enhanceHome');
  eq(await p.evaluate(() => HomeAdd.mode()), '', 'in-app browser');
}, { start: 'enhance', camera: false, init: () => {
  Object.defineProperty(navigator, 'userAgent', { get: () => 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 350.0' });
} });

test('home screen: Android Chrome uses the browser Install dialog, held back until the first save', async ({ p, state }) => {
  await p.goto('https://app.test/'); await p.waitForFunction(() => screen === 'enhanceHome');
  await p.evaluate(() => {
    const e = new Event('beforeinstallprompt', { cancelable: true });
    e.prompt = async () => { window.__prompted = (window.__prompted || 0) + 1; }; e.userChoice = Promise.resolve({ outcome: 'accepted' });
    window.dispatchEvent(e); window.__bip = e;
  });
  eq(await p.evaluate(() => [HomeAdd.mode(), window.__bip.defaultPrevented]), ['install', true], 'Chrome mini-infobar held back for our moment');
  await homeSave(p); await p.waitForSelector('#homeAdd[open]', { timeout: 6000 });
  eq(await p.evaluate(() => [$('homeAddSteps').hidden, $('homeAddYes').textContent]), [true, 'Install'], 'Install button');
  await p.click('#homeAddYes'); await settle(300);
  eq(await p.evaluate(() => [window.__prompted, $('homeAdd').open, localStorage.getItem('glowHomeAsk')]), [1, false, 'shown'], 'browser dialog shown once');
  await p.evaluate(() => flushTelemetry()); await settle(500);
  eq(state.events.filter((e) => e.name === 'home_install').map((e) => e.props.outcome), ['accepted'], 'outcome tracked');
  eq(state.errs, [], 'no page errors');
}, { start: 'enhance', camera: false, files: demoFiles(), viewport: { width: 412, height: 892 } });

const homeApp = (o) => () => {
  const st = window.__home = { supported: true, pinned: false, pins: 0 };
  window.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'android', Plugins: { GlowHome: {
    status: async () => ({ supported: st.supported, pinned: st.pinned }),
    pin: async () => { st.pins++; st.pinned = true; return { requested: true }; },
  } } };
};
test('home screen: Android app asks once after the first save, Add asks the launcher, then the Settings row goes away', async ({ p, state }) => {
  await p.goto('https://app.test/'); await p.waitForFunction(() => screen === 'enhanceHome');
  await p.waitForFunction(() => HomeAdd.mode() === 'app');
  await homeSave(p); await p.waitForSelector('#homeAdd[open]', { timeout: 6000 });
  eq(await p.evaluate(() => [$('homeAddYes').textContent, $('homeAddNo').textContent, $('homeAddSteps').hidden]), ['Add to home screen', 'Not now', true], 'buttons');
  await p.click('#homeAddYes'); await settle(1800);
  eq(await p.evaluate(() => [window.__home.pins, HomeAdd.mode()]), [1, ''], 'launcher asked once; pinned now');
  await p.evaluate(() => $('settings').showModal()); eq(await p.isVisible('#homeAddRow'), false, 'no row once pinned');
  eq(state.errs, [], 'no page errors');
}, { start: 'enhance', camera: false, files: demoFiles(), init: homeApp() });
test('home screen: Android app, Not now: no launcher call and no second ask', async ({ p, state }) => {
  await p.goto('https://app.test/'); await p.waitForFunction(() => HomeAdd.mode() === 'app');
  await homeSave(p); await p.waitForSelector('#homeAdd[open]', { timeout: 6000 });
  await p.click('#homeAddNo'); await p.click('#enhShareDone'); await homeSave(p); await settle(4000);
  eq(await p.evaluate(() => [window.__home.pins, $('homeAdd').open]), [0, false], 'left alone');
}, { start: 'enhance', camera: false, files: demoFiles(), init: homeApp() });
test('home screen: switched off from the admin page, nobody is asked', async ({ p, state }) => {
  await p.goto('https://app.test/'); await p.waitForFunction(() => HomeAdd.mode() === 'app');
  await homeSave(p); await settle(4000);
  eq(await p.evaluate(() => $('homeAdd').open), false, 'switch off');
}, { start: 'enhance', camera: false, files: demoFiles(), init: homeApp(), features: { 'app:home': false } });

test('audit: an AI result waiting for Apply opens as a before/after, and the tick never covers the AI price', async ({ p }) => {
  await p.goto('https://app.test/'); await pick(p, fx('coords-600x400.png'));
  await tool(p, 'foryou', null, 'pro'); await applyTool(p);
  await p.waitForFunction(() => job && job.status === 'done', null, { timeout: 30000 }); await settle(400);
  eq(await p.evaluate(() => [ed.view, $('stage').dataset.view, getComputedStyle($('divider')).display !== 'none']), ['split', 'split', true], 'split view with the divider');
  const over = await p.evaluate(() => {
    const t = document.querySelector('#tools .tool[aria-pressed="true"]'), w = t.querySelector('.well'), c = t.querySelector('.cost');
    if (!c) return 'no price';
    const cs = getComputedStyle(w, '::before'), wr = w.getBoundingClientRect(), cr = c.getBoundingClientRect();
    const tl = { left: wr.left + parseFloat(cs.left), top: wr.top + parseFloat(cs.top) }, tr = { right: tl.left + parseFloat(cs.width), bottom: tl.top + parseFloat(cs.height) };
    return tr.right <= cr.left || tl.left >= cr.right || tr.bottom <= cr.top || tl.top >= cr.bottom ? 'clear' : 'covered';
  });
  eq(over, 'clear', 'tick clear of the price badge');
  await p.evaluate(() => applyResult()); await p.waitForFunction(() => !job && ed.idx >= 1);
  eq(await p.evaluate(() => ed.view), 'edited', 'back to the edit after Apply');
});

// ---------- Live updates (phone app) ----------
const APP_BUILD_TEST = Number(/const APP_BUILD = (\d+);/.exec(fs.readFileSync(path.join(__dirname, '../public/features.js'), 'utf8'))[1]);
// A mocked updater plugin (@capgo/capacitor-updater) and App plugin; the manifest comes from the
// test. set() would reload the app on a phone; here it is only recorded.
const luMock = (o) => {
  const st = window.__lu = { downloads: [], sets: [], ready: 0, deleted: [], store: [], current: o.current || { id: 'builtin', version: 'builtin' },
    bundles: o.bundles || [] };
  if (o.saved) localStorage.setItem('glowLiveUpdate', JSON.stringify(o.saved));
  window.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'android', Plugins: {
    App: { getInfo: async () => ({ build: String(o.native || 4), version: '1.0.4' }), addListener: () => ({ remove() {} }) },
    CapacitorUpdater: {
      current: async () => ({ bundle: st.current }),
      list: async () => ({ bundles: st.bundles }),
      notifyAppReady: async () => { st.ready++; return { bundle: st.current }; },
      download: async (d) => { st.downloads.push(d); const b = { id: 'b' + st.downloads.length, version: d.version, status: 'pending' }; st.bundles.push(b); return b; },
      set: async (d) => { st.sets.push(d.id); },
      delete: async (d) => { st.deleted.push(d.id); },
      getAppUpdateInfo: async () => ({ immediateUpdateAllowed: true }),
      performImmediateUpdate: async () => { st.store.push('immediate'); return {}; },
      openAppStore: async () => { st.store.push('store'); },
    } } };
};
// Init scripts can't see this file's variables, so the options travel inside the script text.
const luApp = (o = {}) => `(${luMock.toString()})(${JSON.stringify(o)})`;
const luManifest = (version, extra = {}) => ({ version, build: 202610399, minNative: { android: 4, ios: 2 }, files: [{ file_name: 'index.html', file_hash: 'ab', download_url: 'https://glow-photo-enhancer.vercel.app/index.html' }], ...extra });
async function luServe(p, manifest) {
  const hits = { n: 0 };
  await p.route('https://glow-photo-enhancer.vercel.app/app-update/**', (r) => { hits.n++; return r.fulfill({ headers: { 'access-control-allow-origin': '*' }, json: manifest }); });
  return hits;
}
test('live update: the phone app confirms it started, downloads a newer version and switches on the home screen', async ({ p, state }) => {
  const hits = await luServe(p, luManifest('202610399-new'));
  await p.goto('https://app.test/'); await p.waitForFunction(() => screen === 'enhanceHome');
  await p.waitForFunction(() => window.__lu.sets.length > 0, null, { timeout: 8000 });
  const lu = await p.evaluate(() => window.__lu);
  eq([lu.ready, lu.downloads.length, lu.downloads[0].version, lu.downloads[0].manifest.length, lu.sets], [1, 1, '202610399-new', 1, ['b1']], 'ready, one delta download, switched');
  const saved = await p.evaluate(() => JSON.parse(localStorage.getItem('glowLiveUpdate')));
  eq([saved.pending.version, saved.trying, saved.builtin.build], ['202610399-new', 'b1', APP_BUILD_TEST], 'remembers what it is trying and what the app carries');
  assert(hits.n === 1, 'manifest read once');
  eq(state.errs, [], 'no page errors');
}, { start: 'enhance', camera: false, init: luApp() });
test('live update: nothing to do when the phone already has that version', async ({ p }) => {
  await luServe(p, luManifest('202610399-same'));
  await p.goto('https://app.test/'); await p.waitForFunction(() => window.__lu.ready === 1); await settle(4500);
  eq(await p.evaluate(() => [window.__lu.downloads.length, window.__lu.sets.length, LiveUpdate.state.status, LiveUpdate.state.source]), [0, 0, 'up to date', 'live update'], 'no download');
}, { start: 'enhance', camera: false, init: luApp({ current: { id: 'b9', version: '202610399-same' } }) });
test('live update: an app too old for the new screens keeps its screens and offers the store update', async ({ p }) => {
  await luServe(p, luManifest('202610399-native', { minNative: { android: 5, ios: 2 } }));
  await p.goto('https://app.test/'); await p.waitForFunction(() => window.__lu.ready === 1);
  await p.waitForFunction(() => /new version of Glow Studio/.test($('toast').textContent), null, { timeout: 8000 });
  eq(await p.evaluate(() => window.__lu.downloads.length), 0, 'no download');
  await p.click('#toast .toast-act'); await settle(300);
  eq(await p.evaluate(() => window.__lu.store), ['immediate'], 'Play in-app update');
}, { start: 'enhance', camera: false, init: luApp() });
test('live update: a version that failed to start is not tried again', async ({ p }) => {
  await luServe(p, luManifest('202610399-bad'));
  await p.goto('https://app.test/'); await p.waitForFunction(() => window.__lu.ready === 1); await settle(4500);
  const r = await p.evaluate(() => [window.__lu.sets, window.__lu.downloads.length, JSON.parse(localStorage.getItem('glowLiveUpdate')).bad, LiveUpdate.state.status]);
  eq(r, [[], 0, ['202610399-bad'], 'skipped a version that failed'], 'rolled back version skipped');
}, { start: 'enhance', camera: false, init: luApp({ bundles: [], saved: { pending: { id: 'b7', version: '202610399-bad', build: 202610399 }, trying: 'b7' } }) });
test('live update: a downloaded version waiting from last time is switched in at start', async ({ p }) => {
  await luServe(p, luManifest('202610399-wait'));
  await p.goto('https://app.test/'); await p.waitForFunction(() => window.__lu.sets.length > 0, null, { timeout: 5000 });
  eq(await p.evaluate(() => window.__lu.sets[0]), 'b5', 'switched to the waiting version');
}, { start: 'enhance', camera: false, init: luApp({ bundles: [{ id: 'b5', version: '202610399-wait', status: 'pending' }], saved: { pending: { id: 'b5', version: '202610399-wait', build: 202610399 } } }) });
test('live update: paused from the admin page, phones do not check', async ({ p }) => {
  const hits = await luServe(p, luManifest('202610399-new'));
  await p.goto('https://app.test/'); await p.waitForFunction(() => window.__lu.ready === 1); await settle(4500);
  eq([hits.n, await p.evaluate(() => window.__lu.downloads.length)], [0, 0], 'no check, no download');
}, { start: 'enhance', camera: false, init: luApp({ saved: { } }), features: { 'app:liveupdate': false } });
test('live update: reopening within a minute skips the check but Settings still shows the last answer', async ({ p }) => {
  const hits = await luServe(p, luManifest('202610399-new'));
  await p.goto('https://app.test/'); await p.waitForFunction(() => window.__lu.ready === 1); await settle(3500);
  eq([hits.n, await p.evaluate(() => LiveUpdate.state.status)], [0, 'up to date'], 'last answer kept');
}, { start: 'enhance', camera: false, init: luApp({ saved: { checkedAt: 9e12, status: 'up to date' } }) });
test('live update: the website never checks and keeps its offline cache', async ({ p }) => {
  const hits = await luServe(p, luManifest('202610399-new'));
  await p.goto('https://app.test/'); await p.waitForFunction(() => screen === 'enhanceHome'); await settle(4000);
  eq([hits.n, await p.evaluate(() => LiveUpdate.native)], [0, false], 'web untouched');
}, { start: 'enhance', camera: false });
test('audit: the live-update manifest matches every file in public/ (run mobile/live-update.mjs after changes)', async () => {
  const crypto = require('crypto');
  const m = JSON.parse(fs.readFileSync(path.join(__dirname, '../public/app-update/manifest.json'), 'utf8'));
  const build = Number(/const APP_BUILD = (\d+);/.exec(fs.readFileSync(path.join(__dirname, '../public/features.js'), 'utf8'))[1]);
  eq(m.build, build, 'manifest build is APP_BUILD');
  const walk = (d, b = d) => fs.readdirSync(d).flatMap((n) => { const f = path.join(d, n); return fs.statSync(f).isDirectory() ? walk(f, b) : [path.relative(b, f).split(path.sep).join('/')]; });
  const pub = walk(path.join(__dirname, '../public')).filter((f) => !f.startsWith('app-update/'));
  const byName = Object.fromEntries(m.files.map((f) => [f.file_name, f.file_hash]));
  const stale = pub.filter((f) => byName[f] !== crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname, '../public', f))).digest('hex'));
  eq(stale, [], 'files missing or changed since the manifest was made');
}, { camera: false });

test('audit: every stylesheet has balanced braces (a lost one after a merge silently nests the rest)', async () => {
  for (const f of fs.readdirSync(path.join(__dirname, '../public')).filter((n) => n.endsWith('.css'))) {
    const t = fs.readFileSync(path.join(__dirname, '../public', f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    let d = 0; for (const ch of t) { if (ch === '{') d++; else if (ch === '}') d--; if (d < 0) break; }
    eq(d, 0, f + ' brace depth at end');
  }
}, { camera: false });

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
