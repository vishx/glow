// Studio (2026-11-02 ideas): one-tap AI creations that don't fit the editor's single-step tools.
// Trends gallery (weekly templates), Headshot pack, Hairstyle grid (with free hair colors and makeup
// looks), Old Photo repair, Group fix, Photo to motion, and "Me" reference selfies that keep the
// face true in AI looks. Every run is one server job per result, charged and refunded by the server
// exactly like the editor's AI tools; a dropped connection never charges twice (request ids).

// ---------- What can be made ----------
// cost: credits per result (the server's ai_edit_cost, migration 021). me: the Me selfies go along.
// check: compare the face before and after (styles that redraw the whole picture are skipped).
// added: when a trend joined (shown as New for a week). season: [fromMonthDay, toMonthDay] it shows.
const TRENDS = [
  { mode: "trend_figurine", name: "Mini Me figurine", desc: "You as a boxed collectible on a desk", icon: "pro", added: "2026-11-02" },
  { mode: "trend_yearbook", name: "Yearbook '98", desc: "A 90s school portrait", icon: "camera", added: "2026-11-02" },
  { mode: "trend_poster", name: "Movie poster", desc: "The lead in your own film", icon: "golden", added: "2026-11-02" },
  { mode: "trend_polaroid", name: "Instant film", desc: "A faded 90s instant photo", icon: "gallery", added: "2026-11-02" },
  { mode: "trend_thennow", name: "Then & Now", desc: "Hug your younger self (add a childhood photo)", icon: "mylook", extra: "child", added: "2026-11-02" },
  { mode: "trend_snow", name: "First snow", desc: "Soft snow and winter light", icon: "sparkle", season: ["11-15", "02-28"], added: "2026-11-02" },
  { mode: "trend_holiday", name: "Holiday card", desc: "Cozy lights and a decorated tree", icon: "star", season: ["11-15", "01-06"], added: "2026-11-02" },
].map((t) => ({ ...t, cost: 2, me: true }));
const HEADSHOTS = [
  { mode: "hs_office", name: "Office", desc: "Business attire, studio gray" },
  { mode: "hs_creative", name: "Creative", desc: "Smart casual, warm interior" },
  { mode: "hs_dating", name: "Dating", desc: "Relaxed, golden-hour outdoors" },
  { mode: "hs_passport", name: "Passport", desc: "Straight on, plain background" },
].map((t) => ({ ...t, cost: 2, me: true, check: true, icon: "pro" }));
const HAIRSTYLES = [
  ["hair_waves", "Long waves"], ["hair_lob", "Lob"], ["hair_bob", "Sleek bob"], ["hair_pixie", "Pixie"], ["hair_shag", "Shag"],
  ["hair_curls", "Curls"], ["hair_bangs", "Curtain bangs"], ["hair_bun", "High bun"], ["hair_braids", "Braids"], ["hair_afro", "Afro"],
  ["hair_buzz", "Buzz cut"], ["hair_fade", "Skin fade"], ["hair_slick", "Slicked back"], ["hair_beard", "Full beard"], ["hair_silver", "Silver"],
].map(([mode, name]) => ({ mode, name, cost: 1, me: true, check: true, icon: mode }));
const HAIR_COLORS = [["Copper", "#b5562a"], ["Auburn", "#8d3b1f"], ["Honey blonde", "#c9a063"], ["Ash brown", "#6b5a4e"], ["Jet black", "#1b1714"],
  ["Rose", "#d97a9b"], ["Lilac", "#9b84c9"], ["Silver", "#b9b9c2"], ["Cherry", "#8e1f2f"]];
const MAKEUP_GRID = [["natural", "Natural"], ["night", "Night out"], ["red", "Red lip"], ["bridal", "Bridal"]];
const MOTIONS = [
  ["breeze", "Blink and breeze", "subtle natural motion: the person blinks softly and breathes, a gentle breeze moves their hair"],
  ["snow", "Falling snow", "soft snowflakes fall gently around the person, who blinks and smiles slightly"],
  ["confetti", "Confetti", "colorful confetti drifts down around the person, who smiles and laughs softly"],
  ["wind", "Hair in the wind", "a steady breeze lifts and moves the person's hair, slow cinematic camera push in"],
];
const STUDIO_KINDS = {
  trends: { title: "Trends", sub: "One tap, no typing. New looks every week.", icon: "sparkle" },
  headshots: { title: "Headshot pack", sub: "Four pro headshots from one selfie.", icon: "pro" },
  hair: { title: "Try-on grid", sub: "See hairstyles, colors and makeup side by side.", icon: "hcolor" },
  oldphoto: { title: "Old photo", sub: "Repair scratches and fading, then add color.", icon: "colorize" },
  groupfix: { title: "Group fix", sub: "Open eyes and best expressions for everyone.", icon: "faces" },
  motion: { title: "Photo to motion", sub: "A 5-second clip from one photo.", icon: "golden" },
  me: { title: "Me", sub: "Your selfies keep your face true in AI looks.", icon: "mylook" },
};
const STUDIO_FEATURE = { trends: "studio:trends", headshots: "studio:headshots", hair: "studio:hair", oldphoto: "studio:oldphoto", groupfix: "studio:groupfix", motion: "studio:motion", me: "studio:me" };
const MOTION_COST = 4, OLD_COST = 2, GROUP_COST = 2;

