// ---------- Try on: one tool for every outfit ----------
// Learned from the try-on apps (2026-10-31 research, notes/tryon-research.md): one place for
// the outfit, three ways to give it (a photo or screenshot of it, an outfit from the list, or her
// own words), a free check of her photo before any credit is spent, every look she makes kept to
// flip back to for free, and outfit photos kept in a small closet on the device for the next photo.
// 2026-11-02 redesign (owner's reference: a clothes changer app): Try on has its own tab in the
// editor, and its panel reads like a wardrobe: Outfits / Color / Pattern / Fabric / Part along the
// top, then categories, then a row of outfit pictures starting with None and + Yours. Color,
// pattern and fabric change the outfit picked from the list (or described), and the pictures in
// the row take them on, so she sees what she is asking for before she spends a credit.
// Classic script after app.js: it shares app.js's globals (TOOL, sel, job, ed, outfitData, …).

// [id, label, words for the AI, part it changes, picture: [shape, main color, second color, pattern]]
// No swimwear or underwear: the AI server refuses them (supabase/functions/enhance/pipeline.ts).
const TRY_OUTFITS = [
  ["suit", "Suit", "a sharp, tailored business suit with a crisp shirt", "full", ["suit", "#3b3f47", "#f4f1ec"]],
  ["sundress", "Sundress", "a light, flowy floral summer dress", "full", ["strap", "#f1d9a8", "", "floral"]],
  ["lbd", "Black dress", "an elegant little black dress", "full", ["sheath", "#1d1b1e"]],
  ["leather", "Leather", "a black leather biker jacket over a plain T-shirt", "top", ["jacket", "#202022", "#9a9a9e", "", "zipside"]],
  ["blazer", "Blazer", "a structured, slightly oversized blazer over a simple top", "top", ["blazer", "#b98552", "#f4f1ec"]],
  ["gown", "Gown", "an elegant floor-length evening gown", "full", ["gown", "#d9c09a"]],
  ["street", "Street", "trendy streetwear: an oversized bomber jacket, a fitted top and cargo pants", "full", ["jacketpants", "#5d6b45", "#24262a"]],
  ["denim", "Denim", "a classic blue denim jacket over a plain white T-shirt", "top", ["jacket", "#5b7fae", "#f4f1ec"]],
  ["trench", "Trench", "a classic beige double-breasted trench coat", "top", ["trench", "#cdb48c"]],
  ["guest", "Satin midi", "an elegant satin midi dress", "full", ["strap", "#d7a3a8", "", "", "sheen"]],
  ["maxi", "Floral maxi", "a flowing floral maxi dress with long sleeves", "full", ["maxi", "#e7c3c8", "", "floral"]],
  ["shirtdress", "Shirt dress", "a belted cotton shirt dress", "full", ["shirtdress", "#a9c3dd"]],
  ["knitdress", "Knit dress", "a cozy ribbed knit sweater dress", "full", ["knitdress", "#d8cbb5"]],
  ["sequin", "Sequins", "a sparkly sequin party dress with long sleeves", "full", ["sequin", "#b9bcc4"]],
  ["oxford", "Oxford", "a crisp button-down oxford shirt with tailored trousers", "full", ["shirt", "#f4f1ec", "#6f737b"]],
  ["tux", "Tuxedo", "a classic black tuxedo with a white shirt and a black bow tie", "full", ["tux", "#1d1b1e", "#f4f1ec"]],
  ["velvet", "Velvet", "a rich velvet blazer over a simple top", "top", ["blazer", "#1f5e4a", "#1d1b1e", "", "sheen"]],
  ["casual", "Tee & jeans", "a fitted plain crew-neck T-shirt and straight-leg blue jeans", "full", ["teejeans", "#f4f1ec", "#46628a"]],
  ["linen", "Linen set", "a relaxed linen shirt and matching linen trousers", "full", ["linenset", "#e6dccb"]],
  ["hoodie", "Hoodie", "a relaxed hoodie", "top", ["hoodie", "#a3a4a8"]],
  ["polo", "Polo", "a knit polo shirt with chinos", "full", ["polo", "#2b3a5c", "#cdb48c"]],
  ["knit", "Cozy knit", "a cozy, chunky cable-knit sweater", "top", ["sweater", "#eadfca"]],
  ["coat", "Wool coat", "a long, tailored wool winter coat", "top", ["coat", "#a87c55"]],
  ["puffer", "Puffer", "a glossy puffer jacket", "top", ["puffer", "#26282c"]],
  ["sporty", "Track set", "a matching athleisure set: a zip-up track jacket and joggers", "full", ["track", "#8fa58d"]],
  ["varsity", "Varsity", "a vintage varsity jacket", "top", ["varsity", "#2b3a5c", "#efe3cc"]],
];
const TRY_IDEA = Object.fromEntries(TRY_OUTFITS.map((x) => [x[0], x]));
// Each outfit is shown as a real photo of the sample model wearing it (made with Try on itself,
// 2026-11-03: the owner found the drawn outfits childish; every premium try-on app shows photos).
const tryShot = (id) => `samples/tryon/${id}.webp`;
const TRY_CATS = [
  ["mine", "My outfits"],
  ["popular", "Popular", ["suit", "sundress", "lbd", "leather", "blazer", "gown", "street", "denim", "trench"]],
  ["dresses", "Dresses", ["sundress", "lbd", "guest", "maxi", "shirtdress", "knitdress", "gown", "sequin"]],
  ["work", "Work", ["suit", "blazer", "oxford", "trench", "shirtdress", "knit", "coat"]],
  ["casual", "Casual", ["casual", "linen", "denim", "hoodie", "polo", "knit", "sporty"]],
  ["jackets", "Jackets", ["leather", "denim", "blazer", "trench", "coat", "puffer", "varsity", "velvet"]],
  ["party", "Party", ["sequin", "lbd", "velvet", "tux", "gown", "guest"]],
  ["street", "Street", ["street", "varsity", "hoodie", "leather", "puffer", "sporty"]],
];
// [label, words, swatch]
const TRY_COLORS = [["Any", "", ""], ["Black", "black", "#1d1b1e"], ["White", "white", "#f7f5f2"], ["Cream", "cream", "#efe3cc"], ["Beige", "beige", "#d6c3a3"],
  ["Grey", "grey", "#8d8f94"], ["Red", "red", "#c22a34"], ["Burgundy", "burgundy", "#6e1f2e"], ["Blush", "blush pink", "#efb4c0"], ["Lilac", "lilac", "#b9a3d6"],
  ["Sky", "sky blue", "#8fb8de"], ["Navy", "navy blue", "#1f2c4f"], ["Emerald", "emerald green", "#16704f"], ["Olive", "olive green", "#6b6b3a"],
  ["Camel", "camel", "#b98552"], ["Brown", "chocolate brown", "#5a3a28"], ["Gold", "gold", "#c9a14a"]];
