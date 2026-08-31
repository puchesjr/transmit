import { AppError } from './errors';
import type { SessionAccount, SessionLocation, SessionMembership, SessionUser } from '$lib/types';

export type AuthContext = {
	requestId: string;
	userId: string;
	accountId: string;
	locationId: string;
	role: SessionMembership['role'];
};

export function requireAuth(locals: App.Locals): AuthContext {
	if (!locals.user || !locals.account || !locals.location || !locals.membership) {
		throw new AppError('unauthorized', 'Sign in required');
	}
	return {
		requestId: locals.requestId,
		userId: locals.user.id,
		accountId: locals.account.id,
		locationId: locals.location.id,
		role: locals.membership.role
	};
}

export type HydratedSession = {
	user: SessionUser;
	account: SessionAccount;
	location: SessionLocation;
	membership: SessionMembership;
};
