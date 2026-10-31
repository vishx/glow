// Caches the app shell so Glow opens instantly from the home screen.
const CACHE = "glow-v26";
// The introduction's small photos are part of the shell. The full sample photo and its prepared
// previews are cached as they are first fetched (below), so they work offline only after
// someone has opened them once.
const SHELL = ["/", "/styles.css", "/icons.js", "/platform.js", "/engine.js", "/livebeauty.js", "/faceworker.js", "/app.js", "/enhance.js", "/enhance.css", "/splash/halo.webp", "/splash/core.webp", "/splash/sparkle.webp", "/manifest.json", "/icon-192.png", "/icon-512.png",
  "/samples/demo-v2/intro.jpg", "/samples/demo-v2/thumb.jpg"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  // The admin page is never cached on a device: it shows private numbers and must always be current.
  if (e.request.method !== "GET" || url.origin !== location.origin || url.pathname.startsWith("/api/") || url.pathname.startsWith("/admin")) return;
  // Network first, so updates show up; fall back to cache when offline. Only complete, good answers
  // are kept, so an error page or a partial (range) answer never replaces a working copy.
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok && res.status === 200 && res.type === "basic") { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {}); }
        return res;
      })
      .catch(() => caches.match(e.request).then((r) => r || (e.request.mode === "navigate" ? caches.match("/") : undefined)))
  );
});
