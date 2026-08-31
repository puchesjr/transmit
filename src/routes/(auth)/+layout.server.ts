import { redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = ({ locals }) => {
	if (locals.user && locals.account) {
		redirect(303, '/inbox');
	}
	return {};
};
