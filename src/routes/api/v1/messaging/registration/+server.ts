import { requireAuth } from '$lib/server/context';
import { getSql } from '$lib/server/db';
import {
	getAccountRegistration,
	parseRegistration,
	submitMessagingRegistration
} from '$lib/server/domain/messaging';
import { api, jsonOk, readJson } from '$lib/server/http';
import { getMessagingProvider } from '$lib/server/providers/messaging';

export const GET = api(async ({ locals }) => {
	const ctx = requireAuth(locals);
	return jsonOk({ registration: await getAccountRegistration(getSql(), ctx) });
});

export const POST = api(async ({ request, locals }) => {
	const ctx = requireAuth(locals);
	const input = parseRegistration(await readJson(request));
	const provider = await getMessagingProvider();
	const registration = await submitMessagingRegistration(getSql(), provider, ctx, input);
	return jsonOk({ registration }, 201);
});
