import { existsSync } from 'node:fs';
import { getSql } from '../src/lib/server/db';
import { log, serializeError } from '../src/lib/server/logger';
import { migrate } from '../src/lib/server/migrate';

if (existsSync('.env')) {
	process.loadEnvFile('.env');
}

async function ensureDatabaseExists(urlStr?: string): Promise<void> {
	if (!urlStr) return;
	try {
		const parsed = new URL(urlStr);
		const dbName = parsed.pathname.replace(/^\//, '');
		if (!dbName || dbName === 'postgres') return;
		const adminUrl = new URL(urlStr);
		adminUrl.pathname = '/postgres';
		const postgres = (await import('postgres')).default;
		const adminSql = postgres(adminUrl.toString(), { max: 1, connect_timeout: 5 });
		try {
			const rows = await adminSql`select 1 from pg_database where datname = ${dbName}`;
			if (rows.length === 0) {
				await adminSql.unsafe(`create database "${dbName.replace(/"/g, '""')}"`);
				log('info', 'database_created', { dbName });
			}
		} finally {
			await adminSql.end({ timeout: 5 });
		}
	} catch (err) {
		if ((urlStr ?? '').includes('_e2e')) {
			throw new Error(
				'Create the Playwright database first: docker compose exec postgres createdb -U transmit transmit_e2e'
			);
		}
		void err;
	}
}

await ensureDatabaseExists(process.env.DATABASE_URL);

const sql = getSql();

try {
	const applied = await migrate(sql);
	log('info', 'migrations_applied', { applied });
} catch (err) {
	log('error', 'migrate_failed', { err: serializeError(err) });
	process.exitCode = 1;
} finally {
	await sql.end({ timeout: 5 });
}