const studio = { kind: null, photo: null, extra: null, refs: [], picked: new Set(), results: [], running: false, motion: "breeze", stop: null };

// ---------- Weekly ritual: what's new, what's in season ----------
const dayKey = (d) => `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
function inSeason(t, now = new Date()) {
  if (!t.season) return true;
  const k = dayKey(now), [a, b] = t.season;
  return a <= b ? k >= a && k <= b : k >= a || k <= b;
}
const isNew = (t, now = Date.now()) => t.added && now - Date.parse(t.added) < 7 * 86400000;
// The week's featured trend rotates through what's in season, so there's always a fresh drop.
function trendOfWeek(now = new Date()) {
  const list = TRENDS.filter((t) => inSeason(t, now)), week = Math.floor(now.getTime() / (7 * 86400000));
  return list.find((t) => t.season) || list[week % list.length];
}
const trendsShown = () => TRENDS.filter((t) => inSeason(t) && featureOn("studio:trend:" + t.mode.slice(6)));

// ---------- Me: reference selfies ----------
const ME_MAX = 3;
let mePhotos = null;
async function loadMe() {
  if (mePhotos) return mePhotos;
  try { mePhotos = (await Drafts.read("mePhotos")) || []; } catch { mePhotos = []; }
  return mePhotos;
}
const meOn = () => store.get("glowMeUse") !== "off";
async function meRefs() { return meOn() && featureOn("studio:me") ? (await loadMe()).slice(0, ME_MAX) : []; }
async function addMePhotos() {
  const files = await Platform.pickPhotos("files");
  const list = await loadMe();
  for (const f of files.slice(0, ME_MAX - list.length)) {
    try { const r = await readPhoto(f, f.name); list.push(await uploadable(r.work, 1024, 1_000_000)); } catch (e) { say(e.message, true); }
  }
  await Drafts.write("mePhotos", list).catch(() => {});
  track("me_photos", { count: list.length });
}

// ---------- Entry points ----------
function renderStudioStrip() {
  const strip = $("studioStrip"); if (!strip) return;
  const wk = trendOfWeek();
  strip.innerHTML = "";
  for (const [k, s] of Object.entries(STUDIO_KINDS)) {
    if (!featureOn(STUDIO_FEATURE[k])) continue;
    const b = document.createElement("button");
    b.className = "studio-card"; b.dataset.kind = k; b.setAttribute("role", "listitem");
    const tag = k === "trends" && wk ? `<span class="studio-new">New: ${esc(wk.name)}</span>` : "";
    b.innerHTML = `<span class="studio-ic">${icon(s.icon)}</span><b>${esc(s.title)}</b><small>${esc(s.sub)}</small>${tag}`;
    b.addEventListener("click", () => openStudio(k));
    strip.append(b);
  }
  $("studioWrap").hidden = !strip.children.length;
}

async function openStudio(kind) {
  if (studio.running) { $("studio").showModal(); return; }
  Object.assign(studio, { kind, results: [], picked: new Set(), extra: null, refs: [], running: false });
  if (kind === "headshots") HEADSHOTS.forEach((t) => studio.picked.add(t.mode));
  if (kind === "hair") ["hair_waves", "hair_bob", "hair_pixie", "hair_curls", "hair_buzz", "hair_fade"].forEach((m) => studio.picked.add(m));
  if (kind === "trends") { const w = trendOfWeek(); if (w) studio.picked.add(w.mode); }
  $("studioTitle").textContent = STUDIO_KINDS[kind].title;
  track("studio_open", { kind });
  if (!$("studio").open) $("studio").showModal();
  if (kind === "me") await loadMe();
  renderStudio();
}

// ---------- The sheet ----------
const costOfPick = () => {
  if (studio.kind === "motion") return MOTION_COST;
  if (studio.kind === "oldphoto") return OLD_COST;
  if (studio.kind === "groupfix") return GROUP_COST;
  return [...studio.picked].reduce((n, m) => n + (studioItem(m)?.cost || 0), 0);
};
const studioItem = (mode) => [...TRENDS, ...HEADSHOTS, ...HAIRSTYLES].find((t) => t.mode === mode);
const needsExtra = () => studio.kind === "trends" && [...studio.picked].some((m) => studioItem(m)?.extra);

function renderStudio() {
  const k = studio.kind, body = $("studioBody"), foot = $("studioFoot");
  $("studioSub").textContent = STUDIO_KINDS[k].sub;
  body.innerHTML = ""; foot.innerHTML = "";
  if (k === "me") return renderMe(body, foot);
  if (studio.results.length) return renderResults(body, foot);

  // 1. The photo (and, where needed, a second one).
  const pics = document.createElement("div"); pics.className = "studio-pics";
  pics.append(photoSlot(studio.photo, k === "oldphoto" ? "Choose the old photo" : k === "groupfix" ? "Choose the group photo" : "Choose a photo of you", async () => {
    const f = await Platform.pickPhoto("file"); if (!f) return;
    try { studio.photo = (await readPhoto(f, f.name)).work; renderStudio(); } catch (e) { say(e.message, true); }
  }));
  if (k === "oldphoto") {
    const scan = document.createElement("button"); scan.className = "btn quiet studio-scan"; scan.innerHTML = `${icon("camera")}<span>Scan a print with the camera</span>`;
    scan.addEventListener("click", async () => {
      const f = await Platform.pickPhoto("scanFile"); if (!f) return;
      try { studio.photo = (await readPhoto(f, f.name)).work; renderStudio(); say("Tip: crop the print's edges in the editor afterwards if needed."); } catch (e) { say(e.message, true); }
    });
    pics.append(scan);
  }
  if (needsExtra()) pics.append(photoSlot(studio.extra, "Add a childhood photo", async () => {
    const f = await Platform.pickPhoto("file"); if (!f) return;
    try { studio.extra = (await readPhoto(f, f.name)).work; renderStudio(); } catch (e) { say(e.message, true); }
  }, "child"));
  if (k === "groupfix") {
    for (let i = 0; i < 2; i++) if (studio.photo && (i === 0 || studio.refs[i - 1])) pics.append(photoSlot(studio.refs[i], i ? "Another shot (optional)" : "More shots of the same moment (optional)", async () => {
      const f = await Platform.pickPhoto("file"); if (!f) return;
      try { studio.refs[i] = await uploadable((await readPhoto(f, f.name)).work, 1280, 1_100_000); renderStudio(); } catch (e) { say(e.message, true); }
    }, "ref"));
  }
  body.append(pics);

  // 2. What to make.
  if (k === "trends") body.append(choices(trendsShown(), "one"));
  if (k === "headshots") body.append(choices(HEADSHOTS, "many"));
  if (k === "hair") {
    body.append(sectionTitle("AI hairstyles", "1 credit each, pick up to 6"), choices(HAIRSTYLES, "many", 6),
      sectionTitle("Free on your phone", "No credits: hair colors and makeup looks"));
    const free = document.createElement("div"); free.className = "studio-row";
    const hc = document.createElement("button"); hc.className = "btn quiet"; hc.textContent = "Hair color grid";
    hc.addEventListener("click", () => freeGrid("hair"));
    const mk = document.createElement("button"); mk.className = "btn quiet"; mk.textContent = "Makeup look grid";
    mk.addEventListener("click", () => freeGrid("makeup"));
    free.append(hc, mk); body.append(free);
  }
  if (k === "motion") {
    const row = document.createElement("div"); row.className = "opts studio-motions"; row.setAttribute("role", "radiogroup"); row.setAttribute("aria-label", "Motion");
    for (const [id, label] of MOTIONS) {
      const b = document.createElement("button"); b.className = "opt"; b.textContent = label; b.setAttribute("role", "radio");
      b.setAttribute("aria-checked", String(studio.motion === id)); b.setAttribute("aria-pressed", String(studio.motion === id));
      b.addEventListener("click", () => { studio.motion = id; renderStudio(); });
      row.append(b);
    }
    body.append(row);
  }
  if (["trends", "headshots", "hair"].includes(k)) body.append(meNote());
  if (k === "groupfix") body.append(note("Works best with everyone facing the camera. Extra shots of the same moment give each person's best eyes and smile."));
  if (k === "oldphoto") body.append(note("Repairs scratches, creases, dust and fading, and keeps it looking like the same photo. Add color and Enhance afterwards."));

  // 3. Go.
  const cost = costOfPick(), go = document.createElement("button");
  go.className = "btn glow"; go.id = "studioGo";
  const missing = !studio.photo ? "Choose a photo first" : needsExtra() && !studio.extra ? "Add the childhood photo" : !cost ? "Pick at least one" : "";
  go.disabled = !!missing;
  go.innerHTML = missing ? esc(missing) : `${icon("sparkle")}<span>${k === "motion" ? "Make the clip" : "Create"} · ${cost} ${cost === 1 ? "credit" : "credits"}</span>`;
  go.addEventListener("click", runStudio);
  foot.append(go, note(balanceNote(cost)));
}
function sectionTitle(t, sub) { const h = document.createElement("h3"); h.className = "studio-h"; h.innerHTML = `${esc(t)}${sub ? `<small>${esc(sub)}</small>` : ""}`; return h; }
function note(t) { const p = document.createElement("p"); p.className = "fine studio-note"; p.textContent = t; return p; }
function balanceNote(cost) {
  const a = account; if (!a) return "AI credits are checked when you start.";
  const have = a.plan === "pro" ? a.remaining : (a.trialLeft || 0) + (a.bonus || 0);
  return have < cost ? `You have ${have} premium ${have === 1 ? "credit" : "credits"}; this needs ${cost}.` : `You have ${have} ${have === 1 ? "credit" : "credits"}. Failed results are refunded.`;
}
function photoSlot(src, label, pick, kind = "") {
  const b = document.createElement("button"); b.className = "studio-slot" + (kind ? " " + kind : ""); b.setAttribute("aria-label", label);
  b.innerHTML = src ? `<img src="${src}" alt=""><span>Change</span>` : `${icon("gallery")}<span>${esc(label)}</span>`;
  b.addEventListener("click", pick);
  return b;
}
function choices(items, mode, max = 99) {
  const g = document.createElement("div"); g.className = "studio-grid"; g.setAttribute("role", mode === "one" ? "radiogroup" : "group");
  for (const t of items) {
    const on = studio.picked.has(t.mode), b = document.createElement("button");
    b.className = "studio-pick"; b.dataset.mode = t.mode; b.setAttribute(mode === "one" ? "aria-checked" : "aria-pressed", String(on)); if (mode === "one") b.setAttribute("role", "radio");
    b.innerHTML = `<span class="studio-ic">${icon(t.icon || "sparkle")}</span><b>${esc(t.name)}</b>${t.desc ? `<small>${esc(t.desc)}</small>` : ""}` +
      (isNew(t) ? `<span class="studio-badge">New</span>` : t.season ? `<span class="studio-badge">Seasonal</span>` : "") + `<span class="studio-cost">${t.cost}${icon("sparkle")}</span>`;
    b.addEventListener("click", () => {
      if (mode === "one") { studio.picked.clear(); studio.picked.add(t.mode); }
      else if (on) studio.picked.delete(t.mode);
      else if (studio.picked.size < max) studio.picked.add(t.mode);
      else { say(`Pick up to ${max}.`); return; }
      renderStudio();
    });
    g.append(b);
  }
  return g;
}
function meNote() {
  const p = document.createElement("p"); p.className = "fine studio-note";
  const n = (mePhotos || []).length;
  p.innerHTML = n && meOn() ? `Using your ${n} Me ${n === 1 ? "selfie" : "selfies"} to keep your face true. ` : "Add Me selfies to keep your face truer. ";
  const a = document.createElement("button"); a.className = "link-btn"; a.textContent = n ? "Manage" : "Add selfies";
  a.addEventListener("click", () => openStudio("me")); p.append(a);
  return p;
}

// ---------- Me ----------
function renderMe(body, foot) {
  const list = mePhotos || [];
  const g = document.createElement("div"); g.className = "studio-pics me";
  list.forEach((src, i) => {
    const s = document.createElement("div"); s.className = "studio-slot filled";
    s.innerHTML = `<img src="${src}" alt="Me selfie ${i + 1}">`;
    const x = document.createElement("button"); x.className = "icon-btn studio-x"; x.setAttribute("aria-label", `Remove selfie ${i + 1}`); x.innerHTML = icon("close");
    x.addEventListener("click", async () => { list.splice(i, 1); await Drafts.write("mePhotos", list).catch(() => {}); renderStudio(); });
    s.append(x); g.append(s);
  });
  if (list.length < ME_MAX) g.append(photoSlot(null, list.length ? "Add another selfie" : "Add 1 to 3 selfies", async () => { await addMePhotos(); renderStudio(); }));
  body.append(g, note("Clear, front-facing selfies in good light work best: one smiling, one neutral, one slightly turned. They stay on this phone and are only sent along with an AI look you start, then deleted by our AI provider within about an hour."));
  const sw = document.createElement("label"); sw.className = "toggle studio-toggle";
  sw.innerHTML = `Use my selfies in AI looks <input type="checkbox" role="switch" id="meUse" ${meOn() ? "checked" : ""}>`;
  sw.querySelector("input").addEventListener("change", (e) => { store.set("glowMeUse", e.target.checked ? "" : "off"); });
  body.append(sw);
  const done = document.createElement("button"); done.className = "btn glow"; done.textContent = "Done";
  done.addEventListener("click", () => $("studio").close());
  foot.append(done);
}

// ---------- Running ----------
async function studioJob(item, body, onLabel) {
  const h = { pending: null };
  const requestId = rid();
  h.pending = { requestId, id: null, mode: item.mode };
  const res = await call("enhance", { method: "POST", timeout: AI_POST_TIMEOUT, body: JSON.stringify({ ...body, mode: item.mode, tool: item.mode, from: "studio", platform: PLATFORM, build: APP_BUILD, request_id: requestId }) });
  h.pending.id = res.id || null;
  // A clip can take a few minutes: keep following it (checking is free) rather than give up.
  let url, tries = item.video ? 3 : 1;
  for (;;) {
    try { url = await followEnhance(h, url === undefined ? res : null, onLabel || (() => {}), "studio"); break; }
    catch (err) { if (!err.lost || --tries <= 0 || !h.pending) throw err; url = null; }
  }
  return { url, requestId };
}

async function runStudio() {
  if (studio.running) return;
  const k = studio.kind, cost = costOfPick();
  if (account) {
    const have = account.plan === "pro" ? account.remaining : (account.trialLeft || 0) + (account.bonus || 0);
    if (have < cost) { $("studio").close(); if (isPro()) openPaywall(); else openPacks(); return; }
  }
  const items = k === "motion" ? [{ mode: "motion", name: MOTIONS.find((m) => m[0] === studio.motion)[1], cost: MOTION_COST, video: true }]
    : k === "oldphoto" ? [{ mode: "oldphoto", name: "Repaired", cost: OLD_COST, check: true }]
    : k === "groupfix" ? [{ mode: "groupfix", name: "Group fix", cost: GROUP_COST }]
    : [...studio.picked].map((m) => ({ ...studioItem(m) }));
  studio.running = true;
  studio.results = items.map((t) => ({ ...t, status: "working" }));
  renderStudio();
  track("studio_run", { kind: k, count: items.length, cost });
  const image = await uploadable(studio.photo, k === "motion" ? 1280 : 1536, k === "motion" ? 1_000_000 : 2_400_000);
  const refs = k === "groupfix" ? studio.refs.filter(Boolean) : (await meRefs());
  const extra = needsExtra() && studio.extra ? await uploadable(studio.extra, 1280, 1_100_000) : undefined;
  // Two at a time: quick, without tripping the AI provider's limits on a low balance.
  let next = 0;
  const worker = async () => {
    while (next < studio.results.length) {
      const r = studio.results[next++];
      try {
        const body = { image, refs: r.me || k === "groupfix" ? (refs.length ? refs : undefined) : undefined, extra: studioItem(r.mode)?.extra ? extra : undefined,
          prompt: r.video ? MOTIONS.find((m) => m[0] === studio.motion)[2] : undefined };
        const out = await studioJob(r, body);
        r.requestId = out.requestId; r.startedAt = Date.now();
        if (r.video) { r.url = typeof out.url === "string" ? out.url : null; if (!r.url) throw new Error("The clip couldn't be made."); }
        else r.data = await enhResultData(out.url);
        r.status = "done";
        if (r.check && !r.video) r.drift = await faceDrift(studio.photo, r.data).catch(() => 0);
      } catch (err) {
        r.status = "failed"; r.error = err.message || "Couldn't make this one. Its credit was returned.";
        if (err.limit) { r.error = err.message; studio.results.slice(next).forEach((x) => { x.status = "failed"; x.error = "Not started: out of credits."; }); next = studio.results.length; }
      }
      renderStudioIfOpen();
    }
  };
  await Promise.all([worker(), worker()]);
  studio.running = false;
  refreshAccount();
  renderStudioIfOpen();
  const ok = studio.results.filter((r) => r.status === "done").length;
  if (!$("studio").open) say(ok ? `Your ${STUDIO_KINDS[k].title} ${ok === 1 ? "is" : "are"} ready.` : "Studio couldn't finish. Your credits were returned.", !ok, ok ? { label: "Open", run: () => $("studio").showModal() } : null);
  if (ok) Platform.haptic("success");
}
const renderStudioIfOpen = () => { if ($("studio").open && !["me"].includes(studio.kind)) renderStudio(); };

// The face before and after, as a few proportions measured between landmarks (eye spacing, nose,
// mouth, jaw), each relative to the face's size. Over ~0.09 apart, the face likely changed.
async function faceDrift(a, b) {
  const geo = async (src) => {
    const img = await loadImg(src), c = canvasFor(img, 1024); c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    const f = (await findAllFaces(detectCopy(c), 4))[0]; if (!f) return null;
    const P = f.map(([x, y]) => [x * c.width, y * c.height]), d = (i, j) => dist(P[i], P[j]), s = d(234, 454) || 1;
    return [d(33, 263) / s, d(1, 152) / s, d(61, 291) / s, d(10, 152) / s, d(129, 358) / s, d(159, 145) / s];
  };
  const [x, y] = await Promise.all([geo(a), geo(b)]);
  if (!x || !y) return 0;
  return Math.max(...x.map((v, i) => Math.abs(v - y[i]) / Math.max(0.05, v)));
}
const DRIFT_LIMIT = 0.09;

// ---------- Results ----------
function renderResults(body, foot) {
  const k = studio.kind, g = document.createElement("div");
  g.className = "studio-results" + (studio.results.length === 1 ? " one" : "");
  studio.results.forEach((r, i) => {
    const c = document.createElement("div"); c.className = "studio-res " + r.status;
    if (r.status === "working") c.innerHTML = `<div class="spinner"></div><span>${esc(r.name)}…</span>`;
    else if (r.status === "failed") c.innerHTML = `<span class="studio-fail">${esc(r.name)}</span><small>${esc(r.error || "")}</small>`;
    else if (r.video) c.innerHTML = `<video src="${r.url}" autoplay loop muted playsinline></video><span class="studio-lbl">${esc(r.name)}</span>`;
    else c.innerHTML = `<img src="${r.data}" alt="${esc(r.name)}"><span class="studio-lbl">${esc(r.name)}</span>` +
      (r.drift > DRIFT_LIMIT ? `<span class="studio-warn">Face may have changed</span>` : "");
    if (r.status === "done") { c.tabIndex = 0; c.setAttribute("role", "button"); c.setAttribute("aria-label", `Open ${r.name}`); c.addEventListener("click", () => openStudioResult(i)); }
    g.append(c);
  });
  body.append(g);
  const done = studio.results.filter((r) => r.status === "done");
  if (studio.running) { foot.append(note(`Making ${studio.results.length} ${studio.results.length === 1 ? "result" : "results"}. You can close this; Glow Studio keeps working and tells you when they're ready.`)); return; }
  if (!done.length) {
    const again = document.createElement("button"); again.className = "btn glow"; again.textContent = "Try again";
    again.addEventListener("click", () => { studio.results = []; renderStudio(); });
    foot.append(again, note("Nothing was charged for results that failed.")); return;
  }
  const row = document.createElement("div"); row.className = "studio-row";
  if (done[0].video) {
    const sv = document.createElement("button"); sv.className = "btn glow"; sv.innerHTML = `${icon("save")}<span>Save the clip</span>`;
    sv.addEventListener("click", () => saveClip(done[0]));
    row.append(sv);
  } else {
    const sv = document.createElement("button"); sv.className = "btn glow"; sv.innerHTML = `${icon("save")}<span>${done.length > 1 ? "Save all" : "Save"}</span>`;
    sv.addEventListener("click", () => saveStudio(done));
    row.append(sv);
    if (done.length > 1) {
      const co = document.createElement("button"); co.className = "btn quiet"; co.textContent = "Save as collage";
      co.addEventListener("click", () => saveCollage(done));
      row.append(co);
    }
  }
  foot.append(row);
  if (k === "oldphoto" && done[0] && !done[0].video) {
    const more = document.createElement("div"); more.className = "studio-row";
    const col = document.createElement("button"); col.className = "btn quiet"; col.textContent = "Add color · 1 credit";
    col.addEventListener("click", () => colorizeOld(done[0]));
    const en = document.createElement("button"); en.className = "btn quiet"; en.textContent = "Enhance it";
    en.addEventListener("click", async () => { $("studio").close(); const p = await readPhoto(dataToBlob(done[0].data), "old-photo.jpg"); openEnhSheet(p.work, p.original, "old-photo", false); });
    more.append(col, en); foot.append(more);
  }
  const fresh = document.createElement("button"); fresh.className = "link-btn"; fresh.textContent = "Start over";
  fresh.addEventListener("click", () => { studio.results = []; renderStudio(); });
  foot.append(fresh);
}
function dataToBlob(d) {
  const [h, b] = d.split(","), bin = atob(b), u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return new Blob([u], { type: (/data:([^;]+)/.exec(h) || [])[1] || "image/jpeg" });
}
async function colorizeOld(r) {
  const it = { mode: "colorize", name: "In color", cost: 1 };
  studio.results.push({ ...it, status: "working" }); studio.running = true; renderStudio();
  const slot = studio.results[studio.results.length - 1];
  try { const out = await studioJob(it, { image: await uploadable(r.data, 2048) }); slot.data = await enhResultData(out.url); slot.status = "done"; }
  catch (err) { slot.status = "failed"; slot.error = err.message; }
  studio.running = false; refreshAccount(); renderStudioIfOpen();
}

