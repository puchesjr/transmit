import type { RequestHandler } from './$types';
import { getSql } from '$lib/server/db';
import { getPublicBookingProfile } from '$lib/server/domain/booking';
import { api, jsonOk } from '$lib/server/http';

export const GET: RequestHandler = api(async ({ params }) => {
	const profile = await getPublicBookingProfile(getSql(), params.key ?? '');
	return jsonOk({ profile }, profile ? 200 : 404);
});
