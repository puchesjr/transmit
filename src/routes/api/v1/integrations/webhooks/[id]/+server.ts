import { requireAuth } from '$lib/server/context';
import { getSql } from '$lib/server/db';
import { removeWebhookEndpoint } from '$lib/server/domain/outbound-webhooks';
import { api, jsonOk } from '$lib/server/http';
import { parseId } from '$lib/server/validation';

export const DELETE = api(async ({ locals, params }) => {
	const ctx = requireAuth(locals);
	await removeWebhookEndpoint(getSql(), ctx, parseId(params.id, 'id'));
	return jsonOk({ removed: true });
});