// One result, big, with its actions.
function openStudioResult(i) {
  const r = studio.results[i]; if (!r || r.status !== "done") return;
  const v = $("studioView"), pic = $("studioViewPic");
  pic.innerHTML = r.video ? `<video src="${r.url}" autoplay loop playsinline controls></video>` : `<img src="${r.data}" alt="${esc(r.name)}">`;
  $("studioViewTitle").textContent = r.name;
  const acts = $("studioViewActs"); acts.innerHTML = "";
  const add = (label, run, cls = "btn quiet") => { const b = document.createElement("button"); b.className = cls; b.textContent = label; b.addEventListener("click", run); acts.append(b); };
  if (r.video) add("Save the clip", () => saveClip(r), "btn glow");
  else {
    add("Save", () => saveStudio([r]), "btn glow");
    add("Edit", async () => { v.close(); $("studio").close(); const p = await readPhoto(dataToBlob(r.data), r.name + ".jpg"); await openPhoto(p.work, p.original, { name: r.name }); });
  }
  // "Face changed? Try again free": once per result, within 15 minutes (the server checks too).
  if (r.requestId && !r.retried && !r.retryOf && Date.now() - r.startedAt < 15 * 60000 && r.mode !== "colorize") {
    add(r.drift > DRIFT_LIMIT ? "Face changed? Try again free" : "Try again free", async () => {
      v.close(); r.retried = true;
      const again = { ...r, status: "working", data: null, url: null, drift: 0, requestId: null, retryOf: r.requestId };
      studio.results.splice(i + 1, 0, again);
      retryStudio(again);
    });
  }
  v.showModal();
}
async function retryStudio(slot) {
  studio.running = true; renderStudioIfOpen();
  try {
    const refs = studio.kind === "groupfix" ? studio.refs.filter(Boolean) : await meRefs();
    const body = { image: await uploadable(studio.photo, slot.video ? 1280 : 1536, slot.video ? 1_000_000 : 2_400_000), refs: (slot.me || studio.kind === "groupfix") && refs.length ? refs : undefined,
      extra: studioItem(slot.mode)?.extra && studio.extra ? await uploadable(studio.extra, 1280, 1_100_000) : undefined,
      prompt: slot.video ? MOTIONS.find((m) => m[0] === studio.motion)[2] : undefined, retry_of: slot.retryOf };
    const out = await studioJob(slot, body);
    slot.requestId = out.requestId; slot.startedAt = Date.now();
    if (slot.video) slot.url = out.url; else slot.data = await enhResultData(out.url);
    slot.status = "done";
    if (slot.check && !slot.video) slot.drift = await faceDrift(studio.photo, slot.data).catch(() => 0);
  } catch (err) { slot.status = "failed"; slot.error = err.message; }
  studio.running = false; refreshAccount(); renderStudioIfOpen();
}

