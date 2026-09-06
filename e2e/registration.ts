import type { Page } from '@playwright/test';

export async function fillCarrierRegistration(
	page: Page,
	legalName: string,
	email: string
): Promise<void> {
	await page.getByLabel('Legal business name').fill(legalName);
	await page.getByLabel('Contact email').fill(email);
	await page.getByLabel('Business phone').fill('5125550100');
	await page.getByLabel('Business address').fill('1 Congress Ave');
	await page.getByLabel('City').fill('Austin');
	await page.getByLabel('State').fill('TX');
	await page.getByLabel('ZIP').fill('78701');
}