// [id, label, words]
const TRY_PATTERNS = [["", "Plain", ""], ["stripes", "Stripes", "stripes"], ["pinstripe", "Pinstripe", "pinstripes"], ["floral", "Floral", "a floral print"],
  ["dots", "Polka dot", "polka dots"], ["plaid", "Plaid", "a tartan plaid pattern"], ["gingham", "Gingham", "a gingham check"], ["houndstooth", "Houndstooth", "a houndstooth pattern"],
  ["leopard", "Leopard", "a leopard print"], ["paisley", "Paisley", "a paisley print"]];
const TRY_FABRICS = [["", "Any", ""], ["cotton", "Cotton", "cotton"], ["linen", "Linen", "linen"], ["denim", "Denim", "denim"], ["satin", "Satin", "silk satin"],
  ["leather", "Leather", "leather"], ["knit", "Knit", "chunky knit"], ["velvet", "Velvet", "velvet"], ["tweed", "Tweed", "tweed"], ["corduroy", "Corduroy", "corduroy"]];
const TRY_PARTS = [["Auto", "auto"], ["Top", "top"], ["Bottom", "bottom"], ["Full look", "full"]];
const TRY_TABS = [["outfits", "Outfits"], ["shoes", "Shoes"], ["color", "Color"], ["pattern", "Pattern"], ["fabric", "Fabric"], ["part", "Fit"]];
// Shoes (2026-11-03 research, /mnt/project-files/glow-tryon-wardrobe/shoes-research.md): no try-on
// app changes the shoes to suit the outfit, so a gown kept her sneakers. "Match" (the default) asks
// for the shoes stored with each outfit; "Keep mine" keeps hers; a shoe type changes the shoes, or,
// with no outfit picked (None), only the shoes. Shoes change only when her feet are in the photo.
const TRY_SHOES = [["match", "Match outfit", ""], ["keep", "Keep mine", ""], ["heels", "Heels", "elegant high heels"], ["flats", "Flats", "ballet flats"],
  ["loafers", "Loafers", "leather loafers"], ["sneakers", "Sneakers", "clean white sneakers"], ["boots", "Boots", "leather ankle boots"], ["sandals", "Sandals", "strappy sandals"]];
const TRY_SHOE_FOR = { suit: "sleek black leather shoes", sundress: "tan strappy sandals", lbd: "black heels", leather: "black ankle boots", blazer: "pointed loafers",
  gown: "elegant strappy heels", street: "chunky sneakers", denim: "white sneakers", trench: "ankle boots", guest: "strappy heels", maxi: "flat sandals",
  shirtdress: "white sneakers", knitdress: "knee-high boots", sequin: "metallic heels", oxford: "leather loafers", tux: "black patent dress shoes",
  casual: "white sneakers", linen: "leather sandals", hoodie: "sneakers", polo: "loafers", knit: "ankle boots", coat: "leather ankle boots",
  puffer: "winter boots", sporty: "running sneakers", varsity: "retro sneakers" };
const tryShoe = () => TRY_SHOES.find((x) => x[0] === tryOn.shoes) || TRY_SHOES[0];
// The words for her shoes, or "" when they stay as they are.
function tryShoeWords() {
  if (tryOn.feet === false || tryOn.shoes === "keep") return "";
  const t = tryShoe();
  if (t[2]) return t[2];
  return tryOn.src === "ideas" && TRY_IDEA[tryOn.idea] ? TRY_SHOE_FOR[tryOn.idea] || "" : "shoes that suit the outfit";
}
// The sample's prepared previews (made with the earlier Suit and Summer dress tools).
const TRY_DEMO = { suit: "suit", sundress: "sundress" };
const CLOSET_MAX = 8, LOOKS_MAX = 8;

const tryOn = { src: "ideas", idea: "suit", color: "", pattern: "", fabric: "", shoes: "match", feet: null, words: "", part: "auto", tab: "outfits", cat: "popular",
  closet: null, check: null, checkFor: "", checkSaid: "", demoShown: null, scroll: {} };
// Every look made on this photo: { label, data, full, baseIdx }. Kept on the device with the
// session, so leaving and coming back (or a reload) still shows them; nothing is charged to look again.
let tryLooks = { session: null, items: [] };

function tryLooksNow() { return tryLooks.session === ed.session ? tryLooks.items : []; }
function saveLooks() { Drafts.write("tryLooks", tryLooks).catch(() => {}); }
Drafts.read("tryLooks").then((v) => { if (v && v.session && !tryLooks.items.length) tryLooks = v; }).catch(() => {});

