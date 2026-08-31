import type { Handle, HandleServerError } from '@sveltejs/kit';
import { building } from '$app/environment';
import { env } from '$env/dynamic/private';
import { getSql } from '$lib/server/db';
import { uuidv7 } from '$lib/server/ids';
import { log, serializeError } from '$lib/server/logger';
import { loadSession, SESSION_COOKIE } from '$lib/server/session';
import { startWorkerLoop } from '$lib/server/worker';

if (env.DATABASE_URL) process.env.DATABASE_URL = env.DATABASE_URL;
if (env.COOKIE_SECURE) process.env.COOKIE_SECURE = env.COOKIE_SECURE;

if (!building && process.env.WORKER_DISABLED !== 'true') {
	startWorkerLoop();
}

export const handle: Handle = async ({ event, resolve }) => {
	const requestId = event.request.headers.get('x-request-id') ?? uuidv7();
	event.locals.requestId = requestId;
	event.locals.user = null;
	event.locals.account = null;
	event.locals.location = null;
	event.locals.membership = null;

	const path = event.url.pathname;
	const skipSession = path === '/health' || path === '/ready';

	if (!skipSession) {
		const token = event.cookies.get(SESSION_COOKIE);
		if (token) {
			const session = await loadSession(getSql(), token);
			if (session) {
				event.locals.user = session.user;
				event.locals.account = session.account;
				event.locals.location = session.location;
				event.locals.membership = session.membership;
			}
		}
	}

	const started = Date.now();
	const response = await resolve(event);
	response.headers.set('x-request-id', requestId);

	log('info', 'request', {
		requestId,
		method: event.request.method,
		path,
		status: response.status,
		ms: Date.now() - started
	});

	return response;
};

export const handleError: HandleServerError = ({ error, event }) => {
	const requestId = event.locals.requestId ?? uuidv7();
	log('error', 'unhandled', { requestId, err: serializeError(error) });
	return {
		message: 'Something went wrong',
		code: 'internal',
		requestId
	};
};
