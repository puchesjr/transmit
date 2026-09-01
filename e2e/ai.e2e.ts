import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

async function expectAccessible(page: import('@playwright/test').Page, label: string) {
	const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
	const details = results.violations
		.map((violation) => `${violation.id}: ${violation.help}`)
		.join('\n');
	expect(results.violations, `${label}\n${details}`).toEqual([]);
}

test('inbound lead → AI choices → human sends → customer brief', async ({ page }) => {
	await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'light' });
	const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
	const email = `ai.${stamp}@transmit.test`;
	const contactPhone = `+1512${stamp.slice(-7)}`;

	await page.goto('/signup', { waitUntil: 'networkidle' });
	await page.getByLabel('Name').fill('Avery Owner');
	await page.getByLabel('Workspace').fill('Fast Response HVAC');
	await page.getByLabel('Email').fill(email);
	await page.getByLabel('Password').fill('password12');
	await page.getByRole('button', { name: 'Create workspace' }).click();
	await expect(page).toHaveURL(/\/inbox/);

	const checkout = await page.request
		.post('/api/v1/billing/checkout')
		.then((response) => response.json() as Promise<{ data: { url: string } }>);
	await page.goto(checkout.data.url);

	const registration = await page.request.post('/api/v1/messaging/registration', {
		data: {
			legalName: 'Fast Response HVAC LLC',
			ein: null,
			website: 'https://example.test',
			address: '1 Congress Ave, Austin TX',
			contactEmail: email,
			useCase: 'Respond to service requests from customers',
			sampleMessage: 'Thanks for contacting us. Reply STOP to opt out.'
		}
	});
	expect(registration.ok()).toBeTruthy();
	const available = await page.request
		.post('/api/v1/messaging/numbers/search', { data: { areaCode: '512' } })
		.then((response) => response.json() as Promise<{ data: { numbers: { e164: string }[] } }>);
	const locationNumber = available.data.numbers[0].e164;
	expect(
		(await page.request.post('/api/v1/messaging/numbers', { data: { e164: locationNumber } })).ok()
	).toBeTruthy();

	const created = await page.request
		.post('/api/v1/contacts', {
			data: { firstName: 'Jordan', lastName: 'Lead', phone: contactPhone, email: null }
		})
		.then((response) => response.json() as Promise<{ data: { contact: { id: string } } }>);
	const contactId = created.data.contact.id;
	expect(
		(
			await page.request.post(`/api/v1/contacts/${contactId}/messages`, {
				data: { body: 'Hi Jordan — how can we help today?' }
			})
		).ok()
	).toBeTruthy();

	const inbound = await page.request.post('/api/v1/webhooks/telnyx', {
		headers: { 'telnyx-signature-ed25519': 'fake-signature', 'telnyx-timestamp': '0' },
		data: {
			data: {
				id: `evt-ai-${stamp}`,
				event_type: 'message.received',
				payload: {
					id: `pm-ai-${stamp}`,
					from: { phone_number: contactPhone },
					to: [{ phone_number: locationNumber }],
					text: 'Our AC stopped working and it is getting hot. Can someone help today?'
				}
			}
		}
	});
	expect(inbound.ok()).toBeTruthy();

	await page.goto('/inbox');
	const conversationButton = page.getByRole('button', { name: /Jordan Lead/ });
	await expect(conversationButton).toContainText('Our AC stopped working and it is getting hot', { timeout: 20_000 });
	await conversationButton.click();
	await expect(
		page.getByRole('paragraph').filter({
			hasText: 'Our AC stopped working and it is getting hot. Can someone help today?'
		})
	).toBeVisible({ timeout: 20_000 });

	await page.getByRole('button', { name: 'Draft replies' }).click();
	await expect(page.getByText('AI response coach')).toBeVisible();
	await expect(page.getByText('high urgency')).toBeVisible();
	await expect(page.getByRole('button', { name: 'Use fast draft' })).toBeVisible();
	await expectAccessible(page, 'AI reply choices, light mode');
	await page.getByRole('button', { name: 'Use dark mode' }).click();
	await page.waitForTimeout(200);
	await expectAccessible(page, 'AI reply choices, dark mode');
	await page.getByRole('button', { name: 'Use light mode' }).click();
	await page.waitForTimeout(200);
	await page.getByRole('button', { name: 'Use fast draft' }).click();

	const composer = page.getByPlaceholder('Reply…');
	await expect(composer).toHaveValue(/thanks for reaching out/i);
	await page.getByRole('button', { name: 'Send', exact: true }).click();
	await expect(page.getByText(/thanks for reaching out/i).last()).toBeVisible();
	await expect(page.getByText('· sent').last()).toBeVisible({ timeout: 15_000 });

	await page.getByRole('link', { name: 'View customer profile', exact: true }).click();
	await expect(page.getByRole('heading', { name: 'Jordan Lead' })).toBeVisible();
	await page.getByRole('button', { name: 'Summarize conversation' }).click();
	await expect(page.getByText('AI customer brief')).toBeVisible();
	await expect(page.getByText('Recommended next action')).toBeVisible();
	await expect(page.getByText(/Requesting service help|Trying to schedule service/)).toBeVisible();
	await page.getByRole('button', { name: 'Use dark mode' }).click();
	await page.waitForTimeout(200);
	await page.setViewportSize({ width: 375, height: 812 });
	await expectAccessible(page, 'AI customer brief, dark mobile');
});
