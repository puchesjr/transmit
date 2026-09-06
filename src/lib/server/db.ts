import postgres from 'postgres';
import { getDatabaseUrl, parsePostgresConnect } from './env';

/** Frozen query library: postgres.js (not Drizzle, not Prisma). */
export type Sql = postgres.Sql;
export type Queryable = postgres.ISql;

const pool = {
	max: 10,
	idle_timeout: 20,
	connect_timeout: 15,
	onnotice: () => {}
} as const;

let sql: Sql | undefined;

export function getSql(): Sql {
	if (!sql) {
		const connect = parsePostgresConnect(getDatabaseUrl());
		sql =
			typeof connect === 'string'
				? postgres(connect, pool)
				: postgres({
						...connect,
						...pool
					});
	}
	return sql;
}

export async function closeSql(): Promise<void> {
	if (!sql) return;
	const client = sql;
	sql = undefined;
	await client.end({ timeout: 5 });
}

export async function pingSql(client?: Sql): Promise<boolean> {
	try {
		const sql = client ?? getSql();
		await sql`select 1 as ok`;
		return true;
	} catch {
		return false;
	}
}