async function closetLoad() {
  if (tryOn.closet) return tryOn.closet;
  const v = await Drafts.read("closet");
  return (tryOn.closet = Array.isArray(v) ? v.slice(0, CLOSET_MAX) : []);
}
function closetSave() { Drafts.write("closet", tryOn.closet || []).catch(() => {}); }
async function closetAdd(file) {
  const data = await shrinkData(await loadAndShrink(file), 1024);
  const c = await closetLoad();
  tryOn.closet = [data, ...c.filter((x) => x !== data)].slice(0, CLOSET_MAX);
  closetSave(); outfitData = data; tryOn.src = "photo"; tryOn.cat = "mine"; tryOn.tab = "outfits";
}

// What the request asks for, and a short name for the look. Color, pattern and fabric go with an
// outfit from the list or her own words; an outfit photo is copied as it is.
const tryColor = () => TRY_COLORS.find((x) => x[1] === tryOn.color) || TRY_COLORS[0];
const tryPattern = () => TRY_PATTERNS.find((x) => x[0] === tryOn.pattern) || TRY_PATTERNS[0];
const tryFabric = () => TRY_FABRICS.find((x) => x[0] === tryOn.fabric) || TRY_FABRICS[0];
function tryStyleWords() {
  const w = [];
  if (tryOn.color) w.push(`mainly in ${tryOn.color}`);
  if (tryOn.pattern) w.push(`with ${tryPattern()[2]}`);
  if (tryOn.fabric) w.push(`made of ${tryFabric()[2]}`);
  return w.join(", ");
}
function tryRequest() {
  const part = (dflt) => (tryOn.part === "auto" ? dflt : tryOn.part);
  // Shoes go with a full look (not when only the top changes); "Keep mine" says so, as the AI may
  // otherwise restyle them with a dress.
  const feetOn = (p) => p !== "top";
  const withShoes = (text, p) => {
    if (!feetOn(p)) return text;
    const sh = tryShoeWords();
    const add = sh ? `with ${sh}` : tryOn.shoes === "keep" && tryOn.feet !== false ? "keeping their own shoes" : "";
    return (add ? (text ? `${text}, ${add}` : add) : text).slice(0, 200);
  };
  if (tryOn.src === "photo") {
    if (!outfitData) return null;
    const pr = withShoes("", tryOn.part);
    return { extra: outfitData, part: tryOn.part, label: "Your outfit", ...(pr ? { prompt: pr } : {}) };
  }
  const style = tryStyleWords();
  if (tryOn.src === "words") {
    const w = tryOn.words.trim().slice(0, 160); if (!w) return null;
    return { prompt: withShoes(style ? `${w}, ${style}` : w, tryOn.part), part: tryOn.part, label: w.length > 24 ? w.slice(0, 22) + "…" : w };
  }
  const i = TRY_IDEA[tryOn.idea];
  if (!i) {
    // No outfit, a shoe type: only the shoes change.
    const t = tryShoe();
    if (!t[2] || tryOn.feet === false) return null;
    return { prompt: `${t[2]} instead of the current shoes, keeping the clothes exactly as they are`, part: "auto", label: t[1], shoesOnly: true };
  }
  const bits = [tryOn.color ? tryColor()[0] : "", tryOn.pattern ? tryPattern()[1].toLowerCase() : "", tryOn.fabric ? tryFabric()[1].toLowerCase() : ""].filter(Boolean);
  const name = bits.length ? `${bits[0]} ${[...bits.slice(1), i[1].toLowerCase()].join(" ")}` : i[1];
  return { prompt: withShoes(style ? `${i[2]}, ${style}` : i[2], part(i[3])), part: part(i[3]), label: name.charAt(0).toUpperCase() + name.slice(1) };
}

// A free look at her photo before anything is charged: try-on needs the clothes to be in it.
async function tryCheck() {
  const base = committed();
  if (tryOn.checkFor === base) return;
  tryOn.checkFor = base; tryOn.check = null; tryOn.feet = null;
  let msg = "", boxesOk = false;
  try {
    const boxes = await faceBoxes(base); boxesOk = boxes.length > 0;
    if (!boxes.length) msg = "No person found. Try on works on a photo of you.";
    else if (boxes.length > 1 && boxes[1].w * boxes[1].h > boxes[0].w * boxes[0].h * 0.7) msg = "Works best with one person in the photo. The largest person is dressed.";
    // How much of her is below the chin, in face heights: about 2 for a head-and-shoulders photo,
    // 3 to 4 from the waist up, 7 head to toe.
    else if ((1 - boxes[0].y - boxes[0].h) / boxes[0].h < 2.5) msg = "Little of your outfit shows here, so the AI guesses the rest. A waist-up photo works best.";
    // Head to toe is about 7 face heights; her feet are in the photo from about 5.5 (shoes can change).
    if (boxes.length) tryOn.feet = (1 - boxes[0].y - boxes[0].h) / boxes[0].h >= 5.5;
  } catch { msg = ""; }
  if (tryOn.checkFor !== base) return;
  tryOn.check = msg;
  // The panel has no room for a note line, so the check is said once per photo, just above the dock.
  // The first time, a stance tip (2026-11-03, owner: a twisted pose makes clothes look awkward; the
  // try-on apps ask for a straight, front-on pose). Her own pose is kept, so the tip comes first.
  let tip = "";
  try { if (!msg && boxesOk && !localStorage.getItem("glowTryTip")) { tip = "Best fit: stand straight, facing the camera, arms a little away from your body."; localStorage.setItem("glowTryTip", "1"); } } catch {}
  if ((msg || tip) && sel === "outfit" && tryOn.checkSaid !== base) { tryOn.checkSaid = base; say(msg || tip); }
  if (sel === "outfit") renderPanel();
}

