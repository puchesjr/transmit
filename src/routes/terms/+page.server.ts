import { workspacePath } from '$lib/server/domain/onboarding';
import { getPublicSiteUrl } from '$lib/server/site';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => ({
	signedIn: Boolean(locals.user),
	workspaceHref: locals.account ? workspacePath(locals.account.onboardingStatus) : '/inbox',
	siteUrl: getPublicSiteUrl()
});
