/* Service worker: app-shell cache + network-first data. */
const VERSION = "fb-live-v32";
const SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./supabase-client.js",
  "./data-mapping.js",
  "./js/meta.js",
  "./js/state.js",
  "./js/standings.js",
  "./js/pwa.js",
  "./js/live-select.js",
  "./js/match-detail.js",
  "./js/views/standings-view.js",
  "./js/views/bracket-view.js",
  "./js/views/matches-view.js",
  "./js/views/cards-view.js",
  "./js/views/live-view.js",
  "./vendor/supabase-js-2.110.0.mjs",
  "./manifest.webmanifest",
  "./assets/ifa-mark.png",
  "./icons/favicon-64.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

self.addEventListener("install", (e) => {
  // Do NOT auto-skip — wait until the user taps "Update" (see message handler).
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)));
});

// The page asks the waiting worker to take over when the user taps Update.
self.addEventListener("message", (e) => {
  if (e.data && e.data.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);

  // App shell: cache-first, fall back to network.
  e.respondWith(
    caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => {
      if (e.request.method === "GET" && res.ok && url.origin === location.origin) {
        const copy = res.clone();
        caches.open(VERSION).then((c) => c.put(e.request, copy));
      }
      return res;
    }).catch(() => (e.request.mode === "navigate" ? caches.match("./index.html") : Response.error())))
  );
});
