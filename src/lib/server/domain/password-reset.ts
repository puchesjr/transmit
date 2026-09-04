import type { Sql } from '../db';
import { AppError } from '../errors';
import { uuidv7, randomToken } from '../ids';
import { hashPassword } from '../password';
import type { EmailProvider } from '../providers/email';
import {
	findRecentPasswordReset,
	findUsablePasswordReset,
	insertPasswordReset,
	markPasswordResetUsed
} from '../repos/password-resets';
import { findUserByEmail, updateUserPassword } from '../repos/users';
import { hashToken, revokeSessionsForUser } from '../session';
import { parseEmail, parsePassword, requiredString } from '../validation';

export const RESET_TOKEN_TTL_MINUTES = 60;
/** A second request inside this window sends nothing; the first link still works. */
export const RESET_RESEND_COOLDOWN_SECONDS = 120;

export function parsePasswordResetRequest(body: unknown): { email: string } {
	const obj = body && typeof body === 'object' ? (body as Record<string, unknown>) : null;
	if (!obj) throw new AppError('validation', 'Invalid JSON body');
	return { email: parseEmail(obj.email) };
}

export function parsePasswordResetConfirm(body: unknown): { token: string; password: string } {
	const obj = body && typeof body === 'object' ? (body as Record<string, unknown>) : null;
	if (!obj) throw new AppError('validation', 'Invalid JSON body');
	return {
		token: requiredString(obj.token, 'token', 200),
		password: parsePassword(obj.password)
	};
}

export function resetLink(siteUrl: string, token: string): string {
	return `${siteUrl.replace(/\/$/, '')}/reset-password?token=${encodeURIComponent(token)}`;
}

/**
 * Always resolves, and the route always answers the same way, so the endpoint
 * cannot be used to learn which emails have accounts. Returns whether a mail
 * actually went out, for tests and logs only.
 */
export async function requestPasswordReset(
	sql: Sql,
	email: EmailProvider,
	input: { email: string; siteUrl: string }
): Promise<{ sent: boolean }> {
	const user = await findUserByEmail(sql, input.email);
	if (!user) return { sent: false };
	const recent = await findRecentPasswordReset(sql, user.id, RESET_RESEND_COOLDOWN_SECONDS);
	if (recent) return { sent: false };

	const token = randomToken();
	await insertPasswordReset(sql, {
		id: uuidv7(),
		userId: user.id,
		tokenHash: hashToken(token),
		expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MINUTES * 60 * 1000)
	});
	const link = resetLink(input.siteUrl, token);
	await email.send({
		to: user.email,
		subject: 'Reset your Kiso CRM password',
		text: [
			`Hi ${user.name},`,
			'',
			'Someone asked to reset the password for this Kiso CRM account. If that was you, open this link within the hour:',
			'',
			link,
			'',
			'If it was not you, ignore this email. Your password has not changed.'
		].join('\n')
	});
	return { sent: true };
}

/** Sets the new password, burns the token, and signs the user out everywhere. */
export async function confirmPasswordReset(
	sql: Sql,
	input: { token: string; password: string }
): Promise<{ userId: string }> {
	const reset = await findUsablePasswordReset(sql, hashToken(input.token));
	if (!reset) throw new AppError('validation', 'This reset link is invalid or has expired');
	const passwordHash = await hashPassword(input.password);
	await sql.begin(async (tx) => {
		await updateUserPassword(tx, reset.user_id, passwordHash);
		await markPasswordResetUsed(tx, reset.id);
		await revokeSessionsForUser(tx, reset.user_id);
	});
	return { userId: reset.user_id };
}
