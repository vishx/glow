// Builds public/icons.js from lucide-static plus Glow's custom face icons.
const fs = require("fs"), path = require("path");
const L = process.argv[2], out = process.argv[3], old = process.argv[4];
const inner = (n) => {
  const s = fs.readFileSync(path.join(L, "icons", n + ".svg"), "utf8");
  return s.replace(/^[\s\S]*?<svg[^>]*>/, "").replace(/<\/svg>[\s\S]*$/, "").replace(/\s*\n\s*/g, "").replace(/ \/>/g, "/>").trim();
};
const MAP = {
  // Tools
  pro: "wand-sparkles", mylook: "heart", enhance: "history", faces: "users-round", retouch: "brush", smile: "smile",
  relight: "lightbulb", golden: "sunset", upscale: "scan-search", colorize: "palette",
  fauto: "sparkles", fsmooth: "droplets", fblemish: "eraser", feyes: "eye", fglam: "paintbrush",
  hcolor: "paint-bucket", hair_waves: "waves", hair_bob: "circle-user-round", hair_pixie: "scissors", hair_bangs: "brush",
  hair_curls: "spline", hair_bun: "circle-dot", hair_braids: "wheat", hair_butterfly: "wind",
  bwaist: "hourglass", bhips: "person-standing", barms: "biceps-flexed", bslimlegs: "footprints", blegs: "move-vertical",
  outfit: "shirt", gown: "gem", suit: "briefcase", sundress: "flower-2", street: "sticker",
  headshot: "camera", fashion: "star", anime: "sparkle", watercolor: "droplet", toon3d: "box", clay: "shapes",
  older: "clock-arrow-up", younger: "baby",
  bgblur: "aperture", bgremove: "scissors", bgwhite: "square", bgblush: "flower", bgsky: "cloud-sun",
  erase: "eraser", expand: "expand", crop: "crop", light: "sun", color: "contrast", warmth: "thermometer", detail: "focus",
  // Interface
  camera: "camera", editor: "image", gallery: "images", save: "download", settings: "settings", undo: "undo-2", redo: "redo-2",
  back: "chevron-left", close: "x", flip: "switch-camera", sliders: "sliders-horizontal", sparkle: "sparkles", imageplus: "image-plus",
  check: "check", search: "search", star: "star", clock: "clock", info: "info", compare: "columns-2", rotate: "rotate-cw",
  flash: "zap", flashoff: "zap-off", cameraoff: "camera-off", retake: "rotate-ccw", edit: "pencil", chevron: "chevron-right",
  sample: "flower-2", trash: "trash-2", wand: "wand-sparkles",
};
const missing = Object.values(MAP).filter((n) => !fs.existsSync(path.join(L, "icons", n + ".svg")));
if (missing.length) { console.error("missing", missing); process.exit(1); }
// Custom face icons drawn to match Lucide's 24px grid (kept from the earlier set).
const prev = new Function(fs.readFileSync(old, "utf8") + "; return ICONS;")();
const CUSTOM = ["fteeth", "flips", "fnose", "fbrows", "fblush", "fundereye", "fshadow", "fliner", "fbigeyes", "fslim"];
const icons = {};
for (const [k, n] of Object.entries(MAP)) icons[k] = inner(n);
for (const k of CUSTOM) icons[k] = prev[k];
const body = Object.entries(icons).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)},`).join("\n");
fs.writeFileSync(out, `// Line icons: Lucide (ISC license, see licenses.txt) plus custom face and makeup icons drawn on the same 24px grid.
const ICONS = {
${body}
};
function icon(name) {
  return \`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">\${ICONS[name] || ""}</svg>\`;
}
`);
console.log(Object.keys(icons).length, "icons");
