import { expect, test, type Page } from '@playwright/test';

async function expectNoPageOverflow(page: Page, label: string): Promise<void> {
	const dimensions = await page.evaluate(() => ({
		viewportWidth: window.innerWidth,
		documentWidth: document.documentElement.scrollWidth
	}));
	expect(
		dimensions.documentWidth,
		`${label} is ${dimensions.documentWidth - dimensions.viewportWidth}px wider than its viewport`
	).toBeLessThanOrEqual(dimensions.viewportWidth);
}

test('authenticated product stays usable at 320px and 375px', async ({ page }) => {
	await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'light' });
	const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;

	await page.goto('/signup', { waitUntil: 'networkidle' });
	await page.getByLabel('Name').fill('Mobile Owner');
	await page.getByLabel('Workspace').fill('Mobile Home Services');
	await page.getByLabel('Email').fill(`mobile.${stamp}@transmit.test`);
	await page.getByLabel('Password').fill('password12');
	await page.getByRole('button', { name: 'Create workspace' }).click();
	await expect(page).toHaveURL(/\/inbox/);

	const desktopSidebar = page.locator('aside');
	await expect(desktopSidebar).toBeVisible();
	const lightSidebarBackground = await desktopSidebar.evaluate(
		(element) => getComputedStyle(element).backgroundColor
	);
	await page.getByRole('button', { name: 'Use dark mode' }).click();
	await expect
		.poll(() => desktopSidebar.evaluate((element) => getComputedStyle(element).backgroundColor))
		.not.toBe(lightSidebarBackground);
	await page.getByRole('button', { name: 'Use light mode' }).click();

	const contactResponse = await page.request.post('/api/v1/contacts', {
		data: {
			firstName: 'Jamie',
			lastName: 'Mobile',
			email: `jamie.${stamp}@transmit.test`,
			phone: '+15125550126'
		}
	});
	expect(contactResponse.ok()).toBeTruthy();
	const contact = (await contactResponse.json()) as { data: { contact: { id: string } } };

	const companyResponse = await page.request.post('/api/v1/companies', {
		data: {
			name: 'Mobile Plumbing Co',
			domain: 'mobile-plumbing.test',
			contactId: contact.data.contact.id
		}
	});
	expect(companyResponse.ok()).toBeTruthy();
	const company = (await companyResponse.json()) as { data: { company: { id: string } } };

	const opportunityResponse = await page.request.post('/api/v1/opportunities', {
		data: {
			name: 'Mobile water heater lead',
			contactId: contact.data.contact.id,
			companyId: company.data.company.id,
			amountCents: 240000
		}
	});
	expect(opportunityResponse.ok()).toBeTruthy();
	const opportunity = (await opportunityResponse.json()) as {
		data: { opportunity: { id: string } };
	};

	const routes = [
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

	for (const viewport of [
		{ width: 320, height: 700 },
		{ width: 375, height: 812 }
	]) {
		await page.setViewportSize(viewport);
		for (const path of routes) {
			await page.goto(path, { waitUntil: 'networkidle' });
			await expectNoPageOverflow(page, `${path} at ${viewport.width}px`);
		}
	}

	await page.setViewportSize({ width: 320, height: 700 });
	await page.goto('/opportunities', { waitUntil: 'networkidle' });
	await expect(page.getByRole('link', { name: 'Mobile water heater lead' })).toBeVisible();
	await expect(page.getByText('Quick add')).toBeHidden();
	await page.getByRole('button', { name: 'New lead' }).click();
	await expect(page.getByText('Quick add')).toBeVisible();

	await page.goto('/contacts', { waitUntil: 'networkidle' });
	await expect(page.getByLabel('First name')).toBeHidden();
	await page.getByRole('button', { name: 'New customer' }).click();
	await expect(page.getByLabel('First name')).toBeVisible();

	await page.goto('/settings/messaging', { waitUntil: 'networkidle' });
	for (const name of ['Monday opens', 'Monday closes']) {
		const box = await page.getByLabel(name).boundingBox();
		expect(box).not.toBeNull();
		if (box) {
			expect(box.x).toBeGreaterThanOrEqual(0);
			expect(box.x + box.width).toBeLessThanOrEqual(320);
		}
	}

	const bottomNav = page.getByRole('navigation').filter({ has: page.getByRole('link', { name: 'Inbox' }) });
	const lightBottomNavBackground = await bottomNav.evaluate(
		(element) => getComputedStyle(element).backgroundColor
	);
	await page.getByRole('button', { name: 'Use dark mode' }).click();
	await expect
		.poll(() => bottomNav.evaluate((element) => getComputedStyle(element).backgroundColor))
		.not.toBe(lightBottomNavBackground);
	for (const link of await bottomNav.getByRole('link').all()) {
		const box = await link.boundingBox();
		expect(box).not.toBeNull();
		if (box) expect(box.height).toBeGreaterThanOrEqual(48);
	}
});
