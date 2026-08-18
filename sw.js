// Minimal service worker: network-first (so updated data/*.js is always preferred
// when online), falling back to cache when offline. Required for Android PWA install.
var CACHE_NAME = "lotto-site-v2";
var PRECACHE = [
  "./",
  "./index.html",
  "./css/style.css",
  "./js/app.js",
  "./js/vendor/jsQR.js",
  "./data/draws.js",
  "./data/kr-map.js",
  "./data/regions.js",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png"
];

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) { return cache.addAll(PRECACHE); })
  );
  self.skipWaiting();
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.filter(function (k) { return k !== CACHE_NAME; }).map(function (k) { return caches.delete(k); })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener("fetch", function (event) {
  if (event.request.method !== "GET") return;
  event.respondWith(
    fetch(event.request)
      .then(function (res) {
        var copy = res.clone();
        caches.open(CACHE_NAME).then(function (cache) { cache.put(event.request, copy); });
        return res;
      })
      .catch(function () { return caches.match(event.request); })
  );
});
