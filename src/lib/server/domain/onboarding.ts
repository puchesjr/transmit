import type {
	BillingStatus,
	OnboardingSnapshot,
	OnboardingStatus,
	OnboardingStep
} from '$lib/types';
import type { AuthContext } from '../context';
import type { Sql } from '../db';
import { AppError } from '../errors';
import type { BillingProvider } from '../providers/billing';
import {
	getAccount,
	mapSessionAccount,
	markOnboardingComplete,
	markOnboardingDismissed,
	onboardingStatusFromRow
} from '../repos/accounts';
import { getBillingAccount, insertBillingAccount } from '../repos/billing';
import { getLocation } from '../repos/locations';
import { getActiveNumberForLocation } from '../repos/phone-numbers';
import { getRegistration } from '../repos/registrations';
import { findUserById } from '../repos/users';
import { asObject } from '../validation';

export { mapSessionAccount, onboardingStatusFromRow };

export function workspacePath(status: OnboardingStatus): '/onboarding' | '/inbox' {
	return status === 'pending' ? '/onboarding' : '/inbox';
}

export function parseOnboardingAction(body: unknown): 'complete' | 'dismiss' {
	const obj = asObject(body);
	if (obj.action === 'complete' || obj.action === 'dismiss') return obj.action;
	throw new AppError('validation', 'action must be complete or dismiss');
}

function trialStarted(status: BillingStatus): boolean {
	return status === 'trialing' || status === 'active' || status === 'past_due';
}

export function deriveOnboardingStep(input: {
	trialStarted: boolean;
	hasRegistration: boolean;
	hasNumber: boolean;
	hasForwarding: boolean;
}): OnboardingStep {
	if (!input.trialStarted) return 'trial';
	if (!input.hasRegistration) return 'register';
	if (!input.hasNumber) return 'number';
	if (!input.hasForwarding) return 'calls';
	return 'ready';
}

export async function getOnboardingSnapshot(
	sql: Sql,
	provider: BillingProvider,
	ctx: AuthContext
): Promise<OnboardingSnapshot> {
	await insertBillingAccount(sql, ctx.accountId);
	const [account, billing, registration, number, location, user] = await Promise.all([
		getAccount(sql, ctx.accountId),
		getBillingAccount(sql, ctx.accountId),
		getRegistration(sql, ctx.accountId),
		getActiveNumberForLocation(sql, ctx.accountId, ctx.locationId),
		getLocation(sql, ctx.accountId, ctx.locationId),
		findUserById(sql, ctx.userId)
	]);
	if (!account || !billing || !location || !user) {
		throw new AppError('internal', 'Onboarding status could not be loaded');
	}

	const started = trialStarted(billing.status);
	const snapshot = {
		status: onboardingStatusFromRow(account),
		trialStarted: started,
		billingStatus: billing.status,
		trialEndsAt: billing.trial_ends_at?.toISOString() ?? null,
		registrationStatus: registration?.status ?? null,
		hasNumber: Boolean(number),
		numberE164: number?.e164 ?? null,
		forwardingNumber: location.voice_forwarding_number,
		timezone: location.timezone,
		workspaceName: account.name,
		userName: user.name,
		userEmail: user.email,
		providerMode: provider.mode
	};

	return {
		...snapshot,
		currentStep: deriveOnboardingStep({
			trialStarted: started,
			hasRegistration: Boolean(registration),
			hasNumber: Boolean(number),
			hasForwarding: Boolean(location.voice_forwarding_number)
		})
	};
}

export async function finishOnboarding(
	sql: Sql,
	ctx: AuthContext,
	action: 'complete' | 'dismiss'
): Promise<{ status: OnboardingStatus }> {
	if (ctx.role !== 'owner') {
		throw new AppError('forbidden', 'Only the workspace owner can complete or dismiss onboarding');
	}
	if (action === 'complete') {
		await markOnboardingComplete(sql, ctx.accountId);
	} else {
		await markOnboardingDismissed(sql, ctx.accountId);
	}
	const account = await getAccount(sql, ctx.accountId);
	if (!account) throw new AppError('internal', 'Workspace missing');
	return { status: onboardingStatusFromRow(account) };
}
