import { redirect } from '@sveltejs/kit';
import { workspacePath } from '$lib/server/domain/onboarding';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = ({ locals }) => {
	if (locals.user && locals.account) {
		redirect(303, workspacePath(locals.account.onboardingStatus));
	}
	return {};
};
