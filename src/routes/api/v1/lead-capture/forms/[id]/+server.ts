import { requireAuth } from '$lib/server/context';
import { getSql } from '$lib/server/db';
import {
	editLeadForm,
	parseLeadFormUpdate
} from '$lib/server/domain/lead-capture';
import { api, jsonOk, readJson } from '$lib/server/http';
import { parseId } from '$lib/server/validation';

export const PUT = api(async ({ locals, params, request }) => {
	const ctx = requireAuth(locals);
	const id = parseId(params.id, 'id');
	const input = parseLeadFormUpdate(await readJson(request));
	return jsonOk({ form: await editLeadForm(getSql(), ctx, id, input) });
});
