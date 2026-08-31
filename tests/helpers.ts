import type { AuthContext } from '$lib/server/context';
import { getSql } from '$lib/server/db';
import { signup, type SignupResult } from '$lib/server/domain/auth';

let seq = 0;

export function uniqueEmail(prefix = 'user'): string {
	seq += 1;
	return `${prefix}.${Date.now()}.${seq}@transmit.test`;
}

export async function createWorkspace(prefix = 'user'): Promise<SignupResult> {
	return signup(getSql(), {
		email: uniqueEmail(prefix),
		password: 'password12',
		name: 'Test Owner',
		workspaceName: `${prefix} workspace`
	});
}

export function authContext(result: SignupResult): AuthContext {
	return {
		requestId: 'test-request',
		userId: result.user.id,
		accountId: result.account.id,
		locationId: result.location.id,
		role: result.membership.role
	};
}
