import { requireAuth } from '$lib/server/context';
import { getSql } from '$lib/server/db';
import { acceptFeeSchedule, telecomSummary, processTelecomCharge } from '$lib/server/domain/telecom';
import { AppError } from '$lib/server/errors';
import { api, jsonOk, readJson } from '$lib/server/http';
import { asObject, parseId } from '$lib/server/validation';
import { getBillingProvider } from '$lib/server/providers/billing';

export const GET = api(async ({ locals }) => {
	const ctx = requireAuth(locals);
	return jsonOk(await telecomSummary(getSql(), ctx.accountId));
});

export const POST = api(async ({ locals, request }) => {
	const ctx = requireAuth(locals);
	const body = asObject(await readJson(request));
	await acceptFeeSchedule(getSql(), ctx, body.version);
	return jsonOk(await telecomSummary(getSql(), ctx.accountId));
});

export const PUT = api(async ({ locals, request }) => {
	const ctx = requireAuth(locals);
	if (ctx.role !== 'owner') throw new AppError('forbidden', 'Only the workspace owner can retry telecom charges.');
	const body = asObject(await readJson(request));
	const chargeId = parseId(body.chargeId, 'chargeId');
	await processTelecomCharge(getSql(), await getBillingProvider(), { accountId: ctx.accountId, chargeId });
	return jsonOk(await telecomSummary(getSql(), ctx.accountId));
});
