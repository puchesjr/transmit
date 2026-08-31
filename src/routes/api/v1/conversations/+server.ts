import { requireAuth } from '$lib/server/context';
import { getSql } from '$lib/server/db';
import { listAccountConversations } from '$lib/server/domain/messaging';
import { api, jsonOk } from '$lib/server/http';

export const GET = api(async ({ locals }) => {
	const ctx = requireAuth(locals);
	return jsonOk({ conversations: await listAccountConversations(getSql(), ctx) });
});
