import type { RequestHandler } from './$types';
import { getSql } from '$lib/server/db';
import { bookingTokenFromRequest, getPublicBookingState } from '$lib/server/domain/booking';
import { api, jsonOk } from '$lib/server/http';

export const GET: RequestHandler = api(async ({ params, request }) =>
	jsonOk({
		state: await getPublicBookingState(
			getSql(),
			params.key ?? '',
			bookingTokenFromRequest(request)
		)
	})
);
