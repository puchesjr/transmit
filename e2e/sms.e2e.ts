import { expect, test } from '@playwright/test';

test('register → provision number → send SMS → receive reply', async ({ page }) => {
	const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
	const email = `sms.${stamp}@kisocrm.test`;
	const contactPhone = `+1512${stamp.slice(-7)}`;

	await page.goto('/signup', { waitUntil: 'networkidle' });
	await page.getByLabel('Name').fill('Sam Seller');
	await page.getByLabel('Workspace').fill('SMS Workspace');
	await page.getByLabel('Email').fill(email);
	await page.getByLabel('Password').fill('password12');
	await page.getByRole('button', { name: 'Create workspace' }).click();
	await expect(page).toHaveURL(/\/inbox/);
	const checkout = await page.request
		.post('/api/v1/billing/checkout')
		.then((response) => response.json() as Promise<{ data: { url: string } }>);
	await page.goto(checkout.data.url);

	// 10DLC registration (fake provider approves instantly)
	await page.getByRole('link', { name: 'Settings', exact: true }).click();
	await page.getByLabel('Legal business name').fill('SMS Workspace LLC');
	await page.getByLabel('Contact email').fill(email);
	await page.getByLabel('Business address').fill('1 Congress Ave, Austin TX');
	await page.getByRole('button', { name: 'Submit registration' }).click();
	await expect(page.getByText('approved')).toBeVisible();

	// Provision a number
	await page.getByRole('button', { name: 'Search numbers' }).click();
	await page.getByRole('button', { name: 'Use this number' }).first().click();
	await expect(page.getByText('active')).toBeVisible();
	const numbers = await page.request
		.get('/api/v1/messaging/numbers')
		.then((res) => res.json() as Promise<{ data: { numbers: { e164: string }[] } }>);
	const locationNumber = numbers.data.numbers[0].e164;

	// Create a contact with a phone and open the thread
	await page.getByRole('link', { name: 'Customers' }).click();
	await page.getByLabel('First name').fill('Rita');
	await page.getByLabel('Last name').fill('Reply');
	await page.getByLabel('Phone').fill(contactPhone);
	await page.getByRole('button', { name: 'Add customer' }).click();
	await page.getByRole('link', { name: /Rita Reply/ }).click();
	await expect(page.getByRole('heading', { name: 'Rita Reply' })).toBeVisible();

	// Send an SMS; the in-process worker should move it to "sent"
	await page.getByPlaceholder('Text this customer…').fill('Hi Rita — ready for your quote?');
	await page.getByRole('button', { name: 'Send', exact: true }).click();
	await expect(page.getByText('Hi Rita — ready for your quote?', { exact: true })).toBeVisible();
	await expect(page.getByText('· sent')).toBeVisible({ timeout: 15_000 });

	// Simulate an inbound Telnyx webhook from the contact
	const webhook = await page.request.post('/api/v1/webhooks/telnyx', {
		headers: { 'telnyx-signature-ed25519': 'fake-signature', 'telnyx-timestamp': '0' },
		data: {
			data: {
				id: `evt-e2e-${stamp}`,
				event_type: 'message.received',
				payload: {
					id: `pm-e2e-${stamp}`,
					from: { phone_number: contactPhone },
					to: [{ phone_number: locationNumber }],
					text: 'Yes please, send it over!'
				}
			}
		}
	});
	expect(webhook.ok()).toBeTruthy();

	// Reply appears in the thread (worker + 5s thread poll)
	await expect(page.getByText('Yes please, send it over!', { exact: true })).toBeVisible({ timeout: 20_000 });

	// And in the inbox: select the thread in the split pane, reply stays visible
	await page.getByRole('link', { name: 'Inbox' }).click();
	await page.getByRole('button', { name: /Rita Reply/ }).click();
	await expect(
		page.getByRole('paragraph').filter({ hasText: 'Yes please, send it over!' })
	).toBeVisible();

	// Timeline records both directions
	await page.getByRole('link', { name: 'View customer profile', exact: true }).click();
	await expect(page.getByText(/SMS to Rita Reply/)).toBeVisible();
	await expect(page.getByText(/SMS from Rita Reply/)).toBeVisible();
});