// ---------- Outfit pictures ----------
// Swatches for the Color, Pattern and Fabric rows (drawn here, no downloads).
let gUid = 0;
const gLine = (d, w = 1, o = 0.28) => `<path d="${d}" fill="none" stroke="#000" stroke-opacity="${o}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`;
function gPattern(id, kind, base) {
  const dark = (() => { const n = parseInt((base || "#888888").slice(1), 16); return ((n >> 16) * 0.3 + ((n >> 8) & 255) * 0.59 + (n & 255) * 0.11) < 120; })();
  const ink = dark ? "#fff" : "#1d1b1e", c = (s) => `<pattern id="${id}" width="${s[0]}" height="${s[1]}" patternUnits="userSpaceOnUse"${s[2] ? ` patternTransform="${s[2]}"` : ""}>${s[3]}</pattern>`;
  switch (kind) {
    case "stripes": return c([7, 7, "", `<rect width="3.2" height="7" fill="${ink}" opacity=".55"/>`]);
    case "pinstripe": return c([4, 4, "", `<rect width=".6" height="4" fill="${ink}" opacity=".6"/>`]);
    case "dots": return c([6, 6, "", `<circle cx="3" cy="3" r="1.2" fill="${ink}" opacity=".75"/>`]);
    case "floral": return c([10, 10, "", `<g opacity=".8"><circle cx="3" cy="3" r="1.3" fill="#c94f6d"/><circle cx="8" cy="8" r="1.1" fill="#e48a3c"/><circle cx="8" cy="2.5" r=".7" fill="#5f8f5a"/><circle cx="2.5" cy="8" r=".7" fill="#5f8f5a"/></g>`]);
    case "plaid": return c([10, 10, "", `<rect width="10" height="3" fill="${ink}" opacity=".22"/><rect width="3" height="10" fill="${ink}" opacity=".22"/><rect y="6" width="10" height=".6" fill="#c22a34" opacity=".7"/><rect x="6" width=".6" height="10" fill="#c22a34" opacity=".7"/>`]);
    case "gingham": return c([6, 6, "", `<rect width="3" height="6" fill="${ink}" opacity=".25"/><rect width="6" height="3" fill="${ink}" opacity=".25"/>`]);
    case "houndstooth": return c([5, 5, "", `<path d="M0 0H2.5V2.5H0ZM2.5 2.5L5 0V2.5L2.5 5Z" fill="${ink}" opacity=".7"/>`]);
    case "leopard": return c([11, 11, "", `<g fill="none" stroke="#2a1c12" stroke-width="1.1" opacity=".8"><path d="M2 2.5q2-1.6 3 .6M2.4 3.6q1.6 1.2 2.8-.2M7.4 7.2q1.8-1.5 2.6.6M7.6 8.6q1.6 1 2.5-.3"/></g><circle cx="3.6" cy="2.9" r=".7" fill="#7a4a22"/><circle cx="8.7" cy="7.9" r=".7" fill="#7a4a22"/>`]);
    case "paisley": return c([12, 12, "", `<g fill="${ink}" opacity=".55"><path d="M3 9q-2-4 1.5-6q2-1 2 1q0 2-2 2.4q-1.5.4-1.5 2.6z"/><circle cx="9" cy="4" r=".9"/><circle cx="9.5" cy="9.5" r=".6"/></g>`]);
    // Fabrics: a texture over the color.
    case "f-denim": return c([3, 3, "rotate(45)", `<rect width=".8" height="3" fill="#fff" opacity=".22"/>`]);
    case "f-linen": return c([2.4, 2.4, "", `<rect width="2.4" height=".5" fill="#fff" opacity=".25"/><rect width=".5" height="2.4" fill="#000" opacity=".08"/>`]);
    case "f-cotton": return c([3, 3, "", `<circle cx="1.5" cy="1.5" r=".35" fill="#000" opacity=".06"/>`]);
    case "f-knit": case "f-corduroy": return c([kind === "f-knit" ? 3.2 : 2.4, 4, "", `<rect width="${kind === "f-knit" ? 1.4 : 1}" height="4" fill="#000" opacity=".16"/>`]);
    case "f-tweed": return c([4, 4, "", `<rect x=".4" y=".6" width="1" height=".6" fill="#fff" opacity=".5"/><rect x="2.4" y="2.6" width="1" height=".6" fill="#000" opacity=".25"/><rect x="2.6" y=".3" width=".6" height=".9" fill="#c9a14a" opacity=".5"/>`]);
    case "f-leather": case "f-satin": case "f-velvet": case "sheen":
      return `<linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="${kind === "f-velvet" ? 0 : 0.05}"/><stop offset=".42" stop-color="#fff" stop-opacity="${kind === "f-velvet" ? 0.12 : 0.38}"/><stop offset=".6" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="${kind === "f-velvet" ? 0.35 : 0.18}"/></linearGradient>`;
  }
  return "";
}
// A square swatch of a color, pattern or fabric.
function swatchSVG(base, pattern, finish) {
  const pid = `gp${++gUid}`, fid = `gf${gUid}`;
  const defs = (pattern ? gPattern(pid, pattern, base) : "") + (finish ? gPattern(fid, finish, base) : "");
  return `<svg viewBox="0 0 40 40" aria-hidden="true" focusable="false"><defs>${defs}</defs><rect width="40" height="40" fill="${base}"/>` +
    (pattern ? `<rect width="40" height="40" fill="url(#${pid})"/>` : "") + (finish ? `<rect width="40" height="40" fill="url(#${fid})"/>` : "") + `</svg>`;
}
const FABRIC_BASE = { cotton: "#f2efe9", linen: "#d9cdb6", denim: "#4f6f9c", satin: "#d8c3a0", leather: "#2a2426", knit: "#e6dccb", velvet: "#6e1f3a", tweed: "#c7a8a5", corduroy: "#a77d52" };

