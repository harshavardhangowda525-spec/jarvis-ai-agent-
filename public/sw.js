/*
 * JARVIS app service worker. Deliberately small: it makes the app installable
 * and shows a clear "you're offline" screen instead of a browser error. It
 * never caches your pages or API answers (they're personal and must be live).
 */
const CACHE = "jarvis-shell-v1";
const SHELL = ["/offline.html", "/app/icon-192.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  // only page loads; everything else goes straight to the network
  if (req.mode !== "navigate") return;
  e.respondWith(fetch(req).catch(() => caches.match("/offline.html")));
});
