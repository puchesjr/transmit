import { expect, test } from '@playwright/test';
import { fillCarrierRegistration } from './registration';
import { signupAndEnterWorkspace } from './signup';

test('website concierge → qualified lead → real slot → booking → SMS → Inbox', async ({ page }) => {
	const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
	const ownerEmail = `booking.${stamp}@kisocrm.test`;
	const contactPhone = `+1512${stamp.slice(-7)}`;

	await signupAndEnterWorkspace(page, {
		name: 'Booking Owner',
		workspaceName: 'Northstar Home Services',
		email: ownerEmail
	});

	const checkout = await page.request
		.post('/api/v1/billing/checkout')
		.then((response) => response.json() as Promise<{ data: { url: string } }>);
	await page.goto(checkout.data.url);
	await page.getByRole('link', { name: 'Settings', exact: true }).click();
	await fillCarrierRegistration(page, 'Northstar Home Services LLC', ownerEmail);
	await page.getByRole('button', { name: 'Submit registration' }).click();
	await expect(page.getByText('approved')).toBeVisible();
	await page.getByRole('button', { name: 'Search numbers' }).click();
	await page.getByRole('button', { name: 'Use this number' }).first().click();
	await expect(page.getByText('active')).toBeVisible();

	const bookingResponse = await page.request.get('/api/v1/booking/settings');
	expect(bookingResponse.ok()).toBeTruthy();
	const booking = (await bookingResponse.json()) as {
		data: {
			settings: {
				providerLocationId: string | null;
				minimumNoticeMinutes: number;
				bookingWindowDays: number;
				sessionTimeoutMinutes: number;
				confirmationTemplate: string;
			};
			services: { id: string }[];
			appointmentPublicKey: string;
		};
	};
	const enabled = await page.request.put('/api/v1/booking/settings', {
		data: { ...booking.data.settings, enabled: true }
	});
	expect(enabled.ok()).toBeTruthy();

	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto(`/book/${booking.data.appointmentPublicKey}`, { waitUntil: 'networkidle' });
	await expect(page.getByRole('heading', { name: 'Book a real available time' })).toBeVisible();
	await page.getByLabel('First name').fill('Morgan');
	await page.getByLabel(/Last name/).fill('Lee');
	await page.getByLabel('Mobile phone').fill(contactPhone);
	await page.getByLabel('Email').fill(`morgan.${stamp}@example.test`);
	await page.getByLabel('Service').selectOption(booking.data.services[0].id);
	await page.getByRole('checkbox').check();
	await page.getByRole('button', { name: 'Start booking' }).click();
	await expect(page.getByText(/I can help book a service visit/i)).toBeVisible();

	await page.getByLabel('Message').fill('The AC is not cooling at 123 Main Street, Austin TX 78701.');
	await page.getByRole('button', { name: 'Send', exact: true }).click();
	await expect(page.getByText('Available now')).toBeVisible();
	const availableSection = page.getByText('Available now').locator('..');
	await availableSection.getByRole('button').first().click();
	await expect(page.getByText(/^Held:/)).toBeVisible();
	await page.getByRole('button', { name: 'Confirm appointment' }).click();
	await expect(page.getByRole('status').getByText('Appointment booked')).toBeVisible();

	await page.goto('/inbox', { waitUntil: 'networkidle' });
	const conversation = page.getByRole('button', { name: /Morgan Lee/ });
	await expect(conversation).toBeVisible();
	await conversation.click();
	await expect(page.getByText('Website booking')).toBeVisible();
	await expect(page.getByText('Status:', { exact: false })).toContainText('booked');
	await expect(page.getByText(/· website/).first()).toBeVisible();
	const confirmation = page.locator('.message-out').filter({ hasText: /appointment with Main is booked/i });
	await expect(confirmation).toContainText('SMS');
	await expect(confirmation).toContainText('sent', { timeout: 15_000 });

	await page.getByRole('link', { name: 'Leads' }).click();
	await expect(page.getByRole('link', { name: /Service visit appointment — Morgan Lee/ })).toBeVisible();
});