// ---------- The panel ----------
// Remembers how far each row is scrolled, so a tap that redraws the panel doesn't jump the row back.
function tryKeepScroll(el, key) {
  el.dataset.scrollKey = key;
  el.addEventListener("scroll", () => { tryOn.scroll[key] = el.scrollLeft; }, { passive: true });
  return el;
}
function tryRestoreScroll(body) {
  body.querySelectorAll("[data-scroll-key]").forEach((el) => { const x = tryOn.scroll[el.dataset.scrollKey]; if (x) el.scrollLeft = x; });
}
// The look on screen is closed when she changes what she asks for (it stays in Your looks).
function tryChanged() {
  if (tryIsKept()) { job = null; saveJob(); panelBuilt = null; renderEditor(); return; }
  renderPanel(true);
}
const tryStyled = () => !!(tryOn.color || tryOn.pattern || tryOn.fabric);
const tryStyleOn = () => tryOn.src !== "photo";

function tryTabs(body) {
  const row = document.createElement("div"); row.className = "try-tabs"; row.setAttribute("role", "tablist"); row.setAttribute("aria-label", "Try on");
  const set = { shoes: tryOn.shoes !== "match", color: !!tryOn.color, pattern: !!tryOn.pattern, fabric: !!tryOn.fabric, part: tryOn.part !== "auto" };
  TRY_TABS.forEach(([k, label]) => {
    const b = document.createElement("button"); b.type = "button"; b.className = "try-tab"; b.dataset.tab = k; b.setAttribute("role", "tab");
    b.setAttribute("aria-selected", String(tryOn.tab === k)); b.textContent = label;
    if (set[k]) { b.classList.add("set"); b.setAttribute("aria-label", `${label}, chosen`); }
    b.addEventListener("click", () => { if (tryOn.tab === k) return; Platform.haptic(); tryOn.tab = k; renderPanel(true); });
    row.append(b);
  });
  body.append(row);
}
function tryCats(body) {
  const row = tryKeepScroll(document.createElement("div"), "cats"); row.className = "try-cats"; row.setAttribute("role", "group"); row.setAttribute("aria-label", "Outfit categories");
  // Looks already made on this photo get their own chip, first, to flip back to for free.
  const cats = tryLooksNow().length ? [["looks", "Your looks"], ...TRY_CATS] : TRY_CATS;
  if (tryOn.cat === "looks" && !tryLooksNow().length) tryOn.cat = "popular";
  cats.forEach(([k, label]) => {
    const b = document.createElement("button"); b.type = "button"; b.className = "try-cat"; b.dataset.cat = k; b.textContent = label;
    b.setAttribute("aria-pressed", String(tryOn.cat === k));
    b.addEventListener("click", () => { if (tryOn.cat === k) return; tryOn.cat = k; tryOn.scroll.strip = 0; renderPanel(true); if (k === "mine") closetLoad().then(() => sel === "outfit" && renderPanel(true)); });
    row.append(b);
  });
  body.append(row);
}
// A tile in the row: a picture (or an icon), its name, and a check when chosen.
function tryTile({ cls = "", pic = "", img = "", icon: ic = "", label, on, aria, onClick }) {
  const b = document.createElement("button"); b.type = "button"; b.className = "try-tile" + (cls ? " " + cls : ""); b.setAttribute("aria-pressed", String(!!on));
  b.setAttribute("aria-label", aria || label);
  const w = document.createElement("i"); w.className = "well";
  if (pic) w.innerHTML = pic; else if (img) w.style.backgroundImage = `url(${img})`; else if (ic) w.innerHTML = icon(ic);
  const n = document.createElement("span"); n.className = "name"; n.textContent = label;
  b.append(w, n); b.addEventListener("click", () => { Platform.haptic(); onClick(); });
  return b;
}
function tryNone() {
  // None: no outfit. With a look showing, it goes back to her photo (the look stays in Your looks).
  const on = tryOn.src === "ideas" && !tryOn.idea;
  return tryTile({ cls: "none", icon: "none", label: "None", on, aria: "None: keep your own clothes",
    onClick: () => { tryOn.src = "ideas"; tryOn.idea = null; tryChanged(); } });
}
function tryAddTile() {
  return tryTile({ cls: "add", icon: "plus", label: "Yours", aria: "Add a photo or screenshot of an outfit",
    onClick: async () => { const f = await Platform.pickPhoto("outfitFile"); if (f) { try { await closetAdd(f); } catch (err) { say(err.message, true); } tryChanged(); } } });
}
function tryDescribeTile() {
  return tryTile({ cls: "add", icon: "custom", label: "Describe", on: tryOn.src === "words", aria: "Describe an outfit in your own words",
    onClick: () => { tryOn.src = "words"; tryOn.tab = "outfits"; renderPanel(true); setTimeout(() => { const i = $("tryWords"); if (i) i.focus(); }, 60); } });
}
function tryPasteTile() {
  // Paste a copied outfit picture: computers, the Android app (natively) and browsers that allow it.
  // Where nothing can read pictures from the clipboard, there's no Paste button at all.
  if (!Platform.canPaste()) return null;
  const b = tryTile({ cls: "add", icon: "paste", label: "Paste", aria: "Paste a copied outfit picture", onClick: async () => {
    let f;
    try { f = await Platform.pasteImage(); }
    catch (err) {
      say(err && err.denied ? "Glow Studio wasn't allowed to see the clipboard. Allow it, or save the picture and use Add." : "Glow Studio couldn't read that picture. Save it and use Add instead.", true);
      return;
    }
    if (!f) { say("There's no picture to paste. Copy an outfit picture first (press and hold it, then Copy image).", true); return; }
    await tryPasted(f);
  } });
  return b;
}
function tryStrip(body) {
  const row = tryKeepScroll(document.createElement("div"), "strip"); row.className = "try-strip"; row.setAttribute("role", "group");
  row.setAttribute("aria-label", tryOn.cat === "mine" ? "Your outfit photos" : "Outfits");
  row.append(tryNone());
  if (tryOn.cat === "looks") {
    tryLooksNow().forEach((it, i) => {
      const b = tryTile({ cls: "photo try-look", img: it.thumb || it.data, label: it.label, on: tryLookShown() === it.id, aria: `${it.label}, look ${i + 1}`, onClick: () => tryShowLook(it) });
      row.append(b);
    });
  } else if (tryOn.cat === "mine") {
    row.append(tryAddTile()); const pt = tryPasteTile(); if (pt) row.append(pt); row.append(tryDescribeTile());
    if (!tryOn.closet) closetLoad().then(() => { if (sel === "outfit" && tryOn.cat === "mine" && tryOn.closet.length) renderPanel(true); });
    (tryOn.closet || []).forEach((data, i) => {
      const on = tryOn.src === "photo" && outfitData === data;
      const b = tryTile({ cls: "photo", img: data, label: `Outfit ${i + 1}`, on, aria: `Outfit photo ${i + 1}`, onClick: () => { outfitData = data; tryOn.src = "photo"; tryChanged(); } });
      if (on) {
        const x = document.createElement("span"); x.className = "try-remove"; x.setAttribute("role", "button"); x.tabIndex = 0; x.innerHTML = icon("close"); x.setAttribute("aria-label", "Remove this outfit photo");
        const rm = (e) => { e.stopPropagation(); tryOn.closet = tryOn.closet.filter((d) => d !== data); outfitData = null; closetSave(); renderPanel(true); };
        x.addEventListener("click", rm); x.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") rm(e); });
        b.querySelector(".well").append(x);
      }
      row.append(b);
    });
  } else {
    row.append(tryAddTile(), tryDescribeTile());
    const sep = document.createElement("span"); sep.className = "try-sep"; sep.setAttribute("aria-hidden", "true"); row.append(sep);
    const style = { color: (tryColor()[2]) || "", pattern: tryOn.pattern || null, fabric: tryOn.fabric };
    (TRY_CATS.find((c) => c[0] === tryOn.cat) || TRY_CATS[1])[2].forEach((id) => {
      const it = TRY_IDEA[id]; if (!it) return;
      const on = tryOn.src === "ideas" && tryOn.idea === id;
      const b = tryTile({ cls: "shot", img: tryShot(id), label: it[1], on, onClick: () => { tryOn.src = "ideas"; tryOn.idea = id; tryChanged(); } });
      // A photo can't take her color, pattern or fabric, so the picked one sits on the tile as a swatch.
      if (on && tryStyleWords()) { const t = document.createElement("i"); t.className = "try-tag"; t.innerHTML = swatchSVG(style.color || FABRIC_BASE[style.fabric] || "#e9e3da", style.pattern || "", style.fabric ? "f-" + style.fabric : ""); b.querySelector(".well").append(t); }
      b.dataset.idea = id; row.append(b);
    });
  }
  body.append(row);
}
// Her own words, in place of the categories (the row below stays, to go back to the list).
function tryWords(body) {
  const l = document.createElement("label"); l.className = "prompt try-words";
  const inp = document.createElement("input"); inp.type = "text"; inp.id = "tryWords"; inp.maxLength = 160; inp.autocomplete = "off"; inp.enterKeyHint = "done";
  inp.placeholder = "Describe it, e.g. a red trench coat"; inp.value = tryOn.words;
  inp.addEventListener("input", () => { tryOn.words = inp.value; if (tryIsKept()) { job = null; saveJob(); renderEditor(); } else panelState(TOOL.outfit); });
  inp.addEventListener("keydown", (e) => { if (e.key === "Enter") inp.blur(); });
  l.append(Object.assign(document.createElement("span"), { className: "sr-only", textContent: "Describe the outfit" }), inp); body.append(l);
}
// Color, pattern and fabric: one row of swatches each.
function trySwatches(body, kind) {
  const row = tryKeepScroll(document.createElement("div"), kind); row.className = "try-strip try-swatches"; row.setAttribute("role", "group");
  row.setAttribute("aria-label", { color: "Color", pattern: "Pattern", fabric: "Fabric" }[kind]);
  if (!tryStyleOn()) {
    const p = document.createElement("p"); p.className = "try-hint";
    p.textContent = "Your outfit photo is copied as it is. Color, pattern and fabric change outfits from the list or ones you describe.";
    body.append(p); return;
  }
  const list = kind === "color" ? TRY_COLORS.map(([label, v, hex]) => [v, label, hex ? swatchSVG(hex) : ""])
    : kind === "pattern" ? TRY_PATTERNS.map(([v, label]) => [v, label, v ? swatchSVG(tryColor()[2] || "#e9e3da", v) : ""])
    : TRY_FABRICS.map(([v, label]) => [v, label, v ? swatchSVG(tryColor()[2] || FABRIC_BASE[v], "", "f-" + v) : ""]);
  list.forEach(([v, label, pic]) => {
    const on = (tryOn[kind] || "") === v;
    const b = tryTile({ cls: "swatch" + (v ? "" : " none"), pic, icon: v ? "" : "none", label, on, aria: v ? label : `${label} ${kind}`,
      onClick: () => { tryOn[kind] = v; tryChanged(); } });
    b.dataset[kind] = v; row.append(b);
  });
  body.append(row);
}
// Shoes: Match outfit (default), Keep mine, or a type; one line says what will happen.
function tryShoesRow(body) {
  const row = tryKeepScroll(document.createElement("div"), "shoes"); row.className = "try-cats try-shoes"; row.setAttribute("role", "group"); row.setAttribute("aria-label", "Shoes");
  TRY_SHOES.forEach(([k, label]) => {
    const b = document.createElement("button"); b.type = "button"; b.className = "try-cat"; b.dataset.shoes = k; b.textContent = label;
    b.setAttribute("aria-pressed", String(tryOn.shoes === k));
    b.addEventListener("click", () => { if (tryOn.shoes === k) return; Platform.haptic(); tryOn.shoes = k; tryChanged(); });
    row.append(b);
  });
  const p = document.createElement("p"); p.className = "try-hint"; p.id = "tryShoesHint";
  const i = tryOn.src === "ideas" ? TRY_IDEA[tryOn.idea] : null, t = tryShoe();
  const topOnly = (tryOn.part === "auto" ? (i ? i[3] : "auto") : tryOn.part) === "top";
  p.textContent = tryOn.feet === false ? "Your feet aren't in this photo, so your shoes stay as they are. A head-to-toe photo lets the shoes change too."
    : tryOn.src === "ideas" && !i ? (t[2] ? `Only your shoes change, to ${t[1].toLowerCase()}. Your clothes stay as they are.` : "Pick a shoe type to change only your shoes.")
    : topOnly ? "Only the top changes, so your shoes stay as they are."
    : tryOn.shoes === "keep" ? "Your own shoes stay."
    : t[2] ? `With ${t[2]}.` : i ? `Shoes to match: ${TRY_SHOE_FOR[i[0]]}.` : "Shoes that suit the outfit.";
  body.append(row, p);
}
function tryPartRow(body) {
  const row = tryKeepScroll(document.createElement("div"), "part"); row.className = "try-strip parts"; row.setAttribute("role", "group"); row.setAttribute("aria-label", "What to change");
  const pics = { top: "blazer", bottom: "casual", full: "suit" };
  TRY_PARTS.forEach(([label, v]) => {
    const b = tryTile({ cls: v === "auto" ? "add part" : "shot part " + v, img: v === "auto" ? "" : tryShot(pics[v]), icon: v === "auto" ? "sparkle" : "", label, on: tryOn.part === v,
      aria: v === "auto" ? "Auto: the AI decides what to change" : `Change the ${label.toLowerCase()}`, onClick: () => { tryOn.part = v; tryChanged(); } });
    b.dataset.part = v; row.append(b);
  });
  body.append(row);
}

