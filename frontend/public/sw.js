// Lightweight offline Service Worker for Pichci (no build plugin required).
// - Content-hashed /assets/* and PWA icons: cache-first (immutable).
// - HTML navigations: network-first with cached shell fallback so the PWA boots offline.
// - Read-only grocery/cookbook API GETs: network-first with offline cache fallback.
// - Mutations (POST/PUT/PATCH/DELETE), SSE (/api/chat), and OAuth (/api/auth/login): never intercepted.

const SHELL_CACHE = 'pichci-shell-v1'
const API_CACHE = 'pichci-api-v1'
const KEEP_CACHES = new Set([SHELL_CACHE, API_CACHE])

const CACHEABLE_API_PATHS = [
  /^\/api\/auth\/me$/,
  /^\/api\/shopping$/,
  /^\/api\/supplies$/,
  /^\/api\/recipes$/,
  /^\/api\/recipes\/[0-9a-f-]{36}$/i,
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) =>
      cache.addAll(['/', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png']).catch(() => undefined),
    ),
  )
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => !KEEP_CACHES.has(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'CLEAR_API_CACHE') {
    event.waitUntil(caches.delete(API_CACHE))
  }
})

function isCacheableApi(pathname) {
  return CACHEABLE_API_PATHS.some((re) => re.test(pathname))
}

async function networkFirst(request, cacheName, fallbackUrl) {
  const cache = await caches.open(cacheName)
  try {
    const response = await fetch(request)
    if (response && response.ok && response.type === 'basic') {
      cache.put(request, response.clone()).catch(() => undefined)
    }
    return response
  } catch (err) {
    const cached = (await cache.match(request)) || (fallbackUrl ? await cache.match(fallbackUrl) : undefined)
    if (cached) return cached
    throw err
  }
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName)
  const cached = await cache.match(request)
  if (cached) return cached
  const response = await fetch(request)
  if (response && response.ok && response.type === 'basic') {
    cache.put(request, response.clone()).catch(() => undefined)
  }
  return response
}

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  if (url.pathname.startsWith('/api/')) {
    if (isCacheableApi(url.pathname)) {
      event.respondWith(networkFirst(request, API_CACHE, null))
    }
    return
  }

  if (url.pathname.startsWith('/assets/') || /\.(?:png|svg|ico|webp|webmanifest)$/i.test(url.pathname)) {
    event.respondWith(cacheFirst(request, SHELL_CACHE))
    return
  }

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, SHELL_CACHE, '/'))
  }
})
