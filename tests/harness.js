// Test harness: serves public/ at https://app.test in headless Chromium, with a fake camera and
// the Supabase, Replicate and MediaPipe hosts mocked. Everything it proves is a browser
// simulation. It is not evidence about real phones, real cameras, or the live servers.
const { chromium } = require('playwright');
const path = require('path'), fs = require('fs');
const root = path.resolve(__dirname, '../public');
const assets = process.env.GLOW_TEST_ASSETS || path.join(__dirname, '.assets');
const fixtures = path.join(__dirname, 'fixtures');
let mp = process.env.GLOW_MEDIAPIPE;
if (!mp) { mp = path.resolve(__dirname, '../node_modules/@mediapipe/tasks-vision'); if (!fs.existsSync(path.join(mp, 'vision_bundle.mjs'))) mp = null; }
const faceEnv = process.env.GLOW_TEST_FACE || path.join(assets, 'face.jpg');
exports.face = fs.existsSync(faceEnv) ? faceEnv : null;
// A short portrait video for the fake camera (made by setup.sh from the sample portrait), for the live face checks.
const faceVideo = path.join(assets, 'face.y4m');
exports.faceVideo = fs.existsSync(faceVideo) ? faceVideo : null;
exports.fixtures = fixtures;
exports.ready = () => {
  const missing = [];
  if (!mp) missing.push('@mediapipe/tasks-vision (run npm run test:setup)');
  for (const f of ['selfie_segmenter.tflite', 'face_landmarker.task', 'pose_landmarker_lite.task', 'hair_segmenter.tflite'])
    if (!fs.existsSync(path.join(assets, f))) missing.push(`tests/.assets/${f} (run npm run test:setup)`);
  return missing;
};

// The mock enhance server. `server: "current"` behaves like the deployed function: GET ?id= only,
// no `refunded` field, and GET ?request= answers 400 "Bad id". `server: "patched"` behaves like
// the prepared backend change in supabase/: request ids are idempotent, GET ?request= finds the job
// (404 when it never started), and both GETs say whether the credit was returned.
const defaultAi = () => ({ server: 'current', post: 'ok', polls: ['succeeded'], dropPolls: 0, dropPost: false, failure: null });

