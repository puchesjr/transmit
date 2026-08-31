import { existsSync } from 'node:fs';
import { getSql } from '../src/lib/server/db';
import { log, serializeError } from '../src/lib/server/logger';
import { migrate } from '../src/lib/server/migrate';

if (existsSync('.env')) {
	process.loadEnvFile('.env');
}

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
