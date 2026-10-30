// Records the free sample flow to a video: node tests/record-sample.js out.webm
// A mocked browser recording (fake servers), not a device capture. It also writes the network
// evidence: every request made while the sample was open, and the credit balance before/after.
const H = require('./harness');
const path = require('path'), fs = require('fs');
const out = process.argv[2] || path.join(__dirname, 'out', 'sample-flow.webm');
(async () => {
  const dir = path.join(path.dirname(out), '.rec'); fs.mkdirSync(dir, { recursive: true });
  const env = await H.launch({ quota: 0, start: 'editor', recordVideo: { dir, size: { width: 390, height: 844 } } });
  const q = env.p, reqs = [];
  q.on('request', (r) => reqs.push(`${r.method()} ${new URL(r.url()).host}${new URL(r.url()).pathname}`));
  const pause = (ms) => q.waitForTimeout(ms);
  await q.goto('https://app.test/'); await pause(1200);
  const before = { used: env.state.used, posts: env.state.posts.length };
  const mark = reqs.length;
  await q.click('#sampleBtn'); await q.waitForFunction(() => ed.demo && $('before').naturalWidth > 0); await pause(1500);
  for (const id of ['retouch', 'pro', 'relight', 'golden', 'hair_bob', 'toon3d']) {
    await q.click(`.tool[data-tool="${id}"]`); await q.waitForFunction((x) => ed.idx === 1 && ed.hist[1].op.tool === x, id); await pause(900);
    if (id === 'retouch' || id === 'relight') {
      await q.click('#cancelBtn').catch(() => {}); await pause(300);
      await q.click('.views [data-view="split"]'); await pause(600);
      const h = await q.$('#handle'); const bb = await h.boundingBox();
      await q.mouse.move(bb.x + 22, bb.y + 22); await q.mouse.down();
      for (const dx of [-80, -40, 0, 60, 100, 40]) { await q.mouse.move(bb.x + 22 + dx, bb.y + 22, { steps: 8 }); await pause(120); }
      await q.mouse.up(); await pause(700); await q.click('.views [data-view="edited"]'); await pause(300);
    }
  }
  await q.click('#cancelBtn').catch(() => {});
  await q.click('.tool[data-tool="fsmooth"]'); await q.waitForFunction(() => !busyNow && !!ed.pending, null, { timeout: 30000 }); await pause(1200);
  await q.click('#cancelBtn'); await pause(500);
  const sampleReqs = reqs.slice(mark);
  const after = { used: env.state.used, posts: env.state.posts.length };
  const video = q.video(); await env.ctx.close(); await env.browser.close();
  fs.copyFileSync(await video.path(), out);
  const ev = { kind: 'mocked-browser', credits: { quota: 0, before, after }, aiRequests: sampleReqs.filter((r) => /enhance|replicate/.test(r)),
    requests: [...new Set(sampleReqs.filter((r) => !/jsdelivr|googleapis|gstatic|storage.googleapis/.test(r)))] };
  fs.writeFileSync(out.replace(/\.webm$/, '-network.json'), JSON.stringify(ev, null, 2));
  console.log(JSON.stringify(ev, null, 2));
})().catch((e) => { console.error(e); process.exit(1); });
