// ---------- Feature switches (feature flags) ----------
// Every tool and feature that can be switched on or off from the admin page (Features tab),
// without an app release. Loaded before app.js, and by admin.html for the list itself.
//
// How a switch is decided, in order (the same ideas as Firebase Remote Config, LaunchDarkly,
// Statsig and PostHog, made small):
//  1. The server's answer for this account (my_features(), migration 013): off, testers only, a
//     percentage of people (a stable hash of the switch and the account, so raising 10% to 50%
//     keeps the first 10%), or on; optionally only some platforms or newer builds.
//  2. The last answer this device got (kept in localStorage), so the app opens with the right
//     tools at once, with no flicker, and offline.
//  3. The built-in default below, used when the server has never been reached or has no row for
//     the switch. Everything already released defaults to on, so an outage never hides tools;
//     retired tools default to off. A new tool ships with default false and is switched on from
//     the admin page once it's tested, so phone apps can carry it "dark" until then.
// The enhance function checks the same switches before it charges, so a tool switched off
// mid-session can't cost anyone a credit.

// The build number sent with each check, so a switch can require a newer app (min build).
// Bump it (YYYYMMDD, or YYYYMMDD + one more digit for a second release that day) whenever a
// release changes how a switchable feature behaves.
const APP_BUILD = 202610360;

// Retired from the app (Oct 30 audit): they changed the face, returned the wrong framing, duplicated
// another tool, or (body reshaping) didn't fit Glow Studio. Their code stays so saved drafts still
// replay, and they can come back for testers from the admin page.
const RETIRED_TOOLS = ["smile", "relight", "older", "younger", "expand", "upscale", "faces", "bgcut", "bgwhite", "bgblush", "bgsky",
  "anime", "watercolor", "toon3d", "clay", "gown", "street", "hair_waves", "hair_bob", "hair_pixie", "hair_bangs", "hair_curls",
  "hair_bun", "hair_braids", "hair_butterfly", "bwaist", "bhips", "barms", "bslimlegs", "blegs"];

const RETIRED_NAMES = { smile: "Add a smile", relight: "Relight", older: "Make older", younger: "Make younger", expand: "Expand",
  upscale: "Upscale 4x", faces: "Face repair", bgcut: "HD cutout", bgwhite: "White background", bgblush: "Blush background",
  bgsky: "Sky background", anime: "Anime", watercolor: "Watercolor", toon3d: "3D Toon", clay: "Clay", gown: "Evening gown",
  street: "Streetwear", hair_waves: "Hair: long waves", hair_bob: "Hair: sleek bob", hair_pixie: "Hair: pixie cut",
  hair_bangs: "Hair: curtain bangs", hair_curls: "Hair: curls", hair_bun: "Hair: high bun", hair_braids: "Hair: braids",
  hair_butterfly: "Hair: butterfly cut", bwaist: "Body: waist", bhips: "Body: hips", barms: "Body: arms", bslimlegs: "Body: slim legs",
  blegs: "Body: longer legs" };

