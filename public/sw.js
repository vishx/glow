// Caches the app shell so Glow opens instantly from the home screen.
const CACHE = "glow-v15";
// The introduction's small photos are part of the shell. The full sample photo and its prepared
// previews are cached as they are first fetched (below), so they work offline only after
// someone has opened them once.
const SHELL = ["/", "/styles.css", "/icons.js", "/platform.js", "/engine.js", "/app.js", "/enhance.js", "/enhance.css", "/splash/halo.webp", "/splash/core.webp", "/splash/sparkle.webp", "/manifest.json", "/icon-192.png", "/icon-512.png",
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
  if (e.request.method !== "GET" || url.origin !== location.origin || url.pathname.startsWith("/api/")) return;
  // Network first, so updates show up; fall back to cache when offline.
  e.respondWith(
    fetch(e.request)
      .then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); return res; })
      .catch(() => caches.match(e.request))
  );
});
