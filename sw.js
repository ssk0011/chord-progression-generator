/* Install and offline only: keeps the app and its help pages on the device. It never sends anything anywhere.
   VERSION is stamped by docs-src/build.py from the files below, so any change to them makes browsers fetch a fresh copy. */
const VERSION='15912c8e8d3b';
const CACHE='changes-'+VERSION;
const FILES=['./','index.html','guide.html','how-it-works.html','manifest.webmanifest','icons/icon-192.png','icons/icon-512.png','icons/icon-maskable-512.png'];
self.addEventListener('install',e=>{ e.waitUntil(caches.open(CACHE).then(c=>c.addAll(FILES)).then(()=>self.skipWaiting())); });
self.addEventListener('activate',e=>{ e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k.startsWith('changes-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())); });
self.addEventListener('fetch',e=>{ const q=e.request; if(q.method!=='GET'||new URL(q.url).origin!==location.origin) return;
  e.respondWith(caches.open(CACHE).then(c=>c.match(q.mode==='navigate'&&new URL(q.url).pathname.endsWith('/')?'./':q,{ignoreSearch:true})).then(r=>r||fetch(q))); });
