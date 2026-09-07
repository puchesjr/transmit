import type { PageServerLoad } from './$types';
import { workspacePath } from '$lib/server/domain/onboarding';
import { getPublicAnalyticsConfig, getPublicSiteUrl } from '$lib/server/site';

export const load: PageServerLoad = ({ locals }) => {
	return {
		signedIn: Boolean(locals.user),
		workspaceHref: locals.account ? workspacePath(locals.account.onboardingStatus) : '/inbox',
		siteUrl: getPublicSiteUrl(),
		analytics: getPublicAnalyticsConfig()
	};
};
