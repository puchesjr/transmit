import { requireAuth } from '$lib/server/context';
import { getSql } from '$lib/server/db';
import { confirmCheckout, parseCheckoutConfirm } from '$lib/server/domain/billing';
import { api, jsonOk, readJsonOrEmpty } from '$lib/server/http';
import { getBillingProvider } from '$lib/server/providers/billing';

export const POST = api(async ({ request, locals }) => {
	const ctx = requireAuth(locals);
	const provider = await getBillingProvider();
	const { sessionId } = parseCheckoutConfirm(await readJsonOrEmpty(request));
	return jsonOk(await confirmCheckout(getSql(), provider, ctx, sessionId));
});
