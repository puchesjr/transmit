import { requireAuth } from '$lib/server/context';
import { getSql } from '$lib/server/db';
import { getBillingSummary } from '$lib/server/domain/billing';
import { api, jsonOk } from '$lib/server/http';
import { getBillingProvider } from '$lib/server/providers/billing';

export const GET = api(async ({ locals }) => {
	const ctx = requireAuth(locals);
	const provider = await getBillingProvider();
	return jsonOk({ billing: await getBillingSummary(getSql(), provider, ctx) });
});
