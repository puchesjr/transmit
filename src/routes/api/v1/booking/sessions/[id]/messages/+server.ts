import { requireAuth } from '$lib/server/context';
import { getSql } from '$lib/server/db';
import { parseBookingMessage, sendHumanBookingReply } from '$lib/server/domain/booking';
import { api, jsonOk, readJson } from '$lib/server/http';
import { parseId } from '$lib/server/validation';

export const POST = api(async ({ locals, params, request }) => {
	const ctx = requireAuth(locals);
	const { body } = parseBookingMessage(await readJson(request));
	return jsonOk(
		{ message: await sendHumanBookingReply(getSql(), ctx, parseId(params.id), body) },
		201
	);
});
