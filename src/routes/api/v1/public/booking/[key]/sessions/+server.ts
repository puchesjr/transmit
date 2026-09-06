import type { RequestHandler } from './$types';
import { getSql } from '$lib/server/db';
import { parseBookingStart, startBookingSession } from '$lib/server/domain/booking';
import { api, jsonOk, readJson } from '$lib/server/http';

export const POST: RequestHandler = api(async ({ params, request, getClientAddress }) => {
	let ip: string | null = null;
	try {
		ip = getClientAddress();
	} catch {
		ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
	}
	const result = await startBookingSession(
		getSql(),
		params.key ?? '',
		parseBookingStart(await readJson(request)),
		{ ip, userAgent: request.headers.get('user-agent') }
	);
	return jsonOk(
		{ state: result.state, duplicate: result.duplicate || result.ignored },
		result.duplicate ? 200 : 201
	);
});
