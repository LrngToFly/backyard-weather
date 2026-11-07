/* Backyard Weather service worker: keeps a copy of the app's own files so it opens instantly and without signal.
   Each time the app opens it shows the saved copy at once, then checks GitHub for newer files in the background.
   If any file changed, the new copy is saved and the page is told, which shows a "new version" bar.
   Weather data (Open-Meteo, Weather Underground, NWS, AirNow) is never cached here. */
'use strict';

var CACHE = 'backyard-shell';
var SHELL = [
  './', 'style.css', 'geo.js', 'manifest.webmanifest', 'icon-180.png', 'icon-192.png',
  'js/core.js', 'js/colors.js', 'js/demo.js', 'js/mapdata.js', 'js/mapdraw.js', 'js/point.js',
  'js/station.js', 'js/extras.js', 'js/daylight.js', 'js/app.js'
];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL.map(function (u) { return new Request(u, { cache: 'reload' }); })); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) { e.waitUntil(self.clients.claim()); });

// the page address is saved under './' whatever its ?query, and the app's files without their ?query
function keyFor(req) {
  var u = new URL(req.url); u.search = ''; u.hash = '';
  if (req.mode === 'navigate' || /\/index\.html$/.test(u.pathname)) u.pathname = u.pathname.replace(/index\.html$/, '');
  return u.href;
}
async function differs(a, b) {
  if (!a || !b) return true;
  var ea = a.headers.get('etag'), eb = b.headers.get('etag');
  if (ea && eb) return ea !== eb;
  return (await a.clone().text()) !== (await b.clone().text());
}
async function tellPages() {
  var list = await self.clients.matchAll({ type: 'window' });
  list.forEach(function (c) { c.postMessage({ type: 'updated' }); });
}
self.addEventListener('fetch', function (e) {
  var req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return; // weather data goes straight to the network
  var key = keyFor(req);
  e.respondWith((async function () {
    var cache = await caches.open(CACHE), saved = await cache.match(key);
    var compare = saved ? saved.clone() : null; // the page reads `saved`; a response can only be read once
    var fresh = fetch(req.url.split('?')[0].replace(/#.*$/, ''), { cache: 'no-cache' }).then(async function (res) {
      if (!res.ok) return res;
      if (compare && await differs(compare, res)) { await cache.put(key, res.clone()); tellPages(); }
      else if (!saved) await cache.put(key, res.clone());
      return res;
    }).catch(function () { return null; });
    if (saved) { e.waitUntil(fresh); return saved; }
    return (await fresh) || new Response('Offline and not saved yet', { status: 503, statusText: 'Offline' });
  })());
});
