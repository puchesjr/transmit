import type {
	SessionAccount,
	SessionLocation,
	SessionMembership,
	SessionUser
} from '$lib/types';

declare global {
	namespace App {
		interface Error {
			code?: string;
			requestId?: string;
		}
		interface Locals {
			requestId: string;
			user: SessionUser | null;
			account: SessionAccount | null;
			location: SessionLocation | null;
			membership: SessionMembership | null;
		}
	}
}

export {};
