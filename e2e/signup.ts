import { expect, type Page } from '@playwright/test';

export async function signupFromForm(
	page: Page,
	input: { name: string; workspaceName: string; email: string; password?: string }
): Promise<void> {
	await page.goto('/signup', { waitUntil: 'networkidle' });
	await page.getByLabel('Name').fill(input.name);
	await page.getByLabel('Workspace').fill(input.workspaceName);
	await page.getByLabel('Email').fill(input.email);
	await page.getByLabel('Password').fill(input.password ?? 'password12');
	await page.getByRole('button', { name: 'Create workspace' }).click();
	await expect(page).toHaveURL(/\/onboarding/);
}

export async function skipOnboarding(page: Page): Promise<void> {
	await page.getByRole('button', { name: 'Set up later' }).click();
	await expect(page).toHaveURL(/\/inbox/);
	await expect(page.getByRole('heading', { name: 'Inbox', exact: true })).toBeVisible();
}

export async function signupAndEnterWorkspace(
	page: Page,
	input: { name: string; workspaceName: string; email: string; password?: string }
): Promise<void> {
	await signupFromForm(page, input);
	await skipOnboarding(page);
}
