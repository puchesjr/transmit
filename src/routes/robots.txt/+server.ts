import { getPublicSiteUrl } from '$lib/server/site';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = () => {
	const body = [
		'User-agent: *',
		'Allow: /',
		'Disallow: /api/',
		'Disallow: /inbox',
		'Disallow: /contacts',
		'Disallow: /companies',
		'Disallow: /opportunities',
		'Disallow: /settings',
		`Sitemap: ${getPublicSiteUrl()}/sitemap.xml`,
		''
	].join('\n');

	return new Response(body, { headers: { 'content-type': 'text/plain; charset=utf-8' } });
};