// [area, [[key, label, default on, note], ...]]. Editor tool keys are "tool:" + the tool's id (all
// filters share "tool:filters"). Core flows (Enhance itself, saving, the paywall, Settings) have
// no switch: without them the app wouldn't work.
const FEATURE_AREAS = [
  ["Main screens", [
    ["screen:camera", "Camera tab", true, "Hides the Camera tab and its shortcuts. The app opens on Enhance instead."],
    ["screen:editor", "Editor tab", true, "Hides the Editor tab and every Edit button that leads to it."],
    ["editor:quick", "Quick actions on Editor home", true, "The photo tiles under Choose a photo. Each tile is also hidden when its tool is off."],
    ["app:liveupdate", "Phone app live updates", true, "On each open the Android/iPhone app downloads the newest screens from this site and switches to them. Off pauses it: phones keep what they have. To roll phones back, roll the website back."],
    ["app:home", "Add to home screen prompt", true, "Asked once, a few seconds after the first saved photo (Android app, phone browsers). Settings keeps an Add to home screen row."],
  ]],
  ["Enhance", [
    ["enhance:retouch", "Face Retouch switch", true, "On the Enhance result."],
    ["enhance:colors", "Colors switch", true, "On the Enhance result."],
    ["enhance:blur", "Background Blur switch", true, "On the Enhance result."],
    ["account:signin", "Sign in with Apple/Google (Settings)", false, "Turn on after the Apple and Google providers are set up in Supabase Auth."],
    ["money:firstglow", "First glow invite", true, "Until someone has enhanced a photo, Choose a photo reads \"Glow up your first photo · Free\"."],
    ["erase:tap", "Remove: tap to select + find distractions", true, "On-device, free. Adds a Tap mode and a Find distractions button to Remove."],
    ["studio:trends", "Studio: Trends", true, "One-tap templates on the Enhance home (2 credits each)."],
    ["studio:headshots", "Studio: Headshot pack", true, "Four headshot styles (2 credits each)."],
    ["studio:hair", "Studio: Try-on grid", true, "Hairstyles (1 credit each), free hair colors and makeup looks."],
    ["studio:oldphoto", "Studio: Old photo", true, "Repair an old photo (2 credits), then color it."],
    ["studio:groupfix", "Studio: Group fix", true, "Open eyes and best expressions (2 credits)."],
    ["studio:motion", "Studio: Photo to motion", true, "A 5-second clip (4 credits)."],
    ["studio:me", "Studio: Me selfies", true, "Reference selfies sent with AI looks to keep the face true."],
    ["enhance:texture", "Natural texture switch", true, "On the Enhance result: keeps real skin texture on restored faces."],
    ["enhance:batch", "Batch Enhance (Pro)", true, "Enhance up to 10 photos at once."],
    ["enhance:pro", "Pro Edit choice", true, "A photographer-style edit, 2 credits. Also needs Editor · Pro edit on (same AI)."],
  ]],
  ["Studio trends", [
    ["studio:trend:figurine", "Trend: Mini Me figurine", true], ["studio:trend:yearbook", "Trend: Yearbook '98", true],
    ["studio:trend:poster", "Trend: Movie poster", true], ["studio:trend:polaroid", "Trend: Instant film", true],
    ["studio:trend:thennow", "Trend: Then & Now", true], ["studio:trend:snow", "Trend: First snow", true, "Seasonal: shows 15 Nov to 28 Feb."],
    ["studio:trend:holiday", "Trend: Holiday card", true, "Seasonal: shows 15 Nov to 6 Jan."],
  ]],
  ["Camera", [
    ["camera:ai", "AI Enhance on photos", true, "The AI switch and the AI Enhance button after a shot."],
    ["camera:flash", "Selfie screen flash", true],
    ["camera:face", "Face shape (eyes, slim, nose)", true, "Live reshaping in Adjust."],
    ["camera:makeup", "Live makeup (lips, blush, brows)", true, "In Adjust."],
    ["camera:filters", "Filters", true, "In Adjust."],
  ]],
  ["Editor · Beauty", [
    ["tool:glowup", "Glow Up", true], ["tool:fsmooth", "Smooth skin", true], ["tool:fblemish", "Blemishes", true],
    ["tool:feyes", "Brighten eyes", true], ["tool:fslim", "Face shape", true], ["tool:fnose", "Nose shape", true],
    ["tool:fundereye", "Under-eyes", true], ["tool:fauto", "Auto beauty", true], ["tool:ftone", "Even tone", true],
    ["tool:fskin", "Skin finish", true], ["tool:fbigeyes", "Eye size", true], ["tool:fteeth", "Whiten teeth", true],
    ["tool:retouch", "AI retouch", true, "AI, uses credits."],
    ["tool:fglam", "Makeup looks", true], ["tool:flips", "Lip color", true], ["tool:fblush", "Blush", true],
    ["tool:flashes", "Lashes", true], ["tool:fliner", "Eyeliner", true], ["tool:fshadow", "Eyeshadow", true],
    ["tool:fbrows", "Brows", true], ["tool:feyecolor", "Eye color", true], ["tool:fcontour", "Contour", true],
    ["tool:fhighlight", "Highlighter", true], ["tool:fbronzer", "Bronzer", true], ["tool:hcolor", "Hair color", true],
    ["tool:bposture", "Posture (subtle body)", true, "In Search, capped to a natural range."], ["tool:btailor", "Tailor fit (subtle body)", true, "In Search, capped to a natural range."],
  ]],
  ["Editor · Looks", [
    ["tool:filters", "Filters (all)", true],
    ["tool:headshot", "Headshot", true, "AI, uses credits."], ["tool:fashion", "Fashion shoot", true, "AI, uses credits."],
    ["tool:golden", "Golden hour", true, "AI, uses credits."],
    ["tool:outfit", "Try on an outfit", true, "AI, uses credits."], ["tool:suit", "Business suit", true, "AI, uses credits. Inside Try on."],
    ["tool:sundress", "Summer dress", true, "AI, uses credits. Inside Try on."],
    ["tool:mylook", "My Look (camera looks)", true, "In Search."],
  ]],
  ["Editor · Adjust", [
    ["edit:areas", "Full / Person / Background chips", true, "Lets every Adjust slider change only the person or only the background."],
    ["tool:crop", "Crop and rotate", true], ["tool:exposure", "Exposure", true], ["tool:light", "Brightness", true], ["tool:contrast", "Contrast", true],
    ["tool:highlights", "Highlights", true], ["tool:shadows", "Shadows", true], ["tool:whites", "Whites", true], ["tool:blacks", "Blacks", true],
    ["tool:color", "Saturation", true], ["tool:vibrance", "Vibrance", true], ["tool:warmth", "Temperature", true], ["tool:tint", "Tint", true],
    ["tool:texture", "Texture", true], ["tool:clarity", "Clarity", true], ["tool:dehaze", "Dehaze", true], ["tool:detail", "Sharpen", true],
    ["tool:lnoise", "Reduce noise", true], ["tool:cnoise", "Reduce color noise", true],
    ["tool:fade", "Fade", true], ["tool:vignette", "Vignette", true], ["tool:grain", "Grain", true],
  ]],
  ["Editor · Background", [
    ["tool:bgblur", "Portrait blur", true], ["tool:bgremove", "Cutout", true], ["tool:bgcolor", "Color background", true],
    ["tool:bgphoto", "Your background", true], ["tool:bgscene", "AI background", true, "AI, uses credits."],
  ]],
  ["Editor · AI", [
    ["tool:pro", "Pro edit", true, "AI, uses credits."], ["tool:enhance", "Enhance (in the Editor)", true, "AI. The Enhance tab itself has no switch."],
    ["tool:colorize", "Colorize", true, "AI, uses credits."],
    ["tool:erase", "Remove", true, "AI, uses credits."], ["tool:fill", "Fill", true, "AI, uses credits."],
    ["tool:custom", "Describe an edit", true, "AI, uses credits."],
  ]],
  ["Money and sharing", [
    ["money:packs", "Credit packs", true, "Buying 10, 30 or 80 credits."],
    ["money:web", "Web checkout", true, "Pro and credit packs by card on the website (RevenueCat Web Billing, Stripe). Needs the web key in app.js."],
    ["money:ads", "Watch an ad for a credit", true, "Free plan."],
    ["money:intro", "Pro screen at the first result", true, "Once per install, after the first Enhance result or editor save. Phone app only."],
    ["share:app", "Share Glow Studio link", true, "The Share Glow Studio link in Settings (sends the app's address)."],
    ["share:pair", "Before & after in Share", true, "The Share sheet offers Before & after (and Video) when the original has the same shape."],
    ["share:video", "Before & after video", true, "The Share sheet's 5-second reveal video."],
  ]],
  ["Retired tools", RETIRED_TOOLS.map((id) => ["tool:" + id, RETIRED_NAMES[id] || id, false])],
];
const FEATURE_DEFAULTS = Object.fromEntries(FEATURE_AREAS.flatMap(([, list]) => list.map(([k, , d]) => [k, d])));

