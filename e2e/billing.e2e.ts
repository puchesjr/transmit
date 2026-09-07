import { expect, test } from '@playwright/test';
import { fillCarrierRegistration } from './registration';
import { signupAndEnterWorkspace } from './signup';

test('signup → card-backed trial → number → SMS → metered usage', async ({ page }) => {
	const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
	const email = `billing.${stamp}@kisocrm.test`;
	const contactPhone = `+1512${stamp.slice(-7)}`;

	await signupAndEnterWorkspace(page, {
		name: 'Morgan Owner',
		workspaceName: 'Launch Workspace',
		email
	});

	await page.goto('/settings/billing');
	await expect(page.getByRole('heading', { name: 'Software trial not started' })).toBeVisible();
	await page.getByRole('button', { name: 'Start the software trial' }).click();
	await expect(page).toHaveURL(/checkout=success/);
	await expect(page.getByText('Software trial', { exact: true }).first()).toBeVisible();
	await expect(page.getByText('Card on file')).toBeVisible();

	await page.getByRole('link', { name: 'Communications', exact: true }).click();
	await fillCarrierRegistration(page, 'Launch Workspace LLC', email);
	await page.getByRole('button', { name: 'Submit registration' }).click();
	await expect(page.getByText('approved')).toBeVisible();
	await page.getByRole('button', { name: 'Search numbers' }).click();
	await page.getByRole('button', { name: 'Use this number' }).first().click();
	await expect(page.getByText('active')).toBeVisible();

	await page.getByRole('link', { name: 'Customers' }).click();
	await page.getByLabel('First name').fill('Parker');
	await page.getByLabel('Last name').fill('Prospect');
	await page.getByLabel('Phone').fill(contactPhone);
	await page.getByRole('button', { name: 'Add customer' }).click();
	await page.getByRole('link', { name: /Parker Prospect/ }).click();
	await page.getByPlaceholder('Text this customer…').fill('“Your appointment is confirmed.” ' + 'a'.repeat(140));
	await expect(page.getByText('2 SMS segments · GSM-7', { exact: false })).toBeVisible();
	await page.getByRole('button', { name: 'Send', exact: true }).click();
	await expect(page.getByText('· sent')).toBeVisible({ timeout: 15_000 });

	await page.goto('/settings/billing');
	await expect(page.getByLabel('2 of 50 trial SMS segments used')).toBeVisible({ timeout: 15_000 });
	await expect(page.getByRole('cell', { name: '2', exact: true }).first()).toBeVisible();
});
