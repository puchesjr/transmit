import type { SessionAccount, SessionLocation, SessionMembership, SessionUser } from '$lib/types';
import type { AuthContext } from '../context';
import type { Queryable, Sql } from '../db';
import { AppError } from '../errors';
import { uuidv7 } from '../ids';
import { hashPassword, verifyPassword } from '../password';
import { insertBillingAccount } from '../repos/billing';
import { insertDefaultAiSettings } from '../repos/ai';
import { insertAccount, insertAccountUser } from '../repos/accounts';
import { insertLocation } from '../repos/locations';
import { insertPipeline, insertPipelineStage } from '../repos/pipelines';
import { findUserByEmail, insertUser } from '../repos/users';
import { createSession } from '../session';
import { parseEmail, parsePassword, requiredString } from '../validation';
import { ensureDefaultLeadForms } from './lead-capture';

export const DEFAULT_PIPELINE_STAGES = [
	'Lead',
	'Qualified',
	'Proposal',
	'Closed Won',
	'Closed Lost'
] as const;

export type SignupInput = {
	email: string;
	password: string;
	name: string;
	workspaceName: string;
};

export type SignupResult = {
	user: SessionUser;
	account: SessionAccount;
	location: SessionLocation;
	membership: SessionMembership;
	token: string;
};

export type SigninInput = {
	email: string;
	password: string;
};

export function parseSignup(body: unknown): SignupInput {
	const obj = body && typeof body === 'object' ? (body as Record<string, unknown>) : null;
	if (!obj) throw new AppError('validation', 'Invalid JSON body');
	return {
		email: parseEmail(obj.email),
		password: parsePassword(obj.password),
		name: requiredString(obj.name, 'name', 120),
		workspaceName: requiredString(obj.workspaceName, 'workspaceName', 120)
	};
}

export function parseSignin(body: unknown): SigninInput {
	const obj = body && typeof body === 'object' ? (body as Record<string, unknown>) : null;
	if (!obj) throw new AppError('validation', 'Invalid JSON body');
	return {
		email: parseEmail(obj.email),
		password: parsePassword(obj.password)
	};
}

export async function createAccount(
	sql: Queryable,
	input: { userId: string; workspaceName: string }
): Promise<{ account: SessionAccount; location: SessionLocation; membership: SessionMembership }> {
	const accountId = uuidv7();
	const locationId = uuidv7();
	const membershipId = uuidv7();
	const pipelineId = uuidv7();

	await insertAccount(sql, { id: accountId, name: input.workspaceName });
	await insertBillingAccount(sql, accountId);
	await insertDefaultAiSettings(sql, accountId);
	await insertAccountUser(sql, {
		id: membershipId,
		accountId,
		userId: input.userId,
		role: 'owner'
	});
	await insertLocation(sql, {
		id: locationId,
		accountId,
		name: 'Main',
		isDefault: true
	});
	await ensureDefaultLeadForms(sql, accountId, locationId);
	await insertPipeline(sql, {
		id: pipelineId,
		accountId,
		name: 'Sales',
		isDefault: true
	});
	for (const [index, name] of DEFAULT_PIPELINE_STAGES.entries()) {
		await insertPipelineStage(sql, {
			id: uuidv7(),
			accountId,
			pipelineId,
			name,
			position: index
		});
	}

	return {
		account: { id: accountId, name: input.workspaceName },
		location: { id: locationId, name: 'Main' },
		membership: { id: membershipId, role: 'owner' }
	};
}

export async function signup(sql: Sql, input: SignupInput): Promise<SignupResult> {
	if (input.password.length < 8) {
		throw new AppError('validation', 'password must be at least 8 characters');
	}
	const existing = await findUserByEmail(sql, input.email);
	if (existing) {
		throw new AppError('conflict', 'An account with this email already exists');
	}

	const userId = uuidv7();
	const passwordHash = await hashPassword(input.password);

	try {
		return await sql.begin(async (tx) => {
			await insertUser(tx, {
				id: userId,
				email: input.email,
				passwordHash,
				name: input.name
			});
			const workspace = await createAccount(tx, {
				userId,
				workspaceName: input.workspaceName
			});
			const token = await createSession(tx, userId);
			return {
				user: { id: userId, email: input.email, name: input.name },
				...workspace,
				token
			};
		});
	} catch (err) {
		// Concurrent signup can pass the pre-check and lose the race on users_email_lower_idx.
		const pg = err as { code?: string; constraint_name?: string };
		if (pg.code === '23505' && pg.constraint_name === 'users_email_lower_idx') {
			throw new AppError('conflict', 'An account with this email already exists');
		}
		throw err;
	}
}

export async function signin(sql: Sql, input: SigninInput): Promise<SignupResult> {
	const user = await findUserByEmail(sql, input.email);
	if (!user) {
		throw new AppError('unauthorized', 'Invalid email or password');
	}
	const ok = await verifyPassword(input.password, user.password_hash);
	if (!ok) {
		throw new AppError('unauthorized', 'Invalid email or password');
	}

	const session = await sql.begin(async (tx) => {
		const token = await createSession(tx, user.id);
		const loaded = await tx<
			{
				account_id: string;
				account_name: string;
				location_id: string;
				location_name: string;
				membership_id: string;
				role: 'owner' | 'member';
			}[]
		>`
			select
				a.id as account_id,
				a.name as account_name,
				l.id as location_id,
				l.name as location_name,
				au.id as membership_id,
				au.role
			from account_users au
			join accounts a on a.id = au.account_id
			join locations l on l.account_id = a.id and l.is_default = true
			where au.user_id = ${user.id}
			order by au.created_at asc, au.id asc
			limit 1
		`;
		const row = loaded[0];
		if (!row) {
			throw new AppError('forbidden', 'No workspace found for this user');
		}
		return {
			user: { id: user.id, email: user.email, name: user.name },
			account: { id: row.account_id, name: row.account_name },
			location: { id: row.location_id, name: row.location_name },
			membership: { id: row.membership_id, role: row.role },
			token
		};
	});

	return session;
}

export function currentUser(ctx: AuthContext, locals: App.Locals) {
	return {
		user: { id: ctx.userId, email: locals.user!.email, name: locals.user!.name },
		account: locals.account,
		location: locals.location
	};
}
