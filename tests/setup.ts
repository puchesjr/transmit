import { afterAll, beforeAll, beforeEach } from 'vitest';
import { closeSql, getSql } from '$lib/server/db';
import { migrate } from '$lib/server/migrate';

process.env.DATABASE_URL ??= 'postgres://transmit:transmit@127.0.0.1:5432/transmit_test';

const sql = getSql();

beforeAll(async () => {
	await migrate(sql);
});

beforeEach(async () => {
	await sql`truncate table users, accounts cascade`;
});

afterAll(async () => {
	await closeSql();
});
