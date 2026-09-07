import type { OnboardingStatus, SessionAccount } from '$lib/types';
import type { Queryable } from '../db';

export type AccountOnboardingRow = {
	id: string;
	name: string;
	onboarding_completed_at: Date | null;
	onboarding_dismissed_at: Date | null;
};

export function onboardingStatusFromRow(
	row: Pick<AccountOnboardingRow, 'onboarding_completed_at' | 'onboarding_dismissed_at'>
): OnboardingStatus {
	if (row.onboarding_completed_at) return 'complete';
	if (row.onboarding_dismissed_at) return 'dismissed';
	return 'pending';
}

export function mapSessionAccount(row: AccountOnboardingRow): SessionAccount {
	return {
		id: row.id,
		name: row.name,
		onboardingStatus: onboardingStatusFromRow(row)
	};
}

export async function insertAccount(sql: Queryable, row: { id: string; name: string }): Promise<void> {
	await sql`
		insert into accounts (id, name)
		values (${row.id}, ${row.name})
	`;
}

export async function getAccount(
	sql: Queryable,
	accountId: string
): Promise<AccountOnboardingRow | null> {
	const rows = await sql<AccountOnboardingRow[]>`
		select id, name, onboarding_completed_at, onboarding_dismissed_at
		from accounts
		where id = ${accountId}
		limit 1
	`;
	return rows[0] ?? null;
}

export async function markOnboardingComplete(sql: Queryable, accountId: string): Promise<void> {
	await sql`
		update accounts
		set onboarding_completed_at = coalesce(onboarding_completed_at, now()),
			updated_at = now()
		where id = ${accountId}
	`;
}

export async function markOnboardingDismissed(sql: Queryable, accountId: string): Promise<void> {
	await sql`
		update accounts
		set onboarding_dismissed_at = coalesce(onboarding_dismissed_at, now()),
			updated_at = now()
		where id = ${accountId}
			and onboarding_completed_at is null
	`;
}

export async function insertAccountUser(
	sql: Queryable,
	row: { id: string; accountId: string; userId: string; role: 'owner' | 'member' }
): Promise<void> {
	await sql`
		insert into account_users (id, account_id, user_id, role)
		values (${row.id}, ${row.accountId}, ${row.userId}, ${row.role})
	`;
}
