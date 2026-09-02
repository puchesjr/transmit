import { expect, test } from '@playwright/test';

test('signup → create contact → see contact', async ({ page }) => {
	const email = `e2e.${Date.now()}.${Math.random().toString(16).slice(2)}@kisocrm.test`;

	await page.goto('/signup', { waitUntil: 'networkidle' });
	await page.getByLabel('Name').fill('Ada Lovelace');
	await page.getByLabel('Workspace').fill('Analytical Engine');
	await page.getByLabel('Email').fill(email);
	await page.getByLabel('Password').fill('password12');
	await page.getByRole('button', { name: 'Create workspace' }).click();

	await expect(page).toHaveURL(/\/inbox/);
	await page.getByRole('link', { name: 'Customers' }).click();
	await expect(page.getByRole('heading', { name: 'Customers' })).toBeVisible();

	await page.getByLabel('First name').fill('Charles');
	await page.getByLabel('Last name').fill('Babbage');
	await page.getByLabel('Email').fill('charles@engine.test');
	await page.getByRole('button', { name: 'Add customer' }).click();

	const contactLink = page.getByRole('link', { name: /Charles Babbage/ });
	await expect(contactLink).toBeVisible();

	await contactLink.click();
	await expect(page.getByRole('heading', { name: 'Charles Babbage' })).toBeVisible();
	await expect(page.getByText(/Charles Babbage created/)).toBeVisible();

	await page.getByPlaceholder('New company name').fill('Difference Engine Co');
	await page.getByRole('button', { name: 'Create', exact: true }).click();
	await expect(page.getByRole('link', { name: 'Difference Engine Co' })).toBeVisible();
	await expect(page.getByText(/Difference Engine Co associated/)).toBeVisible();

	await page.getByPlaceholder('Opportunity name').fill('Engine contract');
	await page.getByPlaceholder('Amount USD (optional)').fill('12000');
	await page.getByRole('button', { name: 'Create lead' }).click();
	await expect(page.getByRole('link', { name: 'Engine contract' })).toBeVisible();
	await expect(page.getByText(/Engine contract created in Lead/)).toBeVisible();

	await page.getByRole('link', { name: 'Leads' }).click();
	await expect(page.getByRole('heading', { name: 'Leads' })).toBeVisible();
	await expect(page.getByRole('link', { name: 'Engine contract' })).toBeVisible();
	await Promise.all([
		page.waitForResponse((res) => res.url().includes('/stage') && res.ok()),
		page.getByLabel('Move to').selectOption({ label: 'Qualified' })
	]);
	await expect(page.getByRole('heading', { name: /Qualified \(1\)/ })).toBeVisible();

	await page.getByRole('link', { name: 'Engine contract' }).click();
	await expect(page.getByRole('heading', { name: 'Engine contract' })).toBeVisible();

	await page.getByRole('link', { name: 'Customers' }).click();
	await page.getByRole('link', { name: /Charles Babbage/ }).click();
	await expect(page.getByText(/moved from Lead to Qualified/)).toBeVisible();

	await page.setViewportSize({ width: 375, height: 812 });
	await expect(page.getByRole('link', { name: 'Customers', exact: true })).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Charles Babbage' })).toBeVisible();
	await expect(page.getByText(/moved from Lead to Qualified/)).toBeVisible();
});
