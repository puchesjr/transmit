import { expect, type Page } from '@playwright/test';

export async function fillCarrierRegistration(
	page: Page,
	legalName: string,
	email: string
): Promise<void> {
	await expect(page.getByLabel('Legal business name')).toBeVisible();
	await page.getByLabel('I understand. The 14-day trial is for Kiso. Carrier fees still apply.').check();
	await page.getByRole('button', { name: 'Accept carrier fees', exact: true }).click();
	await expect(page.getByText('Carrier fees accepted.')).toBeVisible();
	await page.getByLabel('Legal business name').fill(legalName);
	await page.getByLabel('Business EIN').fill('12-3456789');
	await page.getByLabel('Contact email').fill(email);
	await page.getByLabel('Business phone').fill('5125550100');
	await page.getByLabel('Business address').fill('1 Congress Ave');
	await page.getByLabel('City').fill('Austin');
	await page.getByLabel('State').fill('TX');
	await page.getByLabel('ZIP').fill('78701');
}
