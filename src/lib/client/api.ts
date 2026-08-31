import { base } from '$app/paths';

export class ApiError extends Error {
	status: number;
	code: string;
	requestId?: string;

	constructor(status: number, code: string, message: string, requestId?: string) {
		super(message);
		this.name = 'ApiError';
		this.status = status;
		this.code = code;
		this.requestId = requestId;
	}
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
	const res = await fetch(`${base}${path}`, {
		...init,
		headers: {
			accept: 'application/json',
			...(init?.body ? { 'content-type': 'application/json' } : {}),
			...init?.headers
		},
		credentials: 'include'
	});

	const body = (await res.json().catch(() => ({}))) as {
		data?: T;
		error?: { code?: string; message?: string; request_id?: string };
	};

	if (!res.ok) {
		throw new ApiError(
			res.status,
			body.error?.code ?? 'internal',
			body.error?.message ?? 'Request failed',
			body.error?.request_id
		);
	}

	return body.data as T;
}

export const api = {
	get: <T>(path: string) => request<T>(path),
	post: <T>(path: string, body?: unknown) =>
		request<T>(path, {
			method: 'POST',
			body: body != null ? JSON.stringify(body) : undefined
		})
};
