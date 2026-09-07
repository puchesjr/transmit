/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />

import { build, files, version } from '$service-worker';
import {
	shouldBypassServiceWorker,
	shouldCacheNavigationResponse,
	shouldPrecacheStaticAsset
} from '$lib/pwa-cache-policy';

const CACHE = `kiso-cache-${version}`;
const ASSETS = [...build, ...files.filter(shouldPrecacheStaticAsset)];

declare const self: ServiceWorkerGlobalScope;

self.addEventListener('install', (event: ExtendableEvent) => {
	event.waitUntil(
		caches
			.open(CACHE)
			.then((cache) => cache.addAll(ASSETS))
			.then(() => self.skipWaiting())
	);
});

self.addEventListener('activate', (event: ExtendableEvent) => {
	event.waitUntil(
		caches
			.keys()
			.then((keys) =>
				Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))
			)
			.then(() => self.clients.claim())
	);
});

self.addEventListener('fetch', (event: FetchEvent) => {
	const url = new URL(event.request.url);
	if (
		shouldBypassServiceWorker({
			method: event.request.method,
			origin: url.origin,
			pageOrigin: self.location.origin,
			pathname: url.pathname
		})
	) {
		return;
	}

	if (ASSETS.includes(url.pathname)) {
		event.respondWith(cacheFirst(event.request));
		return;
	}

	if (event.request.mode === 'navigate') {
		event.respondWith(networkFirstNavigation(event.request));
	}
});

async function cacheFirst(request: Request): Promise<Response> {
	const cache = await caches.open(CACHE);
	const cached = await cache.match(request);
	if (cached) return cached;
	const network = await fetch(request);
	if (network.ok) cache.put(request, network.clone());
	return network;
}

async function networkFirstNavigation(request: Request): Promise<Response> {
	const cache = await caches.open(CACHE);
	try {
		const network = await fetch(request);
		if (shouldCacheNavigationResponse(network.status)) {
			cache.put(request, network.clone());
		}
		return network;
	} catch {
		const cached = await cache.match(request, { ignoreSearch: true });
		if (cached) return cached;
		const inbox = await cache.match('/inbox');
		return inbox ?? Response.error();
	}
}
