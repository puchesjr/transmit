import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
	shouldBypassServiceWorker,
	shouldCacheNavigationResponse,
	shouldPrecacheStaticAsset
} from '$lib/pwa-cache-policy';

const origin = 'https://kisocrm.com';

describe('PWA cache policy', () => {
	it('bypasses non-GET, cross-origin, API, health, and embed requests', () => {
		expect(
			shouldBypassServiceWorker({
				method: 'POST',
				origin,
				pageOrigin: origin,
				pathname: '/inbox'
			})
		).toBe(true);
		expect(
			shouldBypassServiceWorker({
				method: 'GET',
				origin: 'https://evil.example',
				pageOrigin: origin,
				pathname: '/inbox'
			})
		).toBe(true);
		expect(
			shouldBypassServiceWorker({
				method: 'GET',
				origin,
				pageOrigin: origin,
				pathname: '/api/v1/conversations'
			})
		).toBe(true);
		expect(
			shouldBypassServiceWorker({
				method: 'GET',
				origin,
				pageOrigin: origin,
				pathname: '/health'
			})
		).toBe(true);
		expect(
			shouldBypassServiceWorker({
				method: 'GET',
				origin,
				pageOrigin: origin,
				pathname: '/ready'
			})
		).toBe(true);
		expect(
			shouldBypassServiceWorker({
				method: 'GET',
				origin,
				pageOrigin: origin,
				pathname: '/embed/kiso.js'
			})
		).toBe(true);
		expect(
			shouldBypassServiceWorker({
				method: 'GET',
				origin,
				pageOrigin: origin,
				pathname: '/inbox'
			})
		).toBe(false);
		expect(
			shouldBypassServiceWorker({
				method: 'GET',
				origin,
				pageOrigin: origin,
				pathname: '/icon-192.png'
			})
		).toBe(false);
	});

	it('precache skips marketing images, gitkeep, and embed scripts', () => {
		expect(shouldPrecacheStaticAsset('/icon-192.png')).toBe(true);
		expect(shouldPrecacheStaticAsset('/manifest.webmanifest')).toBe(true);
		expect(shouldPrecacheStaticAsset('/_app/immutable/entry/app.js')).toBe(true);
		expect(shouldPrecacheStaticAsset('/images/.gitkeep')).toBe(false);
		expect(shouldPrecacheStaticAsset('/images/product-inbox.jpg')).toBe(false);
		expect(shouldPrecacheStaticAsset('/og.png')).toBe(false);
		expect(shouldPrecacheStaticAsset('/og.svg')).toBe(false);
		expect(shouldPrecacheStaticAsset('/embed/kiso.js')).toBe(false);
	});

	it('caches only successful navigation HTML', () => {
		expect(shouldCacheNavigationResponse(200)).toBe(true);
		expect(shouldCacheNavigationResponse(302)).toBe(false);
		expect(shouldCacheNavigationResponse(404)).toBe(false);
		expect(shouldCacheNavigationResponse(500)).toBe(false);
	});
});

describe('PWA configuration and assets', () => {
	const rootDir = process.cwd();

	it('provides a valid manifest.webmanifest for field installation', () => {
		const manifestPath = resolve(rootDir, 'static/manifest.webmanifest');
		expect(existsSync(manifestPath)).toBe(true);

		const raw = readFileSync(manifestPath, 'utf8');
		const manifest = JSON.parse(raw) as {
			name: string;
			short_name: string;
			start_url: string;
			scope: string;
			display: string;
			background_color: string;
			theme_color: string;
			icons: Array<{ src: string; sizes: string; purpose?: string }>;
		};

		expect(manifest.name).toBe('Kiso CRM');
		expect(manifest.short_name).toBe('Kiso');
		expect(manifest.start_url).toBe('/inbox');
		expect(manifest.scope).toBe('/');
		expect(manifest.display).toBe('standalone');
		expect(manifest.background_color).toBe('#0f172a');
		expect(manifest.theme_color).toBe('#b23a1f');

		expect(Array.isArray(manifest.icons)).toBe(true);
		expect(manifest.icons.length).toBeGreaterThanOrEqual(2);

		const sizes = manifest.icons.map((icon) => icon.sizes);
		expect(sizes).toContain('192x192');
		expect(sizes).toContain('512x512');
		expect(manifest.icons.some((icon) => icon.purpose === 'maskable')).toBe(true);

		for (const icon of manifest.icons) {
			const iconFilePath = resolve(rootDir, 'static', icon.src.replace(/^\//, ''));
			expect(existsSync(iconFilePath), `Referenced icon does not exist: ${icon.src}`).toBe(true);
		}
	});

	it('includes mobile and PWA metadata in app.html', () => {
		const appHtmlPath = resolve(rootDir, 'src/app.html');
		const html = readFileSync(appHtmlPath, 'utf8');

		expect(html).toContain('rel="manifest" href="/manifest.webmanifest"');
		expect(html).toContain('name="apple-mobile-web-app-capable" content="yes"');
		expect(html).toContain('name="mobile-web-app-capable" content="yes"');
		expect(html).toContain('name="apple-mobile-web-app-status-bar-style"');
		expect(html).toContain('rel="apple-touch-icon" href="/icon-192.png"');
		expect(html).toContain('name="theme-color"');
	});

	it('wires the service worker to the shared cache policy and lets Kit register it', () => {
		const swPath = resolve(rootDir, 'src/service-worker.ts');
		expect(existsSync(swPath)).toBe(true);
		const swCode = readFileSync(swPath, 'utf8');
		expect(swCode).toContain("from '$lib/pwa-cache-policy'");
		expect(swCode).toContain('shouldBypassServiceWorker');
		expect(swCode).toContain('files.filter(shouldPrecacheStaticAsset)');
		expect(swCode).toContain('networkFirstNavigation');
		expect(swCode).toContain('cache.put(request, network.clone())');

		const layoutCode = readFileSync(resolve(rootDir, 'src/routes/+layout.svelte'), 'utf8');
		expect(layoutCode).not.toContain('serviceWorker.register');
		expect(layoutCode).not.toContain('/service-worker.js');
	});
});
