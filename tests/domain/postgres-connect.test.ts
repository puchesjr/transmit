import { describe, expect, it } from 'vitest';
import { parsePostgresConnect } from '$lib/server/env';

describe('parsePostgresConnect', () => {
	it('leaves a normal TCP URL unchanged', () => {
		const url = 'postgres://transmit:transmit@127.0.0.1:5432/transmit_test';
		expect(parsePostgresConnect(url)).toBe(url);
	});

	it('maps a Cloud SQL unix-socket URL to postgres.js path options', () => {
		const url =
			'postgres://kiso:p%40ssword%24@/kiso?host=/cloudsql/kisocrm:us-central1:kiso-pg';
		expect(parsePostgresConnect(url)).toEqual({
			path: '/cloudsql/kisocrm:us-central1:kiso-pg/.s.PGSQL.5432',
			database: 'kiso',
			username: 'kiso',
			password: 'p@ssword$',
			ssl: false
		});
	});
});
