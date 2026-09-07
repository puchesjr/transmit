import { redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = ({ locals }) => {
	if (!locals.user || !locals.account || !locals.location) {
		redirect(303, '/signin');
	}
	// Only the owner can finish setup; a member must not be trapped on /onboarding.
	if (locals.account.onboardingStatus === 'pending' && locals.membership?.role === 'owner') {
		redirect(303, '/onboarding');
	}
	return {
		user: locals.user,
		account: locals.account,
		location: locals.location
	};
};
