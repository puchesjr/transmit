import { requireAuth } from '$lib/server/context';
import { getSql } from '$lib/server/db';
import { createBookingService, parseBookingService } from '$lib/server/domain/booking';
import { api, jsonOk, readJson } from '$lib/server/http';

export const POST = api(async ({ locals, request }) => {
	const ctx = requireAuth(locals);
	return jsonOk(
		{
			service: await createBookingService(
				getSql(),
				ctx,
				parseBookingService(await readJson(request))
			)
		},
		201
	);
});
