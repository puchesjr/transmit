export function getDatabaseUrl(): string {
	const url = process.env.DATABASE_URL;
	if (!url) {
		throw new Error('DATABASE_URL is not set');
	}
	return url;
}

/** postgres.js `new URL()` rejects `postgres://user:pass@/db?host=/cloudsql/...` (empty host). */
export type PostgresSocketConnect = {
	path: string;
	database: string;
	username: string;
	password: string;
	ssl: false;
};

export function parsePostgresConnect(url: string): string | PostgresSocketConnect {
	const socket = new URLSearchParams(url.split('?')[1] ?? '').get('host');
	if (!socket?.startsWith('/cloudsql/')) return url;

	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		parsed = new URL(url.replace(/@\//, '@127.0.0.1/'));
	}

	return {
		path: `${socket}/.s.PGSQL.5432`,
		database: decodeURIComponent(parsed.pathname.replace(/^\//, '')),
		username: decodeURIComponent(parsed.username),
		password: decodeURIComponent(parsed.password),
		ssl: false
	};
}

export function cookieSecure(): boolean {
	if (process.env.COOKIE_SECURE === 'true') return true;
	if (process.env.COOKIE_SECURE === 'false') return false;
	return process.env.NODE_ENV === 'production';
}
