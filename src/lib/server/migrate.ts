import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Sql } from './db';

export async function migrate(sql: Sql, migrationsDir?: string): Promise<string[]> {
	const dir = migrationsDir ?? join(process.cwd(), 'migrations');
	await sql`
		create table if not exists schema_migrations (
			id text primary key,
			applied_at timestamptz not null default now()
		)
	`;

	const files = (await readdir(dir))
		.filter((name) => name.endsWith('.sql'))
		.sort();
	const applied: string[] = [];

	for (const file of files) {
		const existing = await sql<{ id: string }[]>`
			select id from schema_migrations where id = ${file}
		`;
		if (existing.length > 0) continue;

		const text = await readFile(join(dir, file), 'utf8');
		await sql.begin(async (tx) => {
			await tx.unsafe(text);
			await tx`insert into schema_migrations (id) values (${file})`;
		});
		applied.push(file);
	}

	return applied;
}
