import { getPublicSiteUrl } from '$lib/server/site';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = () => {
	const siteUrl = getPublicSiteUrl();
	const pages = ['', '/privacy', '/terms', '/signup'];
	const urls = pages.map((path) => `<url><loc>${siteUrl}${path || '/'}</loc></url>`).join('');

	return new Response(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`, {
		headers: { 'content-type': 'application/xml; charset=utf-8' }
	});
};
