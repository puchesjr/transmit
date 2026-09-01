import type { PageServerLoad } from './$types';
import { getPublicAnalyticsConfig, getPublicSiteUrl } from '$lib/server/site';

export const load: PageServerLoad = ({ locals }) => {
	return {
		signedIn: Boolean(locals.user),
		siteUrl: getPublicSiteUrl(),
		analytics: getPublicAnalyticsConfig()
	};
};
