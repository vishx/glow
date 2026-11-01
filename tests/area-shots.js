// Full / Person / Background screenshots and a board of every Adjust tool on one photo:
// node tests/area-shots.js photo.jpg outDir
// Headless Chromium, mocked servers.
const H = require('./harness');
const path = require('path'), fs = require('fs');
const photo = process.argv[2] || path.join(__dirname, '../public/samples/demo-v2/original.png');
const out = process.argv[3] || path.join(__dirname, 'out', 'areas');
fs.mkdirSync(out, { recursive: true });
async function ui(name, opts) {
  const { browser, p } = await H.launch({ start: 'editor', ...opts });
  await p.goto('https://app.test/');
  const fc = p.waitForEvent('filechooser'); await p.click('#pickBtn'); await (await fc).setFiles(photo);
  await p.waitForFunction(() => screen === 'editorScreen' && $('before').naturalWidth > 0);
  await p.click('.tab[data-cat="edit"]'); await p.waitForTimeout(300);
  await p.click('.tool[data-tool="exposure"]');
  await p.waitForSelector('#areaRow .area[data-area="person"]:not(:disabled)', { timeout: 60000 });
  await p.click('#areaRow .area[data-area="bg"]');
  await p.fill('#panelBody input[type=range]', '-35'); await p.dispatchEvent('#panelBody input[type=range]', 'change');
  await p.waitForFunction(() => ed.pending && ed.pending.op.area === 'bg' && !busyNow, null, { timeout: 60000 }); await p.waitForTimeout(700);
  await p.screenshot({ path: path.join(out, `ui-${name}-background-darker.png`) });
  await p.click('#areaRow .area[data-area="person"]');
  await p.waitForFunction(() => ed.pending && ed.pending.op.area === 'person' && !busyNow, null, { timeout: 60000 }); await p.waitForTimeout(700);
  await p.screenshot({ path: path.join(out, `ui-${name}-person-darker.png`) });
  await p.click('.tab[data-cat="edit"]').catch(() => {});
  await browser.close();
}
async function board() {
  const { browser, p } = await H.launch({ start: 'editor', viewport: { width: 1600, height: 1000 }, mobile: false, touch: false });
  await p.goto('https://app.test/');
  const fc = p.waitForEvent('filechooser'); await p.click('#pickBtn'); await (await fc).setFiles(photo);
  await p.waitForFunction(() => screen === 'editorScreen' && $('before').naturalWidth > 0);
  const png = await p.evaluate(async () => {
    const base = committed(), cells = [['Original', base]];
    const set = [['exposure', 40], ['whites', 45], ['blacks', -45], ['texture', 50], ['clarity', 50], ['clarity', -50], ['dehaze', 50], ['lnoise', 100], ['cnoise', 100]];
    for (const [k, v] of set) cells.push([`${TOOL[k].label} ${v > 0 && TOOL[k].range ? v : (v > 0 ? '+' : '') + v}`, await adjust(base, k, v)]);
    for (const [k, v, a, n] of [['exposure', -40, 'bg', 'Exposure -40, Background'], ['exposure', 40, 'person', 'Exposure +40, Person'], ['color', -50, 'bg', 'Saturation -50, Background']])
      cells.push([n, await adjust(base, k, v, a)]);
    const imgs = await Promise.all(cells.map(([, s]) => loadImg(s)));
    const cw = 300, ch = Math.round(cw * imgs[0].naturalHeight / imgs[0].naturalWidth), cols = 5, rows = Math.ceil(cells.length / cols);
    const c = newCanvas(cols * cw, rows * (ch + 28)), x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
    x.font = '600 16px sans-serif'; x.fillStyle = '#17171a';
    imgs.forEach((im, i) => { const cx = (i % cols) * cw, cy = Math.floor(i / cols) * (ch + 28); x.drawImage(im, cx + 2, cy + 26, cw - 4, ch); x.fillText(cells[i][0], cx + 6, cy + 19); });
    return c.toDataURL('image/jpeg', 0.85);
  });
  fs.writeFileSync(path.join(out, 'adjust-board.jpg'), Buffer.from(png.split(',')[1], 'base64'));
  await browser.close();
}
(async () => {
  await ui('390x844', { scheme: 'light' });
  await ui('360x740-dark', { viewport: { width: 360, height: 740 } });
  await board();
  console.log('done', out);
})().catch((e) => { console.error(e); process.exit(1); });
