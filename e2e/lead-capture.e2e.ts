import { expect, test } from '@playwright/test';

test('website request → instant SMS → Inbox → lead', async ({ page }) => {
	const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
	const email = `capture.${stamp}@kisocrm.test`;
	const contactPhone = `+1512${stamp.slice(-7)}`;

	await page.goto('/signup', { waitUntil: 'networkidle' });
	await page.getByLabel('Name').fill('Casey Owner');
	await page.getByLabel('Workspace').fill('Rapid Home Services');
	await page.getByLabel('Email').fill(email);
	await page.getByLabel('Password').fill('password12');
	await page.getByRole('button', { name: 'Create workspace' }).click();
	await expect(page).toHaveURL(/\/inbox/);

	const checkout = await page.request
		.post('/api/v1/billing/checkout')
		.then((response) => response.json() as Promise<{ data: { url: string } }>);
	await page.goto(checkout.data.url);
	await page.getByRole('link', { name: 'Settings', exact: true }).click();
	await page.getByLabel('Legal business name').fill('Rapid Home Services LLC');
	await page.getByLabel('Contact email').fill(email);
	await page.getByLabel('Business address').fill('1 Congress Ave, Austin TX');
	await page.getByRole('button', { name: 'Submit registration' }).click();
	await expect(page.getByText('approved')).toBeVisible();
	await page.getByRole('button', { name: 'Search numbers' }).click();
	await page.getByRole('button', { name: 'Use this number' }).first().click();
	await expect(page.getByText('active')).toBeVisible();

	await page.goto('/settings/capture', { waitUntil: 'networkidle' });
	await expect(page.getByText('Ready to publish')).toBeVisible();
	const formsResponse = await page.request.get('/api/v1/lead-capture/forms');
	expect(formsResponse.ok()).toBeTruthy();
	const forms = (await formsResponse.json()) as {
		data: { forms: { kind: string; publicKey: string }[] };
	};
	const service = forms.data.forms.find((form) => form.kind === 'service');
	const question = forms.data.forms.find((form) => form.kind === 'question');
	const appointment = forms.data.forms.find((form) => form.kind === 'appointment');
	const quote = forms.data.forms.find((form) => form.kind === 'quote');
	expect(service).toBeTruthy();
	expect(question && appointment && quote).toBeTruthy();

	await page.goto('/', { waitUntil: 'networkidle' });
	await page.evaluate(
		({ textKey, appointmentKey, quoteKey }) => {
			const script = document.createElement('script');
			script.src = '/embed/kiso.js';
			script.dataset.textKey = textKey;
			script.dataset.appointmentKey = appointmentKey;
			script.dataset.quoteKey = quoteKey;
			document.body.append(script);
		},
		{
			textKey: question!.publicKey,
			appointmentKey: appointment!.publicKey,
			quoteKey: quote!.publicKey
		}
	);
	const launcher = page.locator('#kiso-launcher');
	await launcher.getByRole('button', { name: 'Contact us' }).click();
	await expect(launcher.getByRole('button', { name: 'Text us' })).toBeVisible();
	await expect(launcher.getByRole('button', { name: 'Request appointment' })).toBeVisible();
	await launcher.getByRole('button', { name: 'Get a quote' }).click();
	await expect(launcher.locator('iframe')).toHaveAttribute('title', 'Get a quote');
	await expect(launcher.locator('iframe').contentFrame().getByRole('heading', { name: 'Get a quote' })).toBeVisible();

	await page.setViewportSize({ width: 375, height: 812 });
	await page.goto(`/capture/${service!.publicKey}?utm_source=producthunt&utm_campaign=launch`, {
		waitUntil: 'networkidle'
	});
	await page.getByLabel('First name').fill('Morgan');
	await page.getByLabel(/Last name/).fill('Lee');
	await page.getByLabel('Mobile phone').fill(contactPhone);
	await page.getByLabel('Email').fill(`morgan.${stamp}@example.test`);
	await page.getByLabel('What can we help with?').fill('Water heater repair');
	await page.getByLabel(/Anything else/).fill('There is water near the tank.');
	await page.getByRole('checkbox').check();
	await page.getByRole('button', { name: 'Request service by text' }).click();
	await expect(page.getByRole('heading', { name: 'Your request is in.' })).toBeVisible();

	await page.goto('/inbox', { waitUntil: 'networkidle' });
	const conversation = page.getByRole('button', { name: /Morgan Lee/ });
	await expect(conversation).toBeVisible();
	await conversation.click();
	const instantReply = page.locator('.message-out').filter({ hasText: /thanks for contacting Main/i });
	await expect(instantReply).toBeVisible();
	await expect(instantReply).toContainText('STOP');
	await expect(instantReply).toContainText('sent', { timeout: 15_000 });

	await page.getByRole('link', { name: 'Leads' }).click();
	await expect(page.getByRole('link', { name: /Water heater repair — Morgan Lee/ })).toBeVisible();
});