// The outfit picture centered on a plain light card with the shape of her photo (never cropped).
async function tryOutfitCard(outfit, photo) {
  const [o, ph] = await Promise.all([loadImg(outfit), loadImg(photo)]);
  const r = ph.naturalWidth / ph.naturalHeight, ow = o.naturalWidth, oh = o.naturalHeight;
  if (Math.abs(ow / oh - r) < 0.01) return outfit;
  const w = ow / oh > r ? ow : Math.round(oh * r), h = ow / oh > r ? Math.round(ow / r) : oh;
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  const x = c.getContext("2d"); x.fillStyle = "#f0eeea"; x.fillRect(0, 0, w, h);
  x.drawImage(o, Math.round((w - ow) / 2), Math.round((h - oh) / 2));
  return c.toDataURL("image/jpeg", 0.9);
}

async function tryPasted(f) {
  try { await closetAdd(f); } catch (err) { say(err.message, true); return; }
  tryChanged();
}
// Ctrl+V / Cmd+V on a computer while Try on is open adds the copied picture to My outfits.
document.addEventListener("paste", (e) => {
  if (screen !== "editorScreen" || sel !== "outfit" || ed.demo) return;
  if (e.target && e.target.closest && e.target.closest("input, textarea, [contenteditable]")) return;
  const it = [...((e.clipboardData && e.clipboardData.items) || [])].find((x) => x.kind === "file" && x.type.startsWith("image/"));
  const f = it && it.getAsFile();
  if (!f) return;
  e.preventDefault();
  tryPasted(new File([f], "outfit." + (f.type.split("/")[1] || "png"), { type: f.type }));
});

