// Минимальный service worker: кэш оболочки, network-first для навигации.
// API Supabase НИКОГДА не кэшируем — данные всегда свежие.
const CACHE = 'bezvody-v1'
const SHELL = ['/', '/index.html']

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()))
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (e) => {
  const { request } = e
  const url = new URL(request.url)

  // не трогаем не-GET и запросы к Supabase (auth, БД, storage)
  if (request.method !== 'GET' || url.hostname.endsWith('supabase.co')) return

  // навигация: сеть, при офлайне — оболочка из кэша
  if (request.mode === 'navigate') {
    e.respondWith(fetch(request).catch(() => caches.match('/index.html')))
    return
  }

  // статика: сначала кэш, потом сеть (и докладываем в кэш)
  e.respondWith(
    caches.match(request).then(
      (cached) =>
        cached ||
        fetch(request).then((res) => {
          const copy = res.clone()
          caches.open(CACHE).then((c) => c.put(request, copy))
          return res
        }),
    ),
  )
})
