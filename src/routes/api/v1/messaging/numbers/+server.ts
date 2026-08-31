import { requireAuth } from '$lib/server/context';
import { getSql } from '$lib/server/db';
import { listAccountNumbers, parsePurchaseNumber, provisionNumber } from '$lib/server/domain/messaging';
import { api, jsonOk, readJson } from '$lib/server/http';
import { getMessagingProvider } from '$lib/server/providers/messaging';

export const GET = api(async ({ locals }) => {
	const ctx = requireAuth(locals);
	return jsonOk({ numbers: await listAccountNumbers(getSql(), ctx) });
});

export const POST = api(async ({ request, locals }) => {
	const ctx = requireAuth(locals);
	const { e164 } = parsePurchaseNumber(await readJson(request));
	const provider = await getMessagingProvider();
	const number = await provisionNumber(getSql(), provider, ctx, e164);
	return jsonOk({ number }, 201);
});
