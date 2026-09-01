import { getPublicSiteUrl } from '$lib/server/site';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => ({
	signedIn: Boolean(locals.user),
	siteUrl: getPublicSiteUrl()
});
