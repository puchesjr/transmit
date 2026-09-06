import type { RequestHandler } from './$types';
import { getSql } from '$lib/server/db';
import { bookingTokenFromRequest, confirmBooking } from '$lib/server/domain/booking';
import { api, jsonOk } from '$lib/server/http';
import { getSchedulerProvider } from '$lib/server/providers/scheduler';

export const POST: RequestHandler = api(async ({ params, request }) =>
	jsonOk({
		state: await confirmBooking(
			getSql(),
			await getSchedulerProvider(),
			params.key ?? '',
			bookingTokenFromRequest(request)
		)
	})
);
