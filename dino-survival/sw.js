/* 侏罗纪求生 · Service Worker
   策略：同源 GET「网络优先 + 缓存回退」——上线即更新，断网仍可玩。
   每次发布只需改 VERSION，旧缓存会在 activate 时清掉。 */
var VERSION = "1.3";
var CACHE = "dino-survival-" + VERSION;
var FILES = [
  "./", "./index.html", "./styles.css", "./icon.svg", "./manifest.webmanifest",
  "./src/util.js", "./src/audio.js", "./src/species.js", "./src/magic.js", "./src/world.js",
  "./src/creature.js", "./src/render.js", "./src/input.js", "./src/game.js", "./src/main.js"
];

self.addEventListener("install", function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) { return c.addAll(FILES); }).catch(function () {})
  );
  self.skipWaiting();
});

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        return k === CACHE ? null : caches.delete(k);
      }));
    }).then(function () {
      return self.clients.claim();
    })
  );
});

self.addEventListener("message", function (e) {
  if (e.data === "skip-waiting") self.skipWaiting();
});

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;
  var url;
  try { url = new URL(req.url); } catch (err) { return; }
  if (url.origin !== self.location.origin) return;
  e.respondWith(
    fetch(req).then(function (res) {
      if (res && res.ok && res.type === "basic") {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(req, copy); }).catch(function () {});
      }
      return res;
    }).catch(function () {
      return caches.match(req, { ignoreSearch: true }).then(function (hit) {
        return hit || caches.match("./index.html", { ignoreSearch: true });
      });
    })
  );
});
