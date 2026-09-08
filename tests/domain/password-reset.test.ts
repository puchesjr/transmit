import { describe, expect, test } from 'vitest';
import { getSql } from '$lib/server/db';
import { signin } from '$lib/server/domain/auth';
import {
	confirmPasswordReset,
	requestPasswordReset,
	RESET_TOKEN_TTL_MINUTES
} from '$lib/server/domain/password-reset';
import { uuidv7 } from '$lib/server/ids';
import { FakeEmailProvider } from '$lib/server/providers/fake-email';
import { insertPasswordReset } from '$lib/server/repos/password-resets';
import { hashToken, loadSession } from '$lib/server/session';
import { createWorkspace } from '../helpers';

const SITE = 'https://kisocrm.test';

function tokenFrom(email: FakeEmailProvider): string {
	const link = email.sent.at(-1)?.text.match(/https:\/\/\S+\/reset-password\?token=(\S+)/);
	if (!link) throw new Error('no reset link in the email');
	return decodeURIComponent(link[1]!);
}

describe('password reset', () => {
	test('emails a one-hour link, sets the new password, and signs out every session', async () => {
		const sql = getSql();
		const workspace = await createWorkspace('reset');
		const email = new FakeEmailProvider();

		const requested = await requestPasswordReset(sql, email, { email: workspace.user.email, siteUrl: SITE });
		expect(requested).toEqual({ sent: true });
		expect(email.sent).toHaveLength(1);
		expect(email.sent[0]!.to).toBe(workspace.user.email);
		expect(email.sent[0]!.text).toContain('within the hour');
		const token = tokenFrom(email);

		await confirmPasswordReset(sql, { token, password: 'new-password-99' });

		await expect(loadSession(sql, workspace.token), 'the old session is gone').resolves.toBeNull();
		await expect(signin(sql, { email: workspace.user.email, password: 'password12' })).rejects.toThrow(/Invalid/);
		await expect(signin(sql, { email: workspace.user.email, password: 'new-password-99' })).resolves.toMatchObject({
			user: { id: workspace.user.id }
		});
		await expect(confirmPasswordReset(sql, { token, password: 'again-again-1' }), 'a link works once').rejects.toThrow(
			/invalid or has expired/
		);
	});

	test('answers the same for an unknown address, and sends nothing', async () => {
		const email = new FakeEmailProvider();
		await expect(
			requestPasswordReset(getSql(), email, { email: 'nobody@kisocrm.test', siteUrl: SITE })
		).resolves.toEqual({ sent: false });
		expect(email.sent).toHaveLength(0);
	});

	test('does not resend inside the cooldown window', async () => {
		const sql = getSql();
		const workspace = await createWorkspace('cooldown');
		const email = new FakeEmailProvider();
		await requestPasswordReset(sql, email, { email: workspace.user.email, siteUrl: SITE });
		await expect(requestPasswordReset(sql, email, { email: workspace.user.email, siteUrl: SITE })).resolves.toEqual({
			sent: false
		});
		expect(email.sent).toHaveLength(1);
	});

	test('rejects an expired or unknown token', async () => {
		const sql = getSql();
		const workspace = await createWorkspace('expired');
		await insertPasswordReset(sql, {
			id: uuidv7(),
			userId: workspace.user.id,
			tokenHash: hashToken('stale-token'),
			expiresAt: new Date(Date.now() - RESET_TOKEN_TTL_MINUTES * 60 * 1000)
		});
		await expect(confirmPasswordReset(sql, { token: 'stale-token', password: 'brand-new-pw1' })).rejects.toThrow(
			/invalid or has expired/
		);
		await expect(confirmPasswordReset(sql, { token: 'never-issued', password: 'brand-new-pw1' })).rejects.toThrow(
			/invalid or has expired/
		);
	});
	test('only one concurrent redemption can change the password', async () => {
		const sql = getSql();
		const workspace = await createWorkspace('race');
		const email = new FakeEmailProvider();
		await requestPasswordReset(sql, email, { email: workspace.user.email, siteUrl: SITE });
		const token = tokenFrom(email);
		const results = await Promise.allSettled([
			confirmPasswordReset(sql, { token, password: 'first-password-99' }),
			confirmPasswordReset(sql, { token, password: 'second-password-99' })
		]);
		expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
		expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
	});

	test('concurrent requests send one email and failed delivery can retry', async () => {
		const sql = getSql();
		const workspace = await createWorkspace('request-race');
		const email = new FakeEmailProvider();
		const input = { email: workspace.user.email, siteUrl: SITE };
		await expect(requestPasswordReset(sql, { name: 'fake', send: async () => { throw new Error('offline'); } }, input)).rejects.toThrow('offline');
		await Promise.all([requestPasswordReset(sql, email, input), requestPasswordReset(sql, email, input)]);
		expect(email.sent).toHaveLength(1);
	});

});
