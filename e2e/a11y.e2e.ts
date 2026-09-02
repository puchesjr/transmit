import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

async function expectAccessible(page: Page, label: string): Promise<void> {
	const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
	const details = results.violations
		.map(
			(violation) =>
				`${violation.id} (${violation.impact ?? 'unknown'}): ${violation.help}\n${violation.nodes
					.map((node) => `  ${node.target.join(' ')} — ${node.failureSummary}`)
					.join('\n')}`
		)
		.join('\n\n');
	expect(results.violations, `${label}\n${details}`).toEqual([]);
}

async function expectSkipLink(page: Page): Promise<void> {
	await page.keyboard.press('Tab');
	const skipLink = page.getByRole('link', { name: 'Skip to main content' });
	await expect(skipLink).toBeFocused();
	await page.keyboard.press('Enter');
	await expect(page.locator('#main-content')).toBeFocused();
}

test('public launch surfaces meet WCAG A/AA in light and dark mode', async ({ page }) => {
	await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'light' });
	await page.goto('/', { waitUntil: 'networkidle' });
	await expectSkipLink(page);
	await expectAccessible(page, 'Homepage, light mode');

	await page.getByRole('button', { name: 'Decline' }).click();
	for (const path of ['/signin', '/signup', '/privacy', '/terms']) {
		await page.goto(path, { waitUntil: 'networkidle' });
		await expectAccessible(page, `${path}, light mode`);
	}

	await page.goto('/', { waitUntil: 'networkidle' });
	await page.getByRole('button', { name: 'Use dark mode' }).click();
	await page.waitForTimeout(100);
	await expectAccessible(page, 'Homepage, dark mode');

	for (const path of ['/signin', '/signup', '/privacy', '/terms']) {
		await page.goto(path, { waitUntil: 'networkidle' });
		await expectAccessible(page, `${path}, dark mode`);
	}

	await page.setViewportSize({ width: 375, height: 812 });
	await page.goto('/', { waitUntil: 'networkidle' });
	await expectAccessible(page, 'Homepage, dark mobile');
});

test('authenticated product surfaces meet WCAG A/AA in both themes', async ({ page }) => {
	await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'light' });
	const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
	await page.goto('/signup', { waitUntil: 'networkidle' });
	await page.getByLabel('Name').fill('Accessibility Owner');
	await page.getByLabel('Workspace').fill('Accessible Home Services');
	await page.getByLabel('Email').fill(`a11y.${stamp}@kisocrm.test`);
	await page.getByLabel('Password').fill('password12');
	await page.getByRole('button', { name: 'Create workspace' }).click();
	await expect(page).toHaveURL(/\/inbox/);
	await page.goto('/inbox', { waitUntil: 'networkidle' });
	await expectSkipLink(page);

	const contactResponse = await page.request.post('/api/v1/contacts', {
		data: {
			firstName: 'Jamie',
			lastName: 'Reed',
			email: `jamie.${stamp}@kisocrm.test`,
			phone: '+15125550124'
		}
	});
	expect(contactResponse.ok()).toBe(true);
	const contact = (await contactResponse.json()) as { data: { contact: { id: string } } };

	const companyResponse = await page.request.post('/api/v1/companies', {
		data: {
			name: 'Accessible Home Services',
			domain: 'accessible-home.test',
			contactId: contact.data.contact.id
		}
	});
	expect(companyResponse.ok()).toBe(true);
	const company = (await companyResponse.json()) as { data: { company: { id: string } } };

	const opportunityResponse = await page.request.post('/api/v1/opportunities', {
		data: {
			name: 'Accessible tune-up',
			contactId: contact.data.contact.id,
			companyId: company.data.company.id,
			amountCents: 18900
		}
	});
	expect(opportunityResponse.ok()).toBe(true);
	const opportunity = (await opportunityResponse.json()) as {
		data: { opportunity: { id: string } };
	};

	const productPaths = [
		'/inbox',
		'/contacts',
		`/contacts/${contact.data.contact.id}`,
		'/companies',
		`/companies/${company.data.company.id}`,
		'/opportunities',
		`/opportunities/${opportunity.data.opportunity.id}`,
		'/settings/messaging',
		'/settings/ai',
		'/settings/billing',
		'/settings/capture'
	];
	const formsResponse = await page.request.get('/api/v1/lead-capture/forms');
	expect(formsResponse.ok()).toBeTruthy();
	const forms = (await formsResponse.json()) as {
		data: { forms: { publicKey: string }[] };
	};
	const publicCapturePath = `/capture/${forms.data.forms[0].publicKey}`;

	for (const path of productPaths) {
		await page.goto(path, { waitUntil: 'networkidle' });
		await expectAccessible(page, `${path}, light mode`);
	}
	await page.goto(publicCapturePath, { waitUntil: 'networkidle' });
	await expectAccessible(page, `${publicCapturePath}, light mode`);

	await page.goto('/settings/capture', { waitUntil: 'networkidle' });
	await page.getByRole('button', { name: 'Use dark mode' }).click();
	for (const path of productPaths) {
		await page.goto(path, { waitUntil: 'networkidle' });
		await expectAccessible(page, `${path}, dark mode`);
	}
	await page.goto(publicCapturePath, { waitUntil: 'networkidle' });
	await expectAccessible(page, `${publicCapturePath}, dark mode`);

	await page.setViewportSize({ width: 375, height: 812 });
	for (const path of productPaths) {
		await page.goto(path, { waitUntil: 'networkidle' });
		await expectAccessible(page, `${path}, dark mobile`);
	}
	await page.goto(publicCapturePath, { waitUntil: 'networkidle' });
	await expectAccessible(page, `${publicCapturePath}, dark mobile`);

	await page.goto('/settings/capture', { waitUntil: 'networkidle' });
	await page.getByRole('button', { name: 'Use light mode' }).click();
	await page.setViewportSize({ width: 320, height: 700 });
	for (const path of productPaths) {
		await page.goto(path, { waitUntil: 'networkidle' });
		await expectAccessible(page, `${path}, light narrow mobile`);
	}
	await page.goto(publicCapturePath, { waitUntil: 'networkidle' });
	await expectAccessible(page, `${publicCapturePath}, light narrow mobile`);
});
