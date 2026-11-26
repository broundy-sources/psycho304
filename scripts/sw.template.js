// Service worker Psycho 304 — généré au build. Met l'application en cache pour un usage hors ligne.
// Les données (contenus, progression) sont dans IndexedDB et ne sont jamais touchées par ce fichier.
const VERSION = "__BUILD__";
const CACHE = `psycho304-${VERSION}`;
const ASSETS = __ASSETS__;

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("psycho304-") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET" || new URL(req.url).origin !== location.origin) return;
  if (req.mode === "navigate") {
    // Réseau d'abord pour récupérer les mises à jour, cache si hors ligne.
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put("./index.html", copy));
          return res;
        })
        .catch(() => caches.match("./index.html").then((r) => r || caches.match("./"))),
    );
    return;
  }
  event.respondWith(caches.match(req, { ignoreSearch: false }).then((hit) => hit || fetch(req)));
});
