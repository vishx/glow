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
const TRY_TABS = [["outfits", "Outfits"], ["color", "Color"], ["pattern", "Pattern"], ["fabric", "Fabric"], ["part", "Part"]];
// The sample's prepared previews (made with the earlier Suit and Summer dress tools).
const TRY_DEMO = { suit: "suit", sundress: "sundress" };
const CLOSET_MAX = 8, LOOKS_MAX = 8;

const tryOn = { src: "ideas", idea: "suit", color: "", pattern: "", fabric: "", words: "", part: "auto", tab: "outfits", cat: "popular",
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
  if (tryOn.src === "photo") return outfitData ? { extra: outfitData, part: tryOn.part, label: "Your outfit" } : null;
  const style = tryStyleWords();
  if (tryOn.src === "words") {
    const w = tryOn.words.trim().slice(0, 160); if (!w) return null;
    return { prompt: style ? `${w}, ${style}` : w, part: tryOn.part, label: w.length > 24 ? w.slice(0, 22) + "…" : w };
  }
  const i = TRY_IDEA[tryOn.idea]; if (!i) return null;
  const bits = [tryOn.color ? tryColor()[0] : "", tryOn.pattern ? tryPattern()[1].toLowerCase() : "", tryOn.fabric ? tryFabric()[1].toLowerCase() : ""].filter(Boolean);
  const name = bits.length ? `${bits[0]} ${[...bits.slice(1), i[1].toLowerCase()].join(" ")}` : i[1];
  return { prompt: style ? `${i[2]}, ${style}` : i[2], part: part(i[3]), label: name.charAt(0).toUpperCase() + name.slice(1) };
}

// A free look at her photo before anything is charged: try-on needs the clothes to be in it.
async function tryCheck() {
  const base = committed();
  if (tryOn.checkFor === base) return;
  tryOn.checkFor = base; tryOn.check = null;
  let msg = "";
  try {
    const boxes = await faceBoxes(base);
    if (!boxes.length) msg = "No person found. Try on works on a photo of you.";
    else if (boxes.length > 1 && boxes[1].w * boxes[1].h > boxes[0].w * boxes[0].h * 0.7) msg = "Works best with one person in the photo. The largest person is dressed.";
    // How much of her is below the chin, in face heights: about 2 for a head-and-shoulders photo,
    // 3 to 4 from the waist up, 7 head to toe.
    else if ((1 - boxes[0].y - boxes[0].h) / boxes[0].h < 2.5) msg = "Little of your outfit shows here, so the AI guesses the rest. A waist-up photo works best.";
  } catch { msg = ""; }
  if (tryOn.checkFor !== base) return;
  tryOn.check = msg;
  // The panel has no room for a note line, so the check is said once per photo, just above the dock.
  if (msg && sel === "outfit" && tryOn.checkSaid !== base) { tryOn.checkSaid = base; say(msg); }
  if (sel === "outfit") renderPanel();
}

