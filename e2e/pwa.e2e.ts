import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { fillCarrierRegistration } from './registration';
import { signupAndEnterWorkspace } from './signup';

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

test('PWA manifest and installation metadata are served correctly', async ({ page }) => {
	const manifestResponse = await page.request.get('/manifest.webmanifest');
	expect(manifestResponse.ok()).toBeTruthy();

	const manifest = (await manifestResponse.json()) as {
		name: string;
		short_name: string;
		start_url: string;
		display: string;
		icons: Array<{ src: string; sizes: string }>;
	};

	expect(manifest.name).toBe('Kiso CRM');
	expect(manifest.short_name).toBe('Kiso');
	expect(manifest.start_url).toBe('/inbox');
	expect(manifest.display).toBe('standalone');
	expect(manifest.icons.length).toBeGreaterThanOrEqual(2);

	for (const icon of manifest.icons) {
		const iconRes = await page.request.get(icon.src);
		expect(iconRes.ok(), `Icon ${icon.src} should return 200 OK`).toBeTruthy();
	}

	await page.goto('/', { waitUntil: 'networkidle' });
	const manifestLink = page.locator('link[rel="manifest"]');
	await expect(manifestLink).toHaveAttribute('href', /\/manifest\.webmanifest$/);

	const appleCapable = page.locator('meta[name="apple-mobile-web-app-capable"]');
	await expect(appleCapable).toHaveAttribute('content', 'yes');

	const appleTouchIcon = page.locator('link[rel="apple-touch-icon"]');
	await expect(appleTouchIcon).toHaveAttribute('href', /\/icon-192\.png$/);
});

test('field technician mobile texting experience with quick replies', async ({ page }) => {
	await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'light' });
	const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
	const email = `plumber.${stamp}@kisocrm.test`;
	const contactPhone = `+1512${stamp.slice(-7)}`;

	await signupAndEnterWorkspace(page, {
		name: 'Field Plumber',
		workspaceName: 'Apex Plumbing Service',
		email
	});

	// Activate fake billing checkout
	const checkout = await page.request
		.post('/api/v1/billing/checkout')
		.then((response) => response.json() as Promise<{ data: { url: string } }>);
	await page.goto(checkout.data.url);

	// 10DLC registration
	await page.getByRole('link', { name: 'Settings', exact: true }).click();
	await fillCarrierRegistration(page, 'Apex Plumbing LLC', email);
	await page.getByRole('button', { name: 'Submit registration' }).click();
	await expect(page.getByText('approved')).toBeVisible();

	// Provision a number
	await page.getByRole('button', { name: 'Search numbers' }).click();
	await page.getByRole('button', { name: 'Use this number' }).first().click();
	await expect(page.getByText('active')).toBeVisible();

	// Create a customer contact
	await page.getByRole('link', { name: 'Customers' }).click();
	await page.getByLabel('First name').fill('Sarah');
	await page.getByLabel('Last name').fill('Homeowner');
	await page.getByLabel('Phone').fill(contactPhone);
	await page.getByRole('button', { name: 'Add customer' }).click();
	await page.getByRole('link', { name: /Sarah Homeowner/ }).click();
	await expect(page.getByRole('heading', { name: 'Sarah Homeowner' })).toBeVisible();

	// Send initial message to initialize conversation
	await page.getByPlaceholder('Text this customer…').fill('Hi Sarah, this is Apex Plumbing.');
	await page.getByRole('button', { name: 'Send', exact: true }).click();
	await expect(page.getByText('Hi Sarah, this is Apex Plumbing.', { exact: true })).toBeVisible();

	// Now switch to mobile technician viewports: 375px (iPhone) and 320px (compact)
	for (const viewport of [
		{ width: 375, height: 812 },
		{ width: 320, height: 700 }
	]) {
		await page.setViewportSize(viewport);
		await page.goto('/inbox', { waitUntil: 'networkidle' });
		await expectNoPageOverflow(page, `Inbox list at ${viewport.width}px`);

		// Tap the conversation with Sarah Homeowner
		await page.getByRole('button', { name: /Sarah Homeowner/ }).click();
		await expectNoPageOverflow(page, `Thread view at ${viewport.width}px`);

		// Verify quick replies container is present and labeled
		const quickRegion = page.getByRole('region', { name: 'Field technician quick replies' });
		await expect(quickRegion).toBeVisible();

		// Verify all quick response buttons meet minimum 48px touch targets for gloved/wet fingers
		const snippetButtons = quickRegion.getByRole('button');
		const count = await snippetButtons.count();
		expect(count).toBeGreaterThanOrEqual(4);

		for (let i = 0; i < count; i++) {
			const button = snippetButtons.nth(i);
			const box = await button.boundingBox();
			expect(box).not.toBeNull();
			if (box) {
				expect(
					box.height,
					`Quick reply button ${i} height must be >= 48px for touch accessibility`
				).toBeGreaterThanOrEqual(48);
			}
		}

		// Tap "On my way (15 mins)"
		await page.getByRole('button', { name: 'On my way (15 mins)' }).click();
		const replyInput = page.getByPlaceholder('Reply…');
		await expect(replyInput).toHaveValue('On my way (15 mins)');

		// Tap "I have arrived at your property"
		await page.getByRole('button', { name: 'I have arrived at your property' }).click();
		await expect(replyInput).toHaveValue('I have arrived at your property');

		// Verify no horizontal overflow in thread with snippets open
		await expectNoPageOverflow(page, `Thread with quick replies at ${viewport.width}px`);
	}

	// Send the message as the technician
	await page.getByRole('button', { name: 'Send' }).click();
	await expect(page.getByText('I have arrived at your property', { exact: true })).toBeVisible();

	// Run WCAG A/AA accessibility check on mobile inbox with technician quick replies
	await expectAccessible(page, 'Mobile technician inbox view with quick replies');
});
