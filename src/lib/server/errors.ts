export type AppErrorCode =
	| 'validation'
	| 'unauthorized'
	| 'forbidden'
	| 'not_found'
	| 'conflict'
	| 'internal';

export class AppError extends Error {
	readonly code: AppErrorCode;
	readonly details: unknown;

	constructor(code: AppErrorCode, message: string, details?: unknown) {
		super(message);
		this.name = 'AppError';
		this.code = code;
		this.details = details;
	}
}

export function statusFor(code: AppErrorCode): number {
	switch (code) {
		case 'validation':
			return 400;
		case 'unauthorized':
			return 401;
		case 'forbidden':
			return 403;
		case 'not_found':
			return 404;
		case 'conflict':
			return 409;
		default:
			return 500;
	}
}
