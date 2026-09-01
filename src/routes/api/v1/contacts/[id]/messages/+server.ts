import { requireAuth } from '$lib/server/context';
import { getSql } from '$lib/server/db';
import { getContactMessageThread, parseSendMessage, sendSms } from '$lib/server/domain/messaging';
import { api, jsonOk, readJson } from '$lib/server/http';
import { parseId } from '$lib/server/validation';

export const GET = api(async ({ locals, params }) => {
	const ctx = requireAuth(locals);
	return jsonOk(await getContactMessageThread(getSql(), ctx, parseId(params.id)));
});

export const POST = api(async ({ request, locals, params }) => {
	const ctx = requireAuth(locals);
	const { body } = parseSendMessage(await readJson(request));
	const message = await sendSms(getSql(), ctx, parseId(params.id), body);
	return jsonOk({ message }, 201);
});
