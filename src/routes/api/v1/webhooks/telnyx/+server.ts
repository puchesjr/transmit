import { getSql } from '$lib/server/db';
import { handleProviderWebhook } from '$lib/server/domain/messaging';
import { api, jsonOk } from '$lib/server/http';
import { getMessagingProvider } from '$lib/server/providers/messaging';

export const POST = api(async ({ request }) => {
	const rawBody = await request.text();
	const provider = await getMessagingProvider();
	const result = await handleProviderWebhook(
		getSql(),
		provider,
		rawBody,
		request.headers.get('telnyx-signature-ed25519'),
		request.headers.get('telnyx-timestamp')
	);
	return jsonOk(result);
});
