import { requireAuth } from '$lib/server/context';
import { getSql } from '$lib/server/db';
import { parseCheckout, startCheckout } from '$lib/server/domain/billing';
import { api, jsonOk, readJsonOrEmpty } from '$lib/server/http';
import { getBillingProvider } from '$lib/server/providers/billing';

export const POST = api(async ({ request, locals, url }) => {
	const ctx = requireAuth(locals);
	const provider = await getBillingProvider();
	const { returnTo } = parseCheckout(await readJsonOrEmpty(request));
	return jsonOk(await startCheckout(getSql(), provider, ctx, url.origin, { returnTo }));
});
