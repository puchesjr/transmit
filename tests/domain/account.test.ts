import { describe, expect, it } from 'vitest';
import { getSql } from '$lib/server/db';
import { AppError } from '$lib/server/errors';
import { DEFAULT_PIPELINE_STAGES, signup } from '$lib/server/domain/auth';
import { uniqueEmail } from '../helpers';

describe('account create', () => {
	it('creates a workspace, default location, owner membership, and sales pipeline', async () => {
		const sql = getSql();
		const result = await signup(sql, {
			email: uniqueEmail('ada'),
			password: 'password12',
			name: 'Ada Lovelace',
			workspaceName: 'Analytical Engines'
		});

		expect(result.account.name).toBe('Analytical Engines');
		expect(result.location.name).toBe('Main');
		expect(result.membership.role).toBe('owner');
		expect(result.user.email).toContain('@transmit.test');
		expect(result.token.length).toBeGreaterThan(20);

		const stages = await sql<{ name: string }[]>`
			select s.name
			from pipeline_stages s
			join pipelines p on p.id = s.pipeline_id
			where p.account_id = ${result.account.id}
				and s.account_id = ${result.account.id}
			order by s.position
		`;
		expect(stages.map((stage) => stage.name)).toEqual([...DEFAULT_PIPELINE_STAGES]);
	});

	it('rejects a duplicate email', async () => {
		const email = uniqueEmail('dup');
		const input = {
			email,
			password: 'password12',
			name: 'First',
			workspaceName: 'One'
		};
		await signup(getSql(), input);
		await expect(signup(getSql(), { ...input, name: 'Second', workspaceName: 'Two' })).rejects.toMatchObject({
			code: 'conflict'
		} satisfies Partial<AppError>);
	});

	it('rejects a short password', async () => {
		await expect(
			signup(getSql(), {
				email: uniqueEmail('short'),
				password: 'short',
				name: 'Ada',
				workspaceName: 'Engines'
			})
		).rejects.toMatchObject({ code: 'validation' } satisfies Partial<AppError>);
	});
});
