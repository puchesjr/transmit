import { requireAuth } from '$lib/server/context';
import { getSql } from '$lib/server/db';
import {
	createWebhookEndpoint,
	getWebhookSettings,
	parseCreateWebhookEndpoint
} from '$lib/server/domain/outbound-webhooks';
import { api, jsonOk, readJson } from '$lib/server/http';

export const GET = api(async ({ locals }) => {
	const ctx = requireAuth(locals);
	return jsonOk(await getWebhookSettings(getSql(), ctx));
});

export const POST = api(async ({ locals, request }) => {
	const ctx = requireAuth(locals);
	const input = parseCreateWebhookEndpoint(await readJson(request));
	return jsonOk(await createWebhookEndpoint(getSql(), ctx, input), 201);
});
