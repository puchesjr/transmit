const LIVE_PATHS = new Set(['/health', '/ready']);
const LIVE_PREFIXES = ['/api/', '/embed/'] as const;

/** Network-only: tenant data, webhooks, health, and third-party embed scripts. */
export function shouldBypassServiceWorker(input: {
	method: string;
	origin: string;
	pageOrigin: string;
	pathname: string;
}): boolean {
	if (input.method !== 'GET') return true;
	if (input.origin !== input.pageOrigin) return true;
	if (LIVE_PATHS.has(input.pathname)) return true;
	return LIVE_PREFIXES.some((prefix) => input.pathname.startsWith(prefix));
}

/** Precache hashed app assets and install icons — not marketing images. */
export function shouldPrecacheStaticAsset(pathname: string): boolean {
	const path = pathname.split('?')[0] ?? pathname;
	if (path.endsWith('.gitkeep')) return false;
	if (path.startsWith('/images/')) return false;
	if (path === '/og.png' || path === '/og.svg') return false;
	if (path.startsWith('/embed/')) return false;
	return true;
}

export function shouldCacheNavigationResponse(status: number): boolean {
	return status === 200;
}
