import { getSql } from '$lib/server/db';
import { handleBillingWebhook } from '$lib/server/domain/billing';
import { api, jsonOk } from '$lib/server/http';
import { getBillingProvider } from '$lib/server/providers/billing';

export const POST = api(async ({ request }) => {
	const rawBody = await request.text();
	const provider = await getBillingProvider();
	const result = await handleBillingWebhook(
		getSql(),
		provider,
		rawBody,
		request.headers.get('stripe-signature')
	);
	return jsonOk(result);
});
