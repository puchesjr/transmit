import { requireAuth } from '$lib/server/context';
import { getSql } from '$lib/server/db';
import { takeOverBookingSession } from '$lib/server/domain/booking';
import { api, jsonOk } from '$lib/server/http';
import { parseId } from '$lib/server/validation';

export const POST = api(async ({ locals, params }) => {
	const ctx = requireAuth(locals);
	return jsonOk({
		session: await takeOverBookingSession(getSql(), ctx, parseId(params.id))
	});
});
