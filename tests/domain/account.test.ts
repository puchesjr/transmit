import { describe, expect, it } from 'vitest';
import { getSql } from '$lib/server/db';
import { AppError } from '$lib/server/errors';
import { DEFAULT_PIPELINE_STAGES, signin, signup } from '$lib/server/domain/auth';
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
		expect(result.account.onboardingStatus).toBe('pending');
		expect(result.location.name).toBe('Main');
		expect(result.membership.role).toBe('owner');
		expect(result.user.email).toContain('@kisocrm.test');
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

	it('rate-limits signup by IP and signin by email', async () => {
		const sql = getSql();
		const ip = '203.0.113.77';
		for (let index = 0; index < 5; index += 1) {
			await signup(
				sql,
				{
					email: uniqueEmail(`rate-${index}`),
					password: 'password12',
					name: 'Rate',
					workspaceName: `Rate ${index}`
				},
				{ ip }
			);
		}
		await expect(
			signup(
				sql,
				{
					email: uniqueEmail('rate-over'),
					password: 'password12',
					name: 'Rate',
					workspaceName: 'Rate over'
				},
				{ ip }
			)
		).rejects.toMatchObject({ code: 'forbidden' } satisfies Partial<AppError>);

		const email = uniqueEmail('signin-lock');
		await signup(sql, {
			email,
			password: 'password12',
			name: 'Lock',
			workspaceName: 'Lock'
		});
		for (let index = 0; index < 8; index += 1) {
			await expect(
				signin(sql, { email, password: 'wrong-password' }, { ip: `198.51.100.${index}` })
			).rejects.toMatchObject({ code: 'unauthorized' } satisfies Partial<AppError>);
		}
		await expect(
			signin(sql, { email, password: 'wrong-password' }, { ip: '198.51.100.200' })
		).rejects.toMatchObject({ code: 'forbidden' } satisfies Partial<AppError>);
		await expect(signin(sql, { email: uniqueEmail('unknown'), password: 'password12' })).rejects.toMatchObject({
			code: 'unauthorized'
		} satisfies Partial<AppError>);
	});
});
