// Test harness: serves public/ at https://app.test with the Supabase and MediaPipe hosts mocked.
const { chromium } = require('playwright');
const path = require('path'), fs = require('fs');
const root = '/home/claude/glow/public', sp = '/tmp/claude-0/-home-claude/7f701e3e-1531-54da-9fba-9af1c2ac4470/scratchpad';
const mp = '/home/claude/glow-build/node_modules/@mediapipe/tasks-vision';
exports.sp = sp;
exports.launch = async (opts = {}) => {
  const args = ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'];
  const browser = await chromium.launch({ args });
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: opts.viewport || { width: 390, height: 844 }, hasTouch: opts.touch !== false,
    isMobile: opts.mobile !== false, deviceScaleFactor: opts.dpr || 2, colorScheme: opts.scheme || 'dark', permissions: opts.camera === false ? [] : ['camera'] });
  if (opts.denyCamera) await ctx.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('denied', 'NotAllowedError'));
    const q = navigator.permissions.query.bind(navigator.permissions);
    navigator.permissions.query = (d) => d.name === 'camera' ? Promise.resolve({ state: 'denied' }) : q(d);
  });
  if (opts.init) await ctx.addInitScript(opts.init);
  const p = await ctx.newPage();
  const state = { used: 0, plan: opts.plan || 'free', quota: opts.quota || 3, posts: [], fail: opts.fail || null, polls: 0, refunds: 0, errs: [] };
  p.on('pageerror', (e) => state.errs.push('pageerror: ' + e.message));
  p.on('console', (m) => { if (m.type() === 'error') state.errs.push('console: ' + m.text()); });
  await p.route('**/*', async (r) => {
    const u = new URL(r.request().url());
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
    const usage = () => ({ plan: state.plan, used: state.used, quota: state.quota, remaining: Math.max(0, state.quota - state.used), adsLeft: 3 });
    if (u.host.endsWith('supabase.co')) {
      if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 200, headers: cors });
      if (u.pathname.startsWith('/auth/v1/')) return r.fulfill({ headers: cors, json: { access_token: 't', refresh_token: 'r', expires_at: Date.now() / 1000 + 3600, user: { id: 'u1' } } });
      if (u.pathname === '/functions/v1/account') return r.fulfill({ headers: cors, json: usage() });
      if (u.pathname === '/functions/v1/enhance') {
        if (r.request().method() === 'GET') {
          state.polls++;
          // A job that fails while running: the server refunds when it sees the failure.
          if (state.fail === 'later') { state.used -= 1; state.refunds++; return r.fulfill({ headers: cors, json: { status: 'failed', output: null, error: 'The model couldn\'t process this photo.' } }); }
          return r.fulfill({ headers: cors, json: { status: 'succeeded', output: 'https://app.test/__after.jpg' } });
        }
        const body = JSON.parse(r.request().postData()); state.posts.push(body.mode);
        const cost = ['headshot', 'anime', 'watercolor', 'fashion'].includes(body.mode) ? 2 : 1;
        if (state.used + cost > state.quota) return r.fulfill({ status: 429, headers: cors, json: { error: "You've used today's 3 free AI credits.", limit: true, usage: usage() } });
        if (state.fail === 'start') return r.fulfill({ status: 502, headers: cors, json: { error: "Glow's AI service is temporarily unavailable. Please try again later." } });
        state.used += cost;
        if (state.fail === 'later') return r.fulfill({ headers: cors, json: { id: 'x', status: 'processing', output: null, usage: usage() } });
        return r.fulfill({ headers: cors, json: { id: 'x', status: 'succeeded', output: 'https://app.test/__after.jpg', usage: usage() } });
      }
    }
    if (u.host === 'cdn.jsdelivr.net') { const f = path.join(mp, u.pathname.replace(/^.*tasks-vision@[^/]+\//, '')); return r.fulfill({ path: f, headers: { ...cors, 'content-type': f.endsWith('.mjs') ? 'text/javascript' : f.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream' } }); }
    if (u.host === 'storage.googleapis.com') {
      const n = u.pathname.includes('face_landmarker') ? 'face_landmarker.task' : u.pathname.includes('pose') ? 'pose_landmarker_lite.task' : u.pathname.includes('hair') ? 'hair_segmenter.tflite' : 'selfie_segmenter.tflite';
      return r.fulfill({ path: path.join(sp, n), headers: cors });
    }
    if (u.host === 'app.test') {
      if (u.pathname === '/__after.jpg') return r.fulfill({ path: path.join(sp, 'after.jpg') });
      const f = path.join(root, u.pathname === '/' ? 'index.html' : u.pathname); if (fs.existsSync(f)) return r.fulfill({ path: f }); return r.fulfill({ status: 404, body: '' });
    }
    if (/fonts.(googleapis|gstatic).com/.test(u.host)) return r.continue();
    return r.abort();
  });
  return { browser, ctx, p, state };
};
exports.face = path.join(sp, 'face_in.jpg');
