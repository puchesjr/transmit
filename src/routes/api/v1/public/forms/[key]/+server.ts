import type { RequestHandler } from './$types';
import { getSql } from '$lib/server/db';
import {
	getPublicLeadCaptureForm,
	parseLeadCaptureSubmission,
	submitLeadCapture
} from '$lib/server/domain/lead-capture';
import { api, jsonOk, readJson } from '$lib/server/http';

const CORS_HEADERS = {
	'access-control-allow-origin': '*',
	'access-control-allow-methods': 'GET, POST, OPTIONS',
	'access-control-allow-headers': 'content-type',
	'access-control-max-age': '86400'
};

function withCors(response: Response): Response {
	const headers = new Headers(response.headers);
	for (const [key, value] of Object.entries(CORS_HEADERS)) headers.set(key, value);
	return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

const getHandler = api(async ({ params }) => {
	const form = await getPublicLeadCaptureForm(getSql(), params.key ?? '');
	if (!form) return jsonOk({ form: null }, 404);
	const { id: _id, accountId: _accountId, locationId: _locationId, replyTemplate: _reply, ...publicForm } = form;
	return jsonOk({ form: publicForm });
});

const postHandler = api(async ({ params, request, getClientAddress }) => {
	const input = parseLeadCaptureSubmission(await readJson(request));
	let ip: string | null = null;
	try {
		ip = getClientAddress();
	} catch {
		ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
	}
	const result = await submitLeadCapture(getSql(), params.key ?? '', input, {
		ip,
		userAgent: request.headers.get('user-agent')
	});
	return jsonOk({ accepted: true, duplicate: result.duplicate || result.ignored }, 201);
});

export const GET: RequestHandler = async (event) => withCors(await getHandler(event));
export const POST: RequestHandler = async (event) => withCors(await postHandler(event));
export const OPTIONS: RequestHandler = async () =>
	new Response(null, { status: 204, headers: CORS_HEADERS });
