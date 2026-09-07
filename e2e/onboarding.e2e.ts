import { expect, test } from '@playwright/test';
import { fillCarrierRegistration } from './registration';
import { signupFromForm, skipOnboarding } from './signup';

test('signup lands in the 14-day setup instead of an empty inbox', async ({ page }) => {
	const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
	const email = `onboard.${stamp}@kisocrm.test`;

	await signupFromForm(page, {
		name: 'Jordan Owner',
		workspaceName: 'Onboard Home Services',
		email
	});
	await expect(page.getByRole('heading', { name: 'The software is free for 14 days.' })).toBeVisible();
	await expect(page.getByRole('heading', { name: 'This is trial software.' })).toBeVisible();

	await page.goto('/inbox', { waitUntil: 'networkidle' });
	await expect(page).toHaveURL(/\/onboarding/);

	await skipOnboarding(page);
	await expect(page.getByRole('link', { name: /Finish setup/ }).first()).toBeVisible();
});

test('14-day setup starts the trial, gets a number, and opens the inbox', async ({ page }) => {
	const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
	const email = `trial.${stamp}@kisocrm.test`;

	await signupFromForm(page, {
		name: 'Riley Owner',
		workspaceName: 'Trial Home Services',
		email
	});

	const confirmed = page.waitForResponse(
		(res) => res.url().includes('/api/v1/billing/checkout/confirm') && res.request().method() === 'POST'
	);
	await page.getByRole('button', { name: 'Start the software trial' }).click();
	// Checkout returns with the hosted session id so the trial is confirmed before webhooks land.
	await expect(page).toHaveURL(/\/onboarding\?checkout=success&session_id=cs_/);
	expect((await confirmed).ok()).toBe(true);
	await expect(page.getByRole('heading', { name: 'The carriers require this' })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Start the software trial' })).toHaveCount(0);

	await fillCarrierRegistration(page, 'Trial Home Services LLC', email);
	await page.getByRole('button', { name: 'Submit registration' }).click();
	await expect(page.getByRole('heading', { name: 'A number for this shop' })).toBeVisible();

	await page.getByRole('button', { name: 'Search numbers' }).click();
	await page.getByRole('button', { name: 'Use this number' }).first().click();
	await expect(page.getByRole('heading', { name: 'When they miss you, we text them' })).toBeVisible();

	await page.getByRole('button', { name: 'Skip for now' }).click();
	await expect(page.getByRole('heading', { name: 'The shop is open.' })).toBeVisible();
	await page.getByRole('button', { name: 'Open the inbox' }).click();
	await expect(page).toHaveURL(/\/inbox/);
	await expect(page.getByRole('heading', { name: 'Inbox' })).toBeVisible();
	await expect(page.getByRole('link', { name: /Finish setup/ })).toHaveCount(0);
});

test('unfinished setup returns on sign-in', async ({ page }) => {
	const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
	const email = `resume.${stamp}@kisocrm.test`;

	await signupFromForm(page, {
		name: 'Sam Owner',
		workspaceName: 'Resume Home Services',
		email
	});
	await page.getByRole('button', { name: 'Sign out' }).click();
	await expect(page).toHaveURL(/\/signin/);

	await page.getByLabel('Email').fill(email);
	await page.getByLabel('Password').fill('password12');
	await page.getByRole('button', { name: 'Sign in' }).click();
	await expect(page).toHaveURL(/\/onboarding/);
	await expect(page.getByRole('heading', { name: 'This is trial software.' })).toBeVisible();
});
