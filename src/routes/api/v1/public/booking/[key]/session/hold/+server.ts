import type { RequestHandler } from './$types';
import { getSql } from '$lib/server/db';
import {
	bookingTokenFromRequest,
	holdBookingSlot,
	parseBookingHold
} from '$lib/server/domain/booking';
import { api, jsonOk, readJson } from '$lib/server/http';
import { getSchedulerProvider } from '$lib/server/providers/scheduler';

export const POST: RequestHandler = api(async ({ params, request }) => {
	const { slotId } = parseBookingHold(await readJson(request));
	return jsonOk({
		state: await holdBookingSlot(
			getSql(),
			await getSchedulerProvider(),
			params.key ?? '',
			bookingTokenFromRequest(request),
			slotId
		)
	});
});
