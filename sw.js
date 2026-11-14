const CACHE = "glyanets-v2";
const ASSETS = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./sw.js",
  "./css/style.css",
  "./js/data.js",
  "./js/save.js",
  "./js/battle.js",
  "./js/app.js",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/apple-touch-icon.png",
  "./img/app_icon.png",
  "./img/map_bg.jpg",
  "./img/lineup.jpg",
  "./img/hero_mannequin.png",
  "./img/unit_rubin.png",
  "./img/unit_iney.png",
  "./img/unit_iskra.png",
  "./img/unit_valkyrie.png",
  "./img/unit_prisma.png",
  "./img/unit_nocturne.png",
  "./img/enemy_mob.png",
  "./img/enemy_fast.png",
  "./img/enemy_mini.png",
  "./img/enemy_boss.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((res) => {
        return res;
      }).catch(() => caches.match("./index.html"));
    })
  );
});