// The editor's switch for a tool id (filters share one).
const toolKey = (id) => (String(id).startsWith("filter:") ? "tool:filters" : "tool:" + id);

const Features = (() => {
  const KEY = "glowFeatures";
  let server = {}, tester = false, at = 0, inflight = null;
  const listeners = [];
  try {
    const c = JSON.parse(localStorage.getItem(KEY) || "null");
    if (c && c.flags && typeof c.flags === "object") { server = c.flags; tester = !!c.tester; at = c.at || 0; }
  } catch {}
  const on = (key) => (typeof server[key] === "boolean" ? server[key] : FEATURE_DEFAULTS[key] !== false);
  // Asks the server again (at most once a minute unless forced). Returns true if anything changed.
  // A failed check keeps what the device already knows: it never switches things off on its own.
  async function refresh({ force = false, session, url, apikey, platform } = {}) {
    if (!session || !url) return false;
    if (!force && Date.now() - at < 60000) return false;
    if (inflight) return inflight;
    inflight = (async () => {
      try {
        const res = await fetch(`${url}/rest/v1/rpc/my_features`, {
          method: "POST", headers: { "Content-Type": "application/json", apikey, Authorization: `Bearer ${session.access_token}` },
          body: JSON.stringify({ p_platform: platform, p_build: APP_BUILD }),
        });
        if (!res.ok) { at = Date.now(); return false; }   // before migration 013 (404) or an outage: defaults and the cache stay
        const d = await res.json();
        if (!d || typeof d.flags !== "object") return false;
        const next = Object.fromEntries(Object.entries(d.flags).filter(([, v]) => typeof v === "boolean"));
        const before = Object.keys(FEATURE_DEFAULTS).concat(Object.keys(server), Object.keys(next)).some((k) => on(k) !== (typeof next[k] === "boolean" ? next[k] : FEATURE_DEFAULTS[k] !== false));
        const changed = before || tester !== !!d.tester;
        server = next; tester = !!d.tester; at = Date.now();
        try { localStorage.setItem(KEY, JSON.stringify({ flags: server, tester, at })); } catch {}
        if (changed) listeners.forEach((f) => { try { f(); } catch (e) { console.error(e); } });
        return changed;
      } catch { at = Date.now(); return false; }
      finally { inflight = null; }
    })();
    return inflight;
  }
  return { on, refresh, onChange: (f) => listeners.push(f), get tester() { return tester; }, get checkedAt() { return at; },
    // For tests and the admin's "this device" view.
    get server() { return { ...server }; } };
})();
const featureOn = (key) => Features.on(key);
