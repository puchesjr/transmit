import { expect, test } from '@playwright/test';

test('launch demo: configure voice → recover a missed call → close the lead', async ({ page }) => {
	const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
	const email = `voice.${stamp}@transmit.test`;
	const caller = `+1512${stamp.slice(-7)}`;
	const callerName = `Caller ${caller.slice(-4)}`;

	await page.goto('/signup', { waitUntil: 'networkidle' });
	await page.getByLabel('Name').fill('Taylor Owner');
	await page.getByLabel('Workspace').fill('Voice Workspace');
	await page.getByLabel('Email').fill(email);
	await page.getByLabel('Password').fill('password12');
	await page.getByRole('button', { name: 'Create workspace' }).click();
	await expect(page).toHaveURL(/\/inbox/);
	const checkout = await page.request
		.post('/api/v1/billing/checkout')
		.then((response) => response.json() as Promise<{ data: { url: string } }>);
	await page.goto(checkout.data.url);

	await page.getByRole('link', { name: 'Settings', exact: true }).click();
	await page.getByLabel('Legal business name').fill('Voice Workspace LLC');
	await page.getByLabel('Contact email').fill(email);
	await page.getByLabel('Business address').fill('1 Congress Ave, Austin TX');
	await page.getByRole('button', { name: 'Submit registration' }).click();
	await expect(page.getByText('approved')).toBeVisible();

	await page.getByRole('button', { name: 'Search numbers' }).click();
	await page.getByRole('button', { name: 'Use this number' }).first().click();
	await expect(page.getByText('active')).toBeVisible();
	const numbers = await page.request
		.get('/api/v1/messaging/numbers')
		.then((response) => response.json() as Promise<{ data: { numbers: { e164: string }[] } }>);
	const locationNumber = numbers.data.numbers[0].e164;

	await page.getByLabel('Forward calls to').fill('+15125550100');
	await page.getByRole('button', { name: 'Save call settings' }).click();
	await expect(page.getByText('Call settings saved')).toBeVisible();

	// Sunday is closed in the default weekly schedule, so this call is rejected
	// and recovered with a textback without ringing the forwarding number.
	const webhook = await page.request.post('/api/v1/webhooks/telnyx', {
		headers: { 'telnyx-signature-ed25519': 'fake-signature', 'telnyx-timestamp': '0' },
		data: {
			data: {
				id: `evt-voice-${stamp}`,
				event_type: 'call.initiated',
				occurred_at: '2026-08-30T15:00:00.000Z',
				payload: {
					call_control_id: `cc-${stamp}`,
					call_session_id: `session-${stamp}`,
					call_leg_id: `leg-${stamp}`,
					direction: 'incoming',
					from: caller,
					to: locationNumber,
					start_time: '2026-08-30T15:00:00.000Z',
					occurred_at: '2026-08-30T15:00:00.000Z'
				}
			}
		}
	});
	expect(webhook.ok()).toBeTruthy();

	const customerLink = page.getByRole('link', { name: callerName, exact: true });
	await expect(customerLink).toBeVisible({ timeout: 20_000 });
	await expect(page.getByText('after hours · missed')).toBeVisible();
	await customerLink.click();
	await expect(page.getByRole('heading', { name: callerName })).toBeVisible();
	await expect(page.getByText(/Missed call from Caller .* after hours/)).toBeVisible();
	await expect(
		page.getByText('Sorry we missed your call — how can we help? Reply STOP to opt out.', {
			exact: true
		})
	).toBeVisible();
	await expect(page.getByText('· sent')).toBeVisible({ timeout: 15_000 });

	await page.getByRole('link', { name: 'Inbox', exact: true }).click();
	await page.getByRole('button', { name: new RegExp(callerName) }).click();
	await expect(
		page.getByText('Sorry we missed your call — how can we help? Reply STOP to opt out.', {
			exact: true
		})
	).toBeVisible();
	await page.getByRole('link', { name: 'View customer profile' }).click();

	await page.getByPlaceholder('Opportunity name').fill('Recovered service call');
	await page.getByPlaceholder('Amount USD (optional)').fill('850');
	await page.getByRole('button', { name: 'Create lead' }).click();
	await expect(page.getByRole('link', { name: 'Recovered service call' })).toBeVisible();

	await page.getByRole('link', { name: 'Leads', exact: true }).click();
	await expect(page.getByRole('link', { name: 'Recovered service call' })).toBeVisible();
	await Promise.all([
		page.waitForResponse((response) => response.url().includes('/stage') && response.ok()),
		page.getByLabel('Move to').selectOption({ label: 'Closed Won' })
	]);
	await expect(page.getByRole('heading', { name: /Closed Won \(1\)/ })).toBeVisible();
});
