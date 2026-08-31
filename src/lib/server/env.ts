export function getDatabaseUrl(): string {
	const url = process.env.DATABASE_URL;
	if (!url) {
		throw new Error('DATABASE_URL is not set');
	}
	return url;
}

export function cookieSecure(): boolean {
	if (process.env.COOKIE_SECURE === 'true') return true;
	if (process.env.COOKIE_SECURE === 'false') return false;
	return process.env.NODE_ENV === 'production';
}
