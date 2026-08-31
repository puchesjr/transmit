import { redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = ({ locals }) => {
	if (!locals.user || !locals.account || !locals.location) {
		redirect(303, '/signin');
	}
	return {
		user: locals.user,
		account: locals.account,
		location: locals.location
	};
};
