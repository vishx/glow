// Renders SVG files to PNG with Chromium. Usage: node render.js jobs.json
// jobs.json: [{ "svg": "a.svg", "png": "a.png", "size": 1024 }, ...]
const { chromium } = require("playwright");
const fs = require("fs");
(async () => {
  const jobs = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
  const browser = await chromium.launch();
  const page = await browser.newPage();
  for (const j of jobs) {
    await page.setViewportSize({ width: j.size, height: j.size });
    const svg = fs.readFileSync(j.svg, "utf8").replace(/width="1024" height="1024"/, `width="${j.size}" height="${j.size}"`);
    await page.setContent(`<html><body style="margin:0;background:transparent">${svg}</body></html>`);
    await page.locator("svg").first().screenshot({ path: j.png, omitBackground: true });
  }
  await browser.close();
})();
