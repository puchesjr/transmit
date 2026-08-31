const REDACT = new Set([
	'password',
	'password_hash',
	'token',
	'token_hash',
	'cookie',
	'authorization',
	'database_url',
	'databaseurl'
]);

function redactValue(key: string, value: unknown): unknown {
	if (REDACT.has(key.toLowerCase())) return '[redacted]';
	if (value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Error)) {
		return redact(value as Record<string, unknown>);
	}
	return value;
}

function redact(fields: Record<string, unknown>): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(fields)) {
		out[key] = redactValue(key, value);
	}
	return out;
}

export function serializeError(err: unknown): Record<string, unknown> {
	if (err instanceof Error) {
		return { name: err.name, message: err.message };
	}
	return { message: String(err) };
}

export function log(
	level: 'info' | 'warn' | 'error',
	msg: string,
	fields: Record<string, unknown> = {}
): void {
	const rec = {
		ts: new Date().toISOString(),
		level,
		msg,
		...redact(fields)
	};
	const line = JSON.stringify(rec);
	if (level === 'error') console.error(line);
	else if (level === 'warn') console.warn(line);
	else console.log(line);
}
