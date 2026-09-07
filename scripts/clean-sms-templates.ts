import { existsSync } from 'node:fs';
import { getSql } from '../src/lib/server/db';
import { cleanStoredSmsTemplates } from '../src/lib/server/domain/sms-template-cleanup';
if (existsSync('.env')) process.loadEnvFile('.env');
const sql = getSql();
const apply = process.argv.includes('--apply');
try {
	// Explicit operator inventory; every subsequent tenant-data query is scoped.
	const accounts = await sql<{ id: string }[]>`select id from accounts`;
	const total = { changed: 0, blocked: 0, applied: 0 };
	for (const account of accounts) {
		const result = await sql.begin(tx => cleanStoredSmsTemplates(tx, account.id, apply));
		for (const key of ['changed', 'blocked', 'applied'] as const) total[key] += result[key];
	}
	console.log(JSON.stringify({ mode: apply ? 'apply' : 'preview', accounts: accounts.length, ...total }));
} finally { await sql.end(); }