exports.launch = async (opts = {}) => {
  const args = ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', ...(opts.args || [])];
  const browser = await chromium.launch({ args });
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true, acceptDownloads: true, serviceWorkers: 'block', viewport: opts.viewport || { width: 390, height: 844 },
    hasTouch: opts.touch !== false, isMobile: opts.mobile !== false, deviceScaleFactor: opts.dpr || 2, colorScheme: opts.scheme || 'dark', reducedMotion: opts.reducedMotion ? 'reduce' : 'no-preference', recordVideo: opts.recordVideo,
    permissions: opts.camera === false ? [] : ['camera'] });
  // Counts every camera stream the app opens, so tests can check none is left running.
  await ctx.addInitScript(() => {
    window.__streams = [];
    const md = navigator.mediaDevices;
    if (md && md.getUserMedia) { const g = md.getUserMedia.bind(md); md.getUserMedia = async (c) => { const s = await g(c); window.__streams.push(s); return s; }; }
    window.__liveTracks = () => window.__streams.flatMap((s) => s.getTracks()).filter((t) => t.readyState === 'live').length;
    // Lets a test pretend the app went to the background and came back.
    let hidden = false;
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (hidden ? 'hidden' : 'visible') });
    window.__setHidden = (h) => { hidden = h; document.dispatchEvent(new Event('visibilitychange')); };
    // Headless Chromium has no share sheet; saving falls back to a download like a desktop browser.
    try { delete Navigator.prototype.share; delete Navigator.prototype.canShare; } catch {}
  });
  if (opts.denyCamera) await ctx.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('denied', 'NotAllowedError'));
    const q = navigator.permissions.query.bind(navigator.permissions);
    navigator.permissions.query = (d) => d.name === 'camera' ? Promise.resolve({ state: 'denied', addEventListener() {} }) : q(d);
  });
  // The one-time "Free saves include a small Glow mark" note is assumed seen, except in the tests about it.
  if (!opts.markIntro) await ctx.addInitScript(() => { localStorage.setItem('glowMarkSeen', '1'); });
  if (opts.init) await ctx.addInitScript(opts.init);
  // Glow opens on Enhance by default; most checks here start where they always did (Camera), and
  // the Enhance checks pass start: 'enhance'.
  if (opts.onboarded !== false) await ctx.addInitScript((start) => { localStorage.setItem('glowOnboarded', '1'); localStorage.setItem('glowStart', start); if (!localStorage.getItem('glowLastDest')) localStorage.setItem('glowLastDest', start); }, opts.start || 'camera');
  const p = await ctx.newPage();
  const state = { used: 0, plan: opts.plan || 'free', quota: opts.quota || 3, posts: [], polls: 0, lookups: 0, refunds: 0, errs: [], downloads: [],
    ai: { ...defaultAi(), ...(opts.ai || {}) }, jobs: {}, flaked: {}, authFail: !!opts.authFail, events: [], appErrors: [], support: [] };
  p.on('pageerror', (e) => state.errs.push('pageerror: ' + e.message));
  p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|^INFO:|^W\d{4}|XNNPACK/.test(m.text())) state.errs.push('console: ' + m.text()); });
  p.on('download', async (d) => {
    const file = path.join(require('os').tmpdir(), `glow-dl-${Date.now()}-${d.suggestedFilename()}`);
    const rec = { name: d.suggestedFilename(), file, ready: d.saveAs(file).then(() => true) };
    state.downloads.push(rec);
  });
  await p.route('**/*', async (r) => {
    const u = new URL(r.request().url()), method = r.request().method();
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
    const usage = () => ({ plan: state.plan, used: state.used, quota: state.quota, remaining: Math.max(0, state.quota - state.used) + (state.bonus || 0), adsLeft: 3, bonus: state.bonus || 0 });
    const ai = state.ai;
    if (u.host.endsWith('supabase.co')) {
      if (method === 'OPTIONS') return r.fulfill({ status: 200, headers: cors });
      if (u.pathname.startsWith('/auth/v1/') && state.authFail) return r.fulfill({ status: 500, headers: cors, json: { error: 'down' } });
      if (u.pathname.startsWith('/auth/v1/')) return r.fulfill({ headers: cors, json: { access_token: 't', refresh_token: 'r', expires_at: Date.now() / 1000 + 3600, user: { id: 'u1' } } });
      // Diagnostics (migration 009): app events and errors go straight to the database.
      if (u.pathname === '/rest/v1/app_events' || u.pathname === '/rest/v1/app_errors') {
        const rows = JSON.parse(r.request().postData() || '[]');
        (u.pathname.endsWith('events') ? state.events : state.appErrors).push(...rows);
        return r.fulfill({ status: 201, headers: cors, body: '' });
      }
      if (u.pathname === '/functions/v1/account' && method === 'POST') {
        state.support.push(JSON.parse(r.request().postData()).support);
        return r.fulfill({ headers: cors, json: { sent: true } });
      }
      if (u.pathname === '/functions/v1/account') return r.fulfill({ headers: cors, json: usage() });
      if (u.pathname === '/functions/v1/enhance') {
        const answer = (job) => {
          if (job.n < ai.polls.length - 1) job.n++;
          const st = ai.polls[job.n];
          if (st === 'failed' && !job.refunded) { job.refunded = true; state.used -= job.cost; state.refunds++; }
          const body = { id: job.id, status: st, output: st === 'succeeded' ? 'https://app.test/__ai.jpg' : null, error: st === 'failed' ? "The model couldn't process this photo." : undefined };
          if (ai.server === 'patched') body.refunded = !!job.refunded;
          return r.fulfill({ headers: cors, json: body });
        };
        if (method === 'GET') {
          const id = u.searchParams.get('id'), req = u.searchParams.get('request');
          if (id) {
            state.polls++;
            if (ai.dropPolls > 0) { ai.dropPolls--; return r.abort('internetdisconnected'); }
            const job = Object.values(state.jobs).find((j) => j.id === id);
            if (!job) return r.fulfill({ status: 404, headers: cors, json: { error: 'Not found' } });
            return answer(job);
          }
          state.lookups++;
          if (ai.server !== 'patched') return r.fulfill({ status: 400, headers: cors, json: { error: 'Bad id' } });
          const job = state.jobs[req];
          if (!job) return r.fulfill({ status: 404, headers: cors, json: { error: 'Not found' } });
          return answer(job);
        }
        const body = JSON.parse(r.request().postData());
        state.posts.push(body.mode);
        if (ai.server === 'patched' && body.request_id && state.jobs[body.request_id]) return answer(state.jobs[body.request_id]);
        const cost = ['headshot', 'anime', 'watercolor', 'fashion'].includes(body.mode) ? 2 : 1;
        if (state.used + cost > state.quota) return r.fulfill({ status: 429, headers: cors, json: { error: "You've used today's 3 free AI credits.", limit: true, usage: usage() } });
        if (ai.post === 'error') return r.fulfill({ status: 502, headers: cors, json: { error: "Glow's AI service is temporarily unavailable. Please try again later." } });
        state.used += cost;
        const job = { id: 'job' + (Object.keys(state.jobs).length + 1), cost, n: -1, refunded: false };
        state.jobs[body.request_id || job.id] = job;
        // The server took the request and charged, but the answer never arrives.
        if (ai.dropPost) { ai.dropPost = false; return r.abort('connectionreset'); }
        const st = ai.post === 'processing' ? 'processing' : ai.polls[ai.polls.length - 1];
        if (st === 'processing') return r.fulfill({ headers: cors, json: { id: job.id, status: 'processing', output: null, usage: usage() } });
        job.n = ai.polls.length - 1;
        return answer(job);
      }
    }
    if (u.host === 'cdn.jsdelivr.net' && mp) { const f = path.join(mp, u.pathname.replace(/^.*tasks-vision@[^/]+\//, '')); return r.fulfill({ path: f, headers: { ...cors, 'content-type': f.endsWith('.mjs') ? 'text/javascript' : f.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream' } }); }
    if (u.host === 'storage.googleapis.com') {
      const n = u.pathname.includes('face_landmarker') ? 'face_landmarker.task' : u.pathname.includes('pose') ? 'pose_landmarker_lite.task' : u.pathname.includes('hair') ? 'hair_segmenter.tflite' : 'selfie_segmenter.tflite';
      return r.fulfill({ path: path.join(assets, n), headers: cors });
    }
    if (u.host === 'app.test') {
      const o = (opts.files || {})[u.pathname];
      if (o === 404) return r.fulfill({ status: 404, body: '' });
      if (o && o.flaky && method === 'GET' && (state.flaked[u.pathname] || 0) < o.flaky) { state.flaked[u.pathname] = (state.flaked[u.pathname] || 0) + 1; return r.fulfill({ status: 503, body: '' }); }
      if (o && o.delay) await new Promise((ok) => setTimeout(ok, o.delay));   // a slow connection
      if (o && o.json) return r.fulfill({ json: o.json });
      if (o) return r.fulfill({ path: o.path || o });
      if (u.pathname === '/__ai.jpg') return r.fulfill({ path: path.join(fixtures, 'ai-result.jpg'), headers: cors });
      const f = path.join(root, u.pathname === '/' ? 'index.html' : u.pathname); if (fs.existsSync(f)) return r.fulfill({ path: f }); return r.fulfill({ status: 404, body: '' });
    }
    if (/fonts.(googleapis|gstatic).com/.test(u.host)) return r.continue().catch(() => {});
    return r.abort();
  });
  return { browser, ctx, p, state };
};

// Width and height of a saved JPEG or PNG, read from its header.
exports.imageSize = (file) => {
  const b = fs.readFileSync(file);
  if (b[0] === 0x89 && b.toString('ascii', 1, 4) === 'PNG') return { type: 'png', w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
  let i = 2;
  while (i < b.length) {
    if (b[i] !== 0xff) { i++; continue; }
    const m = b[i + 1], len = b.readUInt16BE(i + 2);
    if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) return { type: 'jpeg', h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7) };
    i += 2 + len;
  }
  return null;
};
