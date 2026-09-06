import { requireAuth } from '$lib/server/context';
import { getSql } from '$lib/server/db';
import {
	getConversationThread,
	parseSendMessage,
	sendConversationSms
} from '$lib/server/domain/messaging';
import { getConversationBookingContext } from '$lib/server/domain/booking';
import { api, jsonOk, readJson } from '$lib/server/http';
import { parseId } from '$lib/server/validation';

export const GET = api(async ({ locals, params }) => {
	const ctx = requireAuth(locals);
	const id = parseId(params.id);
	const [thread, booking] = await Promise.all([
		getConversationThread(getSql(), ctx, id),
		getConversationBookingContext(getSql(), ctx, id)
	]);
	return jsonOk({ ...thread, booking });
});

export const POST = api(async ({ request, locals, params }) => {
	const ctx = requireAuth(locals);
	const { body } = parseSendMessage(await readJson(request));
	const message = await sendConversationSms(getSql(), ctx, parseId(params.id), body);
	return jsonOk({ message }, 201);
});