// Every look made on this photo, to flip between for free. Tapping one shows it for review again.
function tryLooksRow(body) {
  const items = tryLooksNow();
  if (!items.length || ed.demo) return;
  const row = document.createElement("div"); row.className = "try-looks"; row.setAttribute("role", "group"); row.setAttribute("aria-label", "Your looks");
  const h = document.createElement("span"); h.className = "try-looks-label"; h.textContent = "Your looks"; row.append(h);
  items.forEach((it, i) => {
    const b = document.createElement("button"); b.className = "try-look"; b.style.backgroundImage = `url(${it.thumb || it.data})`;
    const on = tryLookShown() === it.id;
    b.setAttribute("aria-pressed", String(on)); b.setAttribute("aria-label", `${it.label}, look ${i + 1}`);
    b.addEventListener("click", () => tryShowLook(it));
    row.append(b);
  });
  body.append(row);
}
// Which kept look is showing for review, if any.
const tryLookShown = () => (job && job.status === "done" && job.tool === "outfit" && job.session === ed.session ? job.lookId || job.requestId : null);
const tryIsKept = () => !!tryLookShown() && tryLooksNow().some((x) => x.id === tryLookShown());
function tryShowLook(it) {
  if (jobActive()) { say(`Wait for ${job.title} to finish first.`, true); return; }
  if (tryLookShown() === it.id) return;
  if (resultReady() && !tryIsKept()) { say(`Apply or discard the ${job.title} result first.`, true); return; }
  job = { requestId: rid(), lookId: it.id, id: null, tool: "outfit", title: "Try on", look: it.label, session: ed.session, baseIdx: Math.min(it.baseIdx, ed.hist.length - 1), status: "done", startedAt: Date.now(), result: { data: it.data, full: it.full }, relook: true };
  saveJob(); sel = "outfit"; renderEditor();
  say(`${it.label} look shown. Apply keeps it.`);
}
// Called when a try-on result arrives: keep it in the looks row.
async function tryKeepLook(mine) {
  if (!mine || mine.tool !== "outfit" || !mine.result) return;
  let thumb = "";
  try { thumb = await shrinkData(mine.result.data, 160); } catch {}
  if (tryLooks.session !== ed.session) tryLooks = { session: ed.session, items: [] };
  const id = mine.lookId || mine.requestId;
  tryLooks.items = [{ id, label: mine.look || "Look", data: mine.result.data, full: mine.result.full, thumb, baseIdx: mine.baseIdx },
    ...tryLooks.items.filter((x) => x.id !== id)].slice(0, LOOKS_MAX);
  saveLooks();
  if (sel === "outfit") renderPanel(true);
}

