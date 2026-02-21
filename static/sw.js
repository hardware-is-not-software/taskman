/**
 * Service Worker for Task Manager PWA
 * Provides offline support and caching
 */

const CACHE_NAME = 'taskmanager-v3';
const STATIC_ASSETS = [
    '/',
    '/index.html',
    '/offline.html',
    '/style.css',
    '/app.js',
    '/manifest.json',
    '/icons/icon-192.png',
    '/icons/icon-512.png',
    '/icons/apple-touch-icon.png'
];
const NETWORK_FIRST_ASSETS = new Set([
    '/index.html',
    '/app.js',
    '/style.css',
    '/manifest.json'
]);

// Install - cache static assets
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(STATIC_ASSETS))
            .then(() => self.skipWaiting())
    );
});

// Activate - clean up old caches
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys()
            .then(keys => Promise.all(
                keys.filter(key => key !== CACHE_NAME)
                    .map(key => caches.delete(key))
            ))
            .then(() => self.clients.claim())
    );
});

// Fetch - network first, fall back to cache for static assets
self.addEventListener('fetch', event => {
    const url = new URL(event.request.url);

    // Ignore non-GET requests.
    if (event.request.method !== 'GET') {
        return;
    }

    // API calls - network only, with a deterministic offline response.
    if (url.pathname.startsWith('/api/')) {
        event.respondWith(
            fetch(event.request).catch(() => new Response(
                JSON.stringify({ error: 'Offline' }),
                {
                    status: 503,
                    headers: { 'Content-Type': 'application/json' }
                }
            ))
        );
        return;
    }

    // Navigations - network first, then cached shell, then offline page.
    if (event.request.mode === 'navigate') {
        event.respondWith(
            fetch(event.request)
                .then(response => {
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then(cache => cache.put('/index.html', clone));
                    return response;
                })
                .catch(async () => {
                    const cachedIndex = await caches.match('/index.html');
                    return cachedIndex || caches.match('/offline.html');
                })
        );
        return;
    }

    // Core shell assets - network first to avoid stale UI/logic after deploys.
    if (NETWORK_FIRST_ASSETS.has(url.pathname)) {
        event.respondWith(
            fetch(event.request)
                .then(response => {
                    if (response.ok && url.origin === self.location.origin) {
                        const clone = response.clone();
                        caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
                    }
                    return response;
                })
                .catch(() => caches.match(event.request))
        );
        return;
    }

    // Other static assets - cache first, then network with cache fill.
    event.respondWith(
        caches.match(event.request)
            .then(cached => {
                if (cached) {
                    return cached;
                }
                return fetch(event.request).then(response => {
                    if (response.ok && url.origin === self.location.origin) {
                        const clone = response.clone();
                        caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
                    }
                    return response;
                });
            })
            .catch(() => caches.match('/offline.html'))
    );
});