// ---------- Outfit pictures ----------
// Flat fashion sketches drawn here (no downloads): front views on a light card, like the product
// shots in shop apps. They take on the color, pattern and fabric she picks.
const G_TEE = "M23 7Q30 11 37 7L46 10L54 20L48 24L45 20L45 39L15 39L15 20L12 24L6 20L14 10Z";
const G_LONG = "M23 7Q30 11 37 7L46 10Q51 13 52 21L55 38L49 39L45 23L45 39L15 39L15 23L11 39L5 38L8 21Q9 13 14 10Z";
const G_COAT = "M23 7Q30 11 37 7L46 10Q51 13 52 21L55 50L49 51L46 25L47 67L13 67L14 25L11 51L5 50L8 21Q9 13 14 10Z";
const G_PANTS = "M16 38L44 38L46 72L35 72L30 47L25 72L14 72Z";
const G_STRAP = "M21 14Q30 17 39 14L40 30L50 60Q30 65 10 60L20 30Z";
const G_GOWN = "M21 14Q30 17 39 14L40 30L54 72Q30 75 6 72L20 30Z";
const G_SHEATH = "M19 9Q30 13 41 9L46 11L48 19L42 20L41 31L44 58Q30 61 16 58L19 31L18 20L12 19L14 11Z";
const G_MAXI = "M23 7Q30 11 37 7L46 10Q51 13 52 21L55 38L49 39L45 24L44 31L52 72Q30 75 8 72L16 31L15 24L11 39L5 38L8 21Q9 13 14 10Z";
const G_KNITDRESS = "M23 7Q30 11 37 7L46 10Q51 13 52 21L55 38L49 39L45 24L45 60Q30 62 15 60L15 24L11 39L5 38L8 21Q9 13 14 10Z";
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
// One sketch: shape, main color, second color (shirt, trousers), pattern on the main piece, finish.
function outfitSVG(pic, o = {}) {
  let [shape, main, second, pattern, finish] = pic;
  if (o.color) main = o.color;
  if (o.pattern !== undefined && o.pattern !== null) pattern = o.pattern;
  if (o.fabric) finish = "f-" + o.fabric;
  second = second || main;
  const pid = `gp${++gUid}`, fid = `gf${gUid}`;
  const defs = (pattern ? gPattern(pid, pattern, main) : "") + (finish && finish !== "zipside" ? gPattern(fid, finish, main) : "");
  const fill = (d) => `<path d="${d}" fill="${main}"/>` + (pattern ? `<path d="${d}" fill="url(#${pid})"/>` : "") + (finish && finish !== "zipside" ? `<path d="${d}" fill="url(#${fid})"/>` : "") + gLine(d, 0.8, 0.22);
  const plain = (d, c) => `<path d="${d}" fill="${c}"/>` + gLine(d, 0.8, 0.22);
  const inner = (c) => `<path d="M25 8L35 8L34 39L26 39Z" fill="${c}"/>`;
  const lapels = gLine("M25 8L27 21L30 26L33 21L35 8") + `<circle cx="30" cy="30" r=".9" fill="#000" fill-opacity=".35"/><circle cx="30" cy="35" r=".9" fill="#000" fill-opacity=".35"/>`;
  const straps = gLine("M22 14L23 5M38 14L37 5", 1, 0.45);
  let s = "";
  switch (shape) {
    case "suit": s = plain(G_PANTS, main) + fill(G_LONG) + `<path d="M25 8L30 25L35 8Z" fill="${second}"/>` + lapels; break;
    case "tux": s = plain(G_PANTS, main) + fill(G_LONG) + `<path d="M25 8L30 25L35 8Z" fill="${second}"/>` + lapels + `<path d="M27 10L30 11.5L33 10L33 13L30 11.5L27 13Z" fill="#111"/>`; break;
    case "blazer": s = fill(G_LONG) + `<path d="M25 8L30 26L35 8Z" fill="${second}"/>` + lapels; break;
    case "jacket": s = fill(G_LONG) + inner(second) + gLine("M25 8L25 39M35 8L35 39") + (finish === "zipside" ? gLine("M33 9L28 22L31 39", 0.9, 0.5) : gLine("M17 22L23 22M37 22L43 22", 0.9)); break;
    case "jacketpants": s = plain(G_PANTS, second) + fill(G_LONG) + inner("#1d1b1e") + gLine("M25 8L25 39M35 8L35 39M15 37L45 37"); break;
    case "trench": s = fill(G_COAT) + gLine("M25 8L27 20L30 24L33 20L35 8M30 24L30 67M14 34L46 34", 0.9) + `<rect x="14" y="32.5" width="32" height="3" fill="#000" fill-opacity=".14"/>`; break;
    case "coat": s = fill(G_COAT) + gLine("M25 8L27 20L30 24L33 20L35 8M30 24L30 67", 0.9); break;
    case "shirt": s = plain(G_PANTS, second) + fill(G_LONG) + gLine("M23 7L27 13L30 10L33 13L37 7M30 10L30 39"); break;
    case "teejeans": s = plain(G_PANTS, second) + gLine("M30 38L30 46M19 41L23 41M37 41L41 41", 0.8, 0.3) + fill(G_TEE) + gLine("M24 8Q30 13 36 8", 0.8); break;
    case "linenset": s = fill(G_PANTS) + fill(G_LONG) + gLine("M23 7L27 13L30 10L33 13L37 7M30 10L30 39"); break;
    case "polo": s = plain(G_PANTS, second) + fill(G_TEE) + gLine("M24 7L27 12L30 9L33 12L36 7M30 9L30 16"); break;
    case "hoodie": s = fill(G_LONG) + `<path d="M21 10Q21 1 30 1Q39 1 39 10Q30 15 21 10Z" fill="${main}"/>` + gLine("M21 10Q21 1 30 1Q39 1 39 10Q30 15 21 10ZM22 29L38 29L36 37L24 37Z") + gLine("M28 13L27 20M32 13L33 20", 0.8); break;
    case "sweater": s = fill(G_LONG) + gLine("M24 8Q30 12 36 8M17 36L43 36M22 14L22 34M30 14L30 34M38 14L38 34", 0.8, 0.22); break;
    case "puffer": s = fill(G_LONG) + gLine("M15 16L45 16M15 22.5L45 22.5M15 29L45 29M15 35L45 35M30 9L30 39", 0.9, 0.35); break;
    case "track": s = fill(G_PANTS) + fill(G_LONG) + gLine("M30 8L30 39M8 21L5 38M52 21L55 38", 0.9, 0.35); break;
    case "varsity": s = fill(G_LONG) + `<path d="M8 21Q9 13 14 10L15 23L11 39L5 38ZM52 21Q51 13 46 10L45 23L49 39L55 38Z" fill="${second}"/>` + gLine("M30 8L30 39M15 37L45 37") + `<circle cx="22" cy="20" r="2.4" fill="${second}"/>`; break;
    case "strap": s = straps + fill(G_STRAP) + gLine("M21 30Q30 32 40 30", 0.8); break;
    case "gown": s = straps + fill(G_GOWN) + gLine("M21 30Q30 32 40 30", 0.8); break;
    case "sheath": s = fill(G_SHEATH) + gLine("M23 10Q30 15 37 10", 0.8); break;
    case "sequin": s = fill(G_SHEATH) + [[24, 24], [33, 28], [27, 36], [36, 44], [22, 48], [30, 52], [38, 34], [26, 16], [34, 18]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r=".9" fill="#fff" opacity=".85"/>`).join(""); break;
    case "maxi": s = fill(G_MAXI) + gLine("M16 31Q30 33 44 31", 0.8); break;
    case "shirtdress": s = fill(G_KNITDRESS) + gLine("M23 7L27 13L30 10L33 13L37 7M30 10L30 60") + `<rect x="15" y="29" width="30" height="3" fill="#000" fill-opacity=".16"/>`; break;
    case "knitdress": s = fill(G_KNITDRESS) + gLine("M24 8Q30 12 36 8M15 57L45 57M21 14L21 55M27 14L27 55M33 14L33 55M39 14L39 55", 0.7, 0.18); break;
  }
  return `<svg viewBox="0 0 60 75" aria-hidden="true" focusable="false"><defs>${defs}</defs>${s}</svg>`;
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
  const set = { color: !!tryOn.color, pattern: !!tryOn.pattern, fabric: !!tryOn.fabric, part: tryOn.part !== "auto" };
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
      const b = tryTile({ cls: "outfit", pic: outfitSVG(it[4], style), label: it[1], on, onClick: () => { tryOn.src = "ideas"; tryOn.idea = id; tryChanged(); } });
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
function tryPartRow(body) {
  const row = tryKeepScroll(document.createElement("div"), "part"); row.className = "try-strip parts"; row.setAttribute("role", "group"); row.setAttribute("aria-label", "What to change");
  const pics = { auto: ["suit", "#c9b9a3", "#f4f1ec"], top: ["blazer", "#c9a14a", "#f4f1ec"], bottom: ["teejeans", "#d9d4cc", "#c9a14a"], full: ["suit", "#c9a14a", "#f4f1ec"] };
  TRY_PARTS.forEach(([label, v]) => {
    const b = tryTile({ cls: "outfit part", pic: v === "auto" ? "" : outfitSVG(pics[v]), icon: v === "auto" ? "sparkle" : "", label, on: tryOn.part === v,
      aria: v === "auto" ? "Auto: the AI decides what to change" : `Change the ${label.toLowerCase()}`, onClick: () => { tryOn.part = v; tryChanged(); } });
    b.dataset.part = v; row.append(b);
  });
  body.append(row);
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
    const b = tryTile({ cls: has ? "photo" : "outfit locked", img: pic, pic: has ? "" : outfitSVG(it[4]), label: it[1], on: tryDemoOn() === id,
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
