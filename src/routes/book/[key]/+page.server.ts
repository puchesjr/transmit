import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getSql } from '$lib/server/db';
import { getPublicBookingProfile } from '$lib/server/domain/booking';

export const load: PageServerLoad = async ({ params, url }) => {
	const profile = await getPublicBookingProfile(getSql(), params.key);
	if (!profile) error(404, 'This booking concierge is not available.');
	if (!profile.available) {
		redirect(307, `/capture/${encodeURIComponent(params.key)}${url.search}`);
	}
	return { profile };
};