// ---------- Saving ----------
async function studioSaveItem(r, i) {
  const name = `glow-studio-${studio.kind}-${Date.now()}-${i + 1}`;
  const data = wantMark() ? (await addMark(r.data)).data : r.data;
  return { data, name, clean: r.data };
}
async function saveStudio(list) {
  try {
    const items = await Promise.all(list.map(studioSaveItem));
    const where = await Platform.savePhotos(items);
    track("save", { from: "studio", kind: studio.kind, count: items.length, marked: wantMark() });
    say(where === "photos" ? `Saved ${items.length === 1 ? "to Photos" : `${items.length} photos to Photos`}.` : where === "shared" ? "Ready to save or share." : "Saved.");
  } catch (err) { if (err && err.name !== "AbortError") say(err.message || "Couldn't save.", true); }
}
// A grid of the results with their names: the shareable "salon test-drive".
async function collageOf(list) {
  const imgs = await Promise.all(list.map((r) => loadImg(r.data)));
  const n = imgs.length, cols = n <= 4 ? 2 : 3, rows = Math.ceil(n / cols), cell = 720, gap = 12, lab = 64;
  const a = imgs[0].naturalHeight / imgs[0].naturalWidth, ch = Math.round(cell * Math.min(1.5, Math.max(0.75, a)));
  const W = cols * cell + (cols + 1) * gap, H = rows * (ch + lab) + (rows + 1) * gap;
  const c = newCanvas(W, H), x = c.getContext("2d");
  x.fillStyle = "#0d0d10"; x.fillRect(0, 0, W, H);
  await markFonts();
  imgs.forEach((im, i) => {
    const cx = gap + (i % cols) * (cell + gap), cy = gap + Math.floor(i / cols) * (ch + lab + gap);
    const s = Math.max(cell / im.naturalWidth, ch / im.naturalHeight), w = im.naturalWidth * s, h = im.naturalHeight * s;
    x.save(); x.beginPath(); x.roundRect ? x.roundRect(cx, cy, cell, ch, 18) : x.rect(cx, cy, cell, ch); x.clip();
    x.drawImage(im, cx + (cell - w) / 2, cy + (ch - h) / 2, w, h); x.restore();
    x.fillStyle = "#f7f3ea"; x.font = MARK_SANS(34); x.textAlign = "center"; x.textBaseline = "middle";
    x.fillText(list[i].name, cx + cell / 2, cy + ch + lab / 2);
  });
  return c.toDataURL("image/jpeg", 0.92);
}
async function saveCollage(list) {
  try {
    const clean = await collageOf(list), data = wantMark() ? (await addMark(clean)).data : clean;
    const where = await Platform.savePhotos([{ data, name: `glow-studio-${studio.kind}-grid-${Date.now()}`, clean }]);
    track("save", { from: "studio", kind: studio.kind, collage: true, marked: wantMark() });
    say(where === "photos" ? "Collage saved to Photos." : where === "shared" ? "Ready to save or share." : "Collage saved.");
  } catch (err) { if (err && err.name !== "AbortError") say(err.message || "Couldn't save.", true); }
}
async function saveClip(r) {
  try {
    const res = await fetch(r.url); if (!res.ok) throw new Error("The clip has expired. Make it again.");
    const where = await Platform.shareVideo(await res.blob(), `glow-studio-motion-${Date.now()}`);
    track("save", { from: "studio", kind: "motion" });
    if (where === "downloaded") say("Clip saved.");
  } catch (err) { if (err && err.name !== "AbortError") say(err.message || "Couldn't save the clip.", true); }
}

