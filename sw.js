/* Desk service worker: app shell offline; desk data (d/…) is never cached. Web Push display. */
var CACHE = 'desk-shell-v5';
var SHELL = ['./', 'index.html', 'app.css?v=5', 'app.js?v=5', 'chart.js?v=5', 'manifest.json', 'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png'];
self.addEventListener('install', function (e) { e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); })); });
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (ks) { return Promise.all(ks.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); })); })
    .then(function () { return self.clients.claim(); }));
});
self.addEventListener('fetch', function (e) {
  var u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  if (u.pathname.indexOf('/d/') > -1) return;              // live data: straight to network
  e.respondWith(fetch(e.request).then(function (r) {
    if (r.ok) { var copy = r.clone(); caches.open(CACHE).then(function (c) { c.put(e.request, copy); }); }
    return r;
  }).catch(function () { return caches.match(e.request).then(function (m) { return m || caches.match('index.html'); }); }));
});
self.addEventListener('push', function (e) {
  var d = {}; try { d = e.data ? e.data.json() : {}; } catch (x) { d = { title: 'Desk', body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Desk', { body: d.body || '', icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', data: { url: d.url || './' } }));
});
self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  var url = (e.notification.data && e.notification.data.url) || './';
  e.waitUntil(self.clients.openWindow(url));
});