// While a look is being made or shown, the panel shrinks to Your looks and the buttons, so the
// photo gets the room (the pickers come back with Change).
const tryCompact = () => !ed.demo && !!job && job.tool === "outfit" && job.session === ed.session && (reviewing() || jobActive());
function tryOnPanel(body) {
  if (ed.demo) { tryDemoPanel(body); return; }
  if (tryCompact()) { tryLooksRow(body); return; }
  tryTabs(body);
  if (tryOn.tab === "outfits") {
    if (tryOn.src === "words") tryWords(body); else tryCats(body);
    tryStrip(body);
  } else if (tryOn.tab === "part") tryPartRow(body);
  else if (tryOn.tab === "shoes") tryShoesRow(body);
  else trySwatches(body, tryOn.tab);
  tryRestoreScroll(body);
  tryCheck();
}
// The note: only what she must know (nothing to send yet). The photo check is said once as a message.
function tryOnNote() {
  if (tryOn.src === "photo" && !outfitData) return "Add a photo or screenshot of the outfit.";
  return "";
}

// ---------- On the AI sample ----------
// The sample has prepared Suit and Summer dress results; Try on shows those, free.
const tryDemoReady = () => (demo ? Object.values(TRY_DEMO).filter((id) => demo.ready.includes(id)) : []);
const tryDemoOn = () => (ed.demo && ed.idx > 0 && tryOn.demoShown ? tryOn.demoShown : null);
// The sample shows the same wardrobe row; outfits with a prepared result come first, the others ask
// for her own photo.
function tryDemoPanel(body) {
  const row = tryKeepScroll(document.createElement("div"), "demo"); row.className = "try-strip"; row.setAttribute("role", "group"); row.setAttribute("aria-label", "Outfits");
  const ready = Object.keys(TRY_DEMO).filter((id) => demo && demo.ready.includes(TRY_DEMO[id]));
  const ids = [...ready, ...TRY_CATS[1][2].filter((id) => !ready.includes(id))];
  ids.forEach((id) => {
    const it = TRY_IDEA[id], has = ready.includes(id), pic = has ? `${DEMO_DIR}thumbs/${TRY_DEMO[id]}.jpg` : "";
    const b = tryTile({ cls: has ? "photo" : "shot locked", img: pic || tryShot(id), label: it[1], on: tryDemoOn() === id,
      aria: has ? `${it[1]}, prepared preview` : `${it[1]}, needs your own photo`,
      onClick: () => { if (has) { tryOn.demoShown = id; showDemoPreview(TRY_DEMO[id], "outfit"); } else say(`Try ${it[1].toLowerCase()} on your own photo: tap Use your photo.`); } });
    b.dataset.idea = id; row.append(b);
  });
  const hint = document.createElement("p"); hint.className = "try-hint";
  hint.textContent = ready.length ? `${ready.map((id) => TRY_IDEA[id][1]).join(" and ")} ${ready.length > 1 ? "are" : "is a"} prepared preview${ready.length > 1 ? "s" : ""}, free. Use your photo to try any outfit.` : "Use your photo to try any outfit.";
  body.append(row, hint); tryRestoreScroll(body);
}
function tryDemoState() {
  const chip = $("cost"), apply = $("applyBtn"), shown = tryDemoOn(), id = shown && TRY_DEMO[shown];
  chip.textContent = "Prepared preview"; chip.className = "chip"; apply.disabled = false;
  let note = "Tap an outfit to see a prepared result. No credits used.";
  if (demo && demo.loading && demo.loading === (TRY_DEMO[tryOn.demoShown] || "")) { apply.textContent = "Done"; apply.disabled = true; note = "Loading the prepared preview…"; }
  else if (tryOn.demoShown && demo && demo.failed[TRY_DEMO[tryOn.demoShown]]) { apply.textContent = "Retry"; note = "Couldn't load this preview. Check your connection and try again."; }
  else if (id) { apply.textContent = "Done"; note = `A prepared ${TRY_IDEA[shown][1]} result. On your own photo, use any outfit photo, idea or words.`; }
  else apply.textContent = "Use your photo";
  $("panelNote").textContent = note; fitDock();
}
function tryDemoApply() {
  const shown = tryOn.demoShown;
  if (shown && demo && demo.failed[TRY_DEMO[shown]]) { showDemoPreview(TRY_DEMO[shown], "outfit"); return; }
  if (tryDemoOn()) { sel = null; renderEditor(); return; }
  pickAndOpen();
}