// ---------- Free grids on the phone: hair colors and makeup looks ----------
async function freeGrid(what) {
  if (!studio.photo) { say("Choose a photo first.", true); return; }
  const list = what === "hair" ? HAIR_COLORS.slice(0, 9).map(([name, color]) => ({ name, color })) : MAKEUP_GRID.map(([look, name]) => ({ name, look }));
  studio.running = true;
  studio.results = list.map((t) => ({ ...t, mode: "free:" + what, status: "working" }));
  renderStudio();
  for (const r of studio.results) {
    try {
      if (what === "hair") r.data = await hairColor(studio.photo, 0.7, r.color);
      else {
        const keep = faceSet.style.fglam; faceSet.style.fglam = r.look;
        try { r.data = await faceEdit(studio.photo, "fglam", 0.6); } finally { faceSet.style.fglam = keep; }
      }
      r.status = "done";
    } catch (err) { r.status = "failed"; r.error = err.message; }
    renderStudioIfOpen();
  }
  studio.running = false; renderStudioIfOpen();
  track("studio_free_grid", { what });
}

// ---------- Wiring ----------
setIcon($("studioClose"), "close"); setIcon($("studioViewClose"), "close");
$("studioClose").addEventListener("click", () => $("studio").close());
$("studioViewClose").addEventListener("click", () => $("studioView").close());
renderStudioStrip();

// First glow (idea 7): until someone has enhanced a photo, the Enhance home invites them to try
// their own first, free; the Pro offer (with the trial timeline) only appears after that reveal.
function firstGlow() {
  const first = !store.get("glowFirstGlow") && featureOn("money:firstglow");
  const b = $("enhPick"), lbl = first ? "Glow up your first photo · Free" : "Choose a photo";
  if (b.lastChild && b.lastChild.nodeType === 3 && b.lastChild.textContent !== lbl) b.lastChild.textContent = lbl;
}
firstGlow();
