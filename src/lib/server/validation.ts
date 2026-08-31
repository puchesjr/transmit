import { AppError } from './errors';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function asObject(body: unknown): Record<string, unknown> {
	if (body == null || typeof body !== 'object' || Array.isArray(body)) {
		throw new AppError('validation', 'Invalid JSON body');
	}
	return body as Record<string, unknown>;
}

export function requiredString(value: unknown, field: string, max = 200): string {
	if (typeof value !== 'string' || !value.trim()) {
		throw new AppError('validation', `${field} is required`);
	}
	const trimmed = value.trim();
	if (trimmed.length > max) {
		throw new AppError('validation', `${field} is too long`);
	}
	return trimmed;
}

export function optionalString(value: unknown, field: string, max = 200): string | null {
	if (value == null || value === '') return null;
	if (typeof value !== 'string') {
		throw new AppError('validation', `${field} is invalid`);
	}
	const trimmed = value.trim();
	if (!trimmed) return null;
	if (trimmed.length > max) {
		throw new AppError('validation', `${field} is too long`);
	}
	return trimmed;
}

export function parseEmail(value: unknown): string {
	const email = requiredString(value, 'email', 320).toLowerCase();
	if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
		throw new AppError('validation', 'email is invalid');
	}
	return email;
}

export function parsePassword(value: unknown): string {
	if (typeof value !== 'string' || value.length < 8) {
		throw new AppError('validation', 'password must be at least 8 characters');
	}
	if (value.length > 200) {
		throw new AppError('validation', 'password is too long');
	}
	return value;
}

export function parseId(value: unknown, field = 'id'): string {
	if (typeof value !== 'string' || !UUID_RE.test(value)) {
		throw new AppError('validation', `${field} is invalid`);
	}
	return value;
}

export function optionalId(value: unknown, field: string): string | null {
	if (value == null || value === '') return null;
	return parseId(value, field);
}

export function optionalAmountCents(value: unknown): number | null {
	if (value == null || value === '') return null;
	if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 10_000_000_000) {
		throw new AppError('validation', 'amountCents is invalid');
	}
	return value;
}
