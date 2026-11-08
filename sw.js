const VERSION = '2026-11-08-5';
const SHELL_CACHE = `goodnight-shell-${VERSION}`;
const RUNTIME_CACHE = `goodnight-runtime-${VERSION}`;
const SHELL = [
    './',
    './index.html',
    './manifest.webmanifest',
    './asserts/css/main.css',
    './asserts/js/app.js',
    './asserts/js/library.js',
    './asserts/js/storage.js',
    './asserts/js/player.js',
    './asserts/js/timer.js',
    './asserts/js/ui.js',
    './asserts/js/pdf-reader.js',
    './asserts/js/pdf-compat.js',
    './asserts/js/pdf-worker.js',
    './asserts/images/icon.svg',
    './asserts/images/icon-192.png',
    './asserts/images/icon-512.png',
    './asserts/images/icon-maskable-512.png',
    './asserts/images/apple-touch-icon.png',
    './asserts/images/narrator-female.webp',
    './asserts/images/narrator-male.webp',
    './books/catalog.json',
    './books/01-MaoYu/book.json',
    './books/02-WuXuBiJi/book.json',
    './books/03-GuanChaDeYiShu/book.json',
    './books/01-MaoYu/images/游泳.webp',
    './books/01-MaoYu/images/cover.webp'
];

function cacheable(response) {
    return response.ok && response.type === 'basic';
}

self.addEventListener('install', event => {
    event.waitUntil((async () => {
        const cache = await caches.open(SHELL_CACHE);
        await cache.addAll(SHELL);
        await self.skipWaiting();
    })());
});

self.addEventListener('activate', event => {
    event.waitUntil((async () => {
        const keep = new Set([SHELL_CACHE, RUNTIME_CACHE]);
        const names = await caches.keys();
        await Promise.all(names.map(name => keep.has(name) ? null : caches.delete(name)));
        await self.clients.claim();
    })());
});

async function networkFirst(request, cacheName, fallback) {
    const cache = await caches.open(cacheName);
    try {
        const response = await fetch(request);
        if (cacheable(response)) await cache.put(request, response.clone()).catch(() => {});
        return response;
    } catch (error) {
        const cached = await cache.match(request);
        if (cached) return cached;
        const shell = await caches.open(SHELL_CACHE);
        const shellCached = await shell.match(fallback || request);
        if (shellCached) return shellCached;
        throw error;
    }
}

function staleWhileRevalidate(request, cacheName, event) {
    const cachePromise = caches.open(cacheName);
    const network = cachePromise.then(async cache => {
        const response = await fetch(request);
        if (cacheable(response)) await cache.put(request, response.clone()).catch(() => {});
        return response;
    });
    event.waitUntil(network.catch(() => {}));
    return cachePromise.then(cache => cache.match(request)).then(cached => cached || network);
}

self.addEventListener('fetch', event => {
    const request = event.request;
    if (request.method !== 'GET') return;
    const url = new URL(request.url);
    if (url.origin !== self.location.origin) return;
    if (request.headers.has('range')) return;
    if (/\.(opus|pdf)$/i.test(url.pathname)) return;

    if (request.mode === 'navigate') {
        event.respondWith(networkFirst(request, SHELL_CACHE, './index.html'));
    } else if (url.pathname.endsWith('.json')) {
        event.respondWith(networkFirst(request, RUNTIME_CACHE));
    } else if (url.pathname.includes('/asserts/') || url.pathname.endsWith('/manifest.webmanifest') || request.destination === 'image') {
        event.respondWith(staleWhileRevalidate(request, RUNTIME_CACHE, event));
    }
});
