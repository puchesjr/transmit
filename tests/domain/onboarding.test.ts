import { describe, expect, it } from 'vitest';
import { getSql } from '$lib/server/db';
import {
	deriveOnboardingStep,
	finishOnboarding,
	getOnboardingSnapshot
} from '$lib/server/domain/onboarding';
import { startCheckout } from '$lib/server/domain/billing';
import { FakeBillingProvider } from '$lib/server/providers/fake-billing';
import { authContext, createWorkspace } from '../helpers';

describe('onboarding steps', () => {
	it('starts at trial and advances only when the previous capability exists', () => {
		expect(
			deriveOnboardingStep({
				trialStarted: false,
				hasRegistration: false,
				hasNumber: false,
				hasForwarding: false
			})
		).toBe('trial');
		expect(
			deriveOnboardingStep({
				trialStarted: true,
				hasRegistration: false,
				hasNumber: false,
				hasForwarding: false
			})
		).toBe('register');
		expect(
			deriveOnboardingStep({
				trialStarted: true,
				hasRegistration: true,
				hasNumber: false,
				hasForwarding: false
			})
		).toBe('number');
		expect(
			deriveOnboardingStep({
				trialStarted: true,
				hasRegistration: true,
				hasNumber: true,
				hasForwarding: false
			})
		).toBe('calls');
		expect(
			deriveOnboardingStep({
				trialStarted: true,
				hasRegistration: true,
				hasNumber: true,
				hasForwarding: true
			})
		).toBe('ready');
	});
});

describe('workspace onboarding', () => {
	it('marks a new workspace pending until setup is completed or dismissed', async () => {
		const sql = getSql();
		const workspace = await createWorkspace('onboard-new');
		expect(workspace.account.onboardingStatus).toBe('pending');

		const snapshot = await getOnboardingSnapshot(
			sql,
			new FakeBillingProvider(),
			authContext(workspace)
		);
		expect(snapshot).toMatchObject({
			status: 'pending',
			currentStep: 'trial',
			trialStarted: false,
			registrationStatus: null,
			hasNumber: false,
			workspaceName: workspace.account.name,
			userEmail: workspace.user.email
		});
	});

	it('dismisses setup without starting a trial', async () => {
		const sql = getSql();
		const workspace = await createWorkspace('onboard-skip');
		const result = await finishOnboarding(sql, authContext(workspace), 'dismiss');
		expect(result.status).toBe('dismissed');

		const snapshot = await getOnboardingSnapshot(
			sql,
			new FakeBillingProvider(),
			authContext(workspace)
		);
		expect(snapshot.status).toBe('dismissed');
		expect(snapshot.currentStep).toBe('trial');
	});

	it('completes setup after a 14-day trial starts', async () => {
		const sql = getSql();
		const workspace = await createWorkspace('onboard-done');
		const ctx = authContext(workspace);
		const provider = new FakeBillingProvider();
		const checkout = await startCheckout(sql, provider, ctx, 'http://kisocrm.test', {
			returnTo: 'onboarding'
		});
		expect(checkout.url).toContain('/onboarding?checkout=success');

		const afterTrial = await getOnboardingSnapshot(sql, provider, ctx);
		expect(afterTrial.trialStarted).toBe(true);
		expect(afterTrial.currentStep).toBe('register');
		expect(afterTrial.billingStatus).toBe('trialing');

		const result = await finishOnboarding(sql, ctx, 'complete');
		expect(result.status).toBe('complete');
		const snapshot = await getOnboardingSnapshot(sql, provider, ctx);
		expect(snapshot.status).toBe('complete');
	});

	it('does not let a dismissed workspace overwrite a completed one', async () => {
		const sql = getSql();
		const workspace = await createWorkspace('onboard-lock');
		const ctx = authContext(workspace);
		await finishOnboarding(sql, ctx, 'complete');
		const dismissed = await finishOnboarding(sql, ctx, 'dismiss');
		expect(dismissed.status).toBe('complete');
	});

	it('requires owner role to finish or dismiss onboarding', async () => {
		const sql = getSql();
		const workspace = await createWorkspace('onboard-role');
		const memberCtx = { ...authContext(workspace), role: 'member' as const };
		await expect(finishOnboarding(sql, memberCtx, 'complete')).rejects.toThrow('owner');
		await expect(finishOnboarding(sql, memberCtx, 'dismiss')).rejects.toThrow('owner');
	});
});
