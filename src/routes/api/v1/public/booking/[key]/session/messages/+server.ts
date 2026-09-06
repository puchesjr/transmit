import type { RequestHandler } from './$types';
import { getSql } from '$lib/server/db';
import {
	bookingTokenFromRequest,
	continueBookingConversation,
	parseBookingMessage
} from '$lib/server/domain/booking';
import { api, jsonOk, readJson } from '$lib/server/http';
import { getAiProvider } from '$lib/server/providers/ai';
import { getSchedulerProvider } from '$lib/server/providers/scheduler';

export const POST: RequestHandler = api(async ({ params, request }) => {
	const input = parseBookingMessage(await readJson(request));
	const state = await continueBookingConversation(
		getSql(),
		await getAiProvider(),
		await getSchedulerProvider(),
		params.key ?? '',
		bookingTokenFromRequest(request),
		input.body
	);
	return jsonOk({ state }, 201);
});
