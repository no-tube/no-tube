// no-tube service worker — sadece uygulama kabuğu, API'ler ve stream'ler asla önbelleklenmez
const C = 'no-tube-shell';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(clients.claim()));
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const u = new URL(e.request.url);
  if (u.origin !== location.origin) return;
  const isDynamic = u.pathname.startsWith('/api/');
  if (isDynamic) return;
  e.respondWith(
    fetch(e.request).then(r => {
      const cop = r.clone();
      caches.open(C).then(c => c.put(e.request, cop));
      return r;
    }).catch(() => caches.match(e.request))
  );
});
