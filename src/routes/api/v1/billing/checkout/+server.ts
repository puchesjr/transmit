import { requireAuth } from '$lib/server/context';
import { getSql } from '$lib/server/db';
import { startCheckout } from '$lib/server/domain/billing';
import { api, jsonOk } from '$lib/server/http';
import { getBillingProvider } from '$lib/server/providers/billing';

export const POST = api(async ({ locals, url }) => {
	const ctx = requireAuth(locals);
	const provider = await getBillingProvider();
	return jsonOk(await startCheckout(getSql(), provider, ctx, url.origin));
});
