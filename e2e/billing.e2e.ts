import { expect, test } from '@playwright/test';

test('signup → card-backed trial → number → SMS → metered usage', async ({ page }) => {
	const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
	const email = `billing.${stamp}@kisocrm.test`;
	const contactPhone = `+1512${stamp.slice(-7)}`;

	await page.goto('/signup', { waitUntil: 'networkidle' });
	await page.getByLabel('Name').fill('Morgan Owner');
	await page.getByLabel('Workspace').fill('Launch Workspace');
	await page.getByLabel('Email').fill(email);
	await page.getByLabel('Password').fill('password12');
	await page.getByRole('button', { name: 'Create workspace' }).click();
	await expect(page).toHaveURL(/\/inbox/);

	await page.goto('/settings/billing');
	await expect(page.getByRole('heading', { name: 'Trial not started' })).toBeVisible();
	await page.getByRole('button', { name: 'Start 14-day trial' }).click();
	await expect(page).toHaveURL(/checkout=success/);
	await expect(page.getByText('Free trial', { exact: true }).first()).toBeVisible();
	await expect(page.getByText('Card on file')).toBeVisible();

	await page.getByRole('link', { name: 'Communications', exact: true }).click();
	await page.getByLabel('Legal business name').fill('Launch Workspace LLC');
	await page.getByLabel('Contact email').fill(email);
	await page.getByLabel('Business address').fill('1 Congress Ave, Austin TX');
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
	await page.getByPlaceholder('Text this customer…').fill('Your launch demo is ready.');
	await page.getByRole('button', { name: 'Send', exact: true }).click();
	await expect(page.getByText('· sent')).toBeVisible({ timeout: 15_000 });

	await page.goto('/settings/billing');
	await expect(page.getByLabel('1 of 50 trial messages used')).toBeVisible({ timeout: 15_000 });
	await expect(page.getByRole('cell', { name: '1', exact: true }).first()).toBeVisible();
});
