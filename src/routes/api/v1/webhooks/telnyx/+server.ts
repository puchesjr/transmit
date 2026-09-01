import { getSql } from '$lib/server/db';
import { handleTelnyxWebhook } from '$lib/server/domain/webhooks';
import { api, jsonOk } from '$lib/server/http';
import { getMessagingProvider } from '$lib/server/providers/messaging';
import { getVoiceProvider } from '$lib/server/providers/voice';

export const POST = api(async ({ request }) => {
	const rawBody = await request.text();
	const [messaging, voice] = await Promise.all([getMessagingProvider(), getVoiceProvider()]);
	const result = await handleTelnyxWebhook(
		getSql(),
		messaging,
		voice,
		rawBody,
		request.headers.get('telnyx-signature-ed25519'),
		request.headers.get('telnyx-timestamp')
	);
	return jsonOk(result);
});
