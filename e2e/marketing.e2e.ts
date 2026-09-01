import { expect, test } from '@playwright/test';

test('public launch page is responsive, honest, and links to the launch surfaces', async ({ page }) => {
	await page.goto('/', { waitUntil: 'networkidle' });

	await expect(page).toHaveTitle('Transmit — Turn missed calls into booked work');
	await expect(page.getByRole('heading', { level: 1, name: 'Turn missed calls into booked work.' })).toBeVisible();
	await expect(page.getByText('AI-assisted · human-sent')).toBeVisible();
	await expect(page.getByRole('heading', { name: 'AI response coach' })).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Website lead capture' })).toBeVisible();
	await expect(page.getByRole('link', { name: 'Start your 14-day trial' }).first()).toHaveAttribute('href', '/signup');
	await expect(page.getByText(/^\$99/)).toBeVisible();
	await expect(page.getByText('+ $0.02 per sent or received message')).toBeVisible();

	const productImages = [
		{
			path: '/images/product-inbox.jpg',
			alt: 'Transmit shared inbox showing a real two-way customer text conversation'
		},
		{
			path: '/images/product-leads.jpg',
			alt: 'Transmit lead pipeline with open and closed opportunities'
		},
		{
			path: '/images/product-billing.jpg',
			alt: 'Transmit billing page with trial and usage details'
		}
	];
	await page.locator('#product').scrollIntoViewIfNeeded();
	for (const image of productImages) {
		const response = await page.request.get(image.path);
		expect(response.ok()).toBeTruthy();
		expect(response.headers()['content-type']).toContain('image/jpeg');
		const element = page.getByAltText(image.alt);
		await expect(element).toBeVisible();
		expect(await element.evaluate((img) => (img as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
	}

	const canonical = page.locator('link[rel="canonical"]');
	await expect(canonical).toHaveAttribute('href', 'https://transmit.dev/');
	await expect(page.locator('meta[property="og:image"]')).toHaveAttribute('content', 'https://transmit.dev/og.png');

	await page.setViewportSize({ width: 1440, height: 900 });
	const valueRow = page.getByRole('list', { name: 'Why Transmit' });
	const valueRowBox = await valueRow.boundingBox();
	const firstValueBox = await valueRow.getByRole('listitem').first().boundingBox();
	const lastValueBox = await valueRow.getByRole('listitem').last().boundingBox();
	expect(valueRowBox).not.toBeNull();
	expect(firstValueBox).not.toBeNull();
	expect(lastValueBox).not.toBeNull();
	if (valueRowBox && firstValueBox && lastValueBox) {
		expect(Math.abs(firstValueBox.x - valueRowBox.x)).toBeLessThan(1);
		expect(
			Math.abs(lastValueBox.x + lastValueBox.width - (valueRowBox.x + valueRowBox.width))
		).toBeLessThan(1);
	}

	await expect(page.getByLabel('Analytics preferences')).toBeVisible();
	await page.getByRole('button', { name: 'Decline' }).click();
	await expect(page.getByLabel('Analytics preferences')).toBeHidden();
	expect(await page.evaluate(() => localStorage.getItem('transmit-analytics-consent'))).toBe('declined');

	await page.getByRole('button', { name: 'Use dark mode' }).click();
	await expect(page.locator('html')).toHaveClass(/dark/);

	for (const viewport of [
		{ width: 1440, height: 900 },
		{ width: 768, height: 1024 },
		{ width: 375, height: 812 },
		{ width: 320, height: 700 }
	]) {
		await page.setViewportSize(viewport);
		const horizontalOverflow = await page.evaluate(
			() => document.documentElement.scrollWidth > window.innerWidth
		);
		expect(horizontalOverflow).toBeFalsy();
	}
	await expect(page.getByRole('link', { name: 'Start trial' })).toBeVisible();

	await page.goto('/#workflow');
	await expect(page.getByRole('heading', { name: 'One new lead. Four calm steps.' })).toBeVisible();
	await page.getByText('Does Transmit use AI to answer customers?').click();
	await expect(page.getByText(/AI never sends automatically/)).toBeVisible();

	await page.getByRole('link', { name: 'Privacy' }).click();
	await expect(page.getByRole('heading', { level: 1, name: 'Privacy policy' })).toBeVisible();
	await expect(page.getByText('Optional website analytics load only after you select')).toBeVisible();

	const sitemap = await page.request.get('/sitemap.xml');
	expect(sitemap.ok()).toBeTruthy();
	expect(await sitemap.text()).toContain('<loc>https://transmit.dev/privacy</loc>');
	const robots = await page.request.get('/robots.txt');
	expect(robots.ok()).toBeTruthy();
	expect(await robots.text()).toContain('Disallow: /api/');
});
