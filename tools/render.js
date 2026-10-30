// node render.js in.svg out.(png|jpg) width height
const { chromium } = require("playwright");
(async () => {
  const [inp, out, w, h] = process.argv.slice(2);
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: +w, height: +h } });
  await p.goto("file://" + inp);
  await p.screenshot({ path: out, type: out.endsWith(".jpg") ? "jpeg" : "png", quality: out.endsWith(".jpg") ? 88 : undefined, omitBackground: out.endsWith(".png") });
  await b.close();
})();
