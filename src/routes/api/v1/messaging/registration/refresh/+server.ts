import { requireAuth } from '$lib/server/context';
import { getSql } from '$lib/server/db';
import { refreshMessagingRegistration } from '$lib/server/domain/messaging';
import { api, jsonOk } from '$lib/server/http';
import { getMessagingProvider } from '$lib/server/providers/messaging';

export const POST = api(async ({ locals }) => {
	const ctx = requireAuth(locals);
	const provider = await getMessagingProvider();
	const registration = await refreshMessagingRegistration(getSql(), provider, ctx);
	return jsonOk({ registration });
});
