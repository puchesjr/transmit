import type { RequestHandler } from './$types';
import { getSql } from '$lib/server/db';
import { bookingTokenFromRequest, requestBookingHandoff } from '$lib/server/domain/booking';
import { api, jsonOk } from '$lib/server/http';

export const POST: RequestHandler = api(async ({ params, request }) =>
	jsonOk({
		state: await requestBookingHandoff(
			getSql(),
			params.key ?? '',
			bookingTokenFromRequest(request)
		)
	})
);
