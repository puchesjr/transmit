import { json, isHttpError, isRedirect } from '@sveltejs/kit';
import type { RequestEvent, RequestHandler } from '@sveltejs/kit';
import { AppError, statusFor } from './errors';
import { log, serializeError } from './logger';

export function api(fn: (event: RequestEvent) => Promise<Response>): RequestHandler {
	return async (event) => {
		try {
			return await fn(event);
		} catch (err) {
			if (isRedirect(err) || isHttpError(err)) throw err;
			return toErrorResponse(err, event.locals.requestId);
		}
	};
}

export function jsonOk(data: unknown, status = 200): Response {
	return json({ data }, { status });
}

export async function readJson(request: Request): Promise<unknown> {
	try {
		return await request.json();
	} catch {
		throw new AppError('validation', 'Invalid JSON body');
	}
}

export function clientIp(event: { getClientAddress: () => string; request: Request }): string | null {
	try {
		return event.getClientAddress();
	} catch {
		return event.request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
	}
}

export async function readJsonOrEmpty(request: Request): Promise<unknown> {
	const text = await request.text();
	if (!text.trim()) return {};
	try {
		return JSON.parse(text);
	} catch {
		throw new AppError('validation', 'Invalid JSON body');
	}
}

export function toErrorResponse(err: unknown, requestId: string): Response {
	if (err instanceof AppError) {
		const status = statusFor(err.code);
		if (status >= 500) {
			log('error', 'app_error', { requestId, code: err.code, message: err.message });
		}
		return json(
			{ error: { code: err.code, message: err.message, request_id: requestId } },
			{ status }
		);
	}

	log('error', 'unhandled_error', { requestId, err: serializeError(err) });
	return json(
		{ error: { code: 'internal', message: 'Something went wrong', request_id: requestId } },
		{ status: 500 }
	);
}
