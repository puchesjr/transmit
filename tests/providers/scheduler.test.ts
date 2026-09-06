import { afterEach, describe, expect, it, vi } from 'vitest';
import { DesignPartnerSchedulerProvider } from '$lib/server/providers/design-partner-scheduler';
import { FakeSchedulerProvider } from '$lib/server/providers/fake-scheduler';
import {
	getSchedulerProvider,
	schedulerProviderConfigured,
	setSchedulerProvider
} from '$lib/server/providers/scheduler';

afterEach(() => {
	setSchedulerProvider(undefined);
	vi.unstubAllEnvs();
	vi.unstubAllGlobals();
});

describe('scheduler providers', () => {
	it('keeps fake holds and bookings idempotent', async () => {
		const provider = new FakeSchedulerProvider();
		const windowStart = new Date(Date.now() + 60_000);
		const windowEnd = new Date(Date.now() + 7 * 86_400_000);
		const slots = await provider.getAvailability({
			providerLocationId: null,
			providerServiceId: null,
			serviceName: 'Service visit',
			durationMinutes: 60,
			timezone: 'America/Chicago',
			windowStart,
			windowEnd
		});
		const customer = {
			name: 'Morgan Lee',
			phone: '+15125550188',
			email: null,
			serviceAddress: '123 Main Street'
		};
		const firstHold = await provider.hold({
			providerLocationId: null,
			providerServiceId: null,
			slot: slots[0],
			customer,
			idempotencyKey: 'hold-1'
		});
		const retryHold = await provider.hold({
			providerLocationId: null,
			providerServiceId: null,
			slot: slots[0],
			customer,
			idempotencyKey: 'hold-1'
		});
		expect(retryHold).toEqual(firstHold);
		await expect(
			provider.hold({
				providerLocationId: null,
				providerServiceId: null,
				slot: slots[0],
				customer,
				idempotencyKey: 'hold-conflict'
			})
		).rejects.toThrow('no longer available');
		const firstBooking = await provider.book({
			holdId: firstHold.holdId,
			customer,
			notes: 'Leaking tank',
			idempotencyKey: 'book-1'
		});
		const retryBooking = await provider.book({
			holdId: firstHold.holdId,
			customer,
			notes: 'Leaking tank',
			idempotencyKey: 'book-1'
		});
		expect(retryBooking).toEqual(firstBooking);
		expect(provider.bookings.size).toBe(1);
		const unavailable = await provider.getAvailability({
			providerLocationId: null,
			providerServiceId: null,
			serviceName: 'Service visit',
			durationMinutes: 60,
			timezone: 'America/Chicago',
			windowStart,
			windowEnd
		});
		expect(unavailable.some((slot) => slot.id === slots[0].id)).toBe(false);
		await provider.cancel({
			bookingId: firstBooking.bookingId,
			reason: 'Customer cancelled',
			idempotencyKey: 'cancel-book-1'
		});
		const released = await provider.getAvailability({
			providerLocationId: null,
			providerServiceId: null,
			serviceName: 'Service visit',
			durationMinutes: 60,
			timezone: 'America/Chicago',
			windowStart,
			windowEnd
		});
		expect(released.some((slot) => slot.id === slots[0].id)).toBe(true);

		const cancelledHold = await provider.hold({
			providerLocationId: null,
			providerServiceId: null,
			slot: slots[1],
			customer,
			idempotencyKey: 'hold-cancelled'
		});
		await provider.cancel({
			holdId: cancelledHold.holdId,
			reason: 'Customer released hold',
			idempotencyKey: 'cancel-hold-1'
		});
		await expect(
			provider.book({
				holdId: cancelledHold.holdId,
				customer,
				notes: '',
				idempotencyKey: 'book-cancelled-hold'
			})
		).rejects.toThrow('expired');
	});

	it('uses the design-partner HTTPS contract without exposing the credential in payloads', async () => {
		vi.stubEnv('SCHEDULER_API_BASE_URL', 'https://scheduler.example.test/v1');
		vi.stubEnv('SCHEDULER_API_KEY', 'scheduler-secret');
		const fetchMock = vi.fn().mockResolvedValue(
			new Response(
				JSON.stringify({
					slots: [
						{
							id: 'slot-1',
							startsAt: '2026-09-03T15:00:00.000Z',
							endsAt: '2026-09-03T16:00:00.000Z',
							timezone: 'America/Chicago'
						}
					]
				}),
				{ status: 200, headers: { 'content-type': 'application/json' } }
			)
		);
		vi.stubGlobal('fetch', fetchMock);
		const provider = new DesignPartnerSchedulerProvider();
		const slots = await provider.getAvailability({
			providerLocationId: 'loc-1',
			providerServiceId: 'svc-1',
			serviceName: 'AC repair',
			durationMinutes: 60,
			timezone: 'America/Chicago',
			windowStart: new Date('2026-09-03T00:00:00.000Z'),
			windowEnd: new Date('2026-09-10T00:00:00.000Z')
		});
		expect(slots).toHaveLength(1);
		const [url, request] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect(url).toBe('https://scheduler.example.test/v1/availability');
		expect(request.headers).toMatchObject({ authorization: 'Bearer scheduler-secret' });
		expect(request.redirect).toBe('error');
		expect(String(request.body)).not.toContain('scheduler-secret');
	});

	it('accepts an empty successful cancellation response and sends idempotency auth headers', async () => {
		vi.stubEnv('SCHEDULER_API_BASE_URL', 'https://scheduler.example.test/v1');
		vi.stubEnv('SCHEDULER_API_KEY', 'scheduler-secret');
		const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
		vi.stubGlobal('fetch', fetchMock);
		const provider = new DesignPartnerSchedulerProvider();
		await provider.cancel({
			bookingId: 'booking-1',
			reason: 'Customer cancelled',
			idempotencyKey: 'cancel-1'
		});
		const [url, request] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect(url).toBe('https://scheduler.example.test/v1/cancellations');
		expect(request.headers).toMatchObject({
			authorization: 'Bearer scheduler-secret',
			'idempotency-key': 'cancel-1'
		});
		expect(String(request.body)).toContain('booking-1');
		expect(String(request.body)).not.toContain('scheduler-secret');
	});

	it('refuses to select the fake scheduler in production', async () => {
		vi.stubEnv('NODE_ENV', 'production');
		vi.stubEnv('SCHEDULER_PROVIDER', 'fake');
		await expect(getSchedulerProvider()).rejects.toThrow(
			'The fake scheduler cannot be used in production'
		);
	});

	it('does not report a partial or unknown production scheduler configuration as ready', () => {
		vi.stubEnv('NODE_ENV', 'production');
		vi.stubEnv('SCHEDULER_API_BASE_URL', 'https://scheduler.example.test/v1');
		expect(schedulerProviderConfigured()).toBe(false);
		vi.stubEnv('SCHEDULER_API_KEY', 'configured');
		expect(schedulerProviderConfigured()).toBe(true);
		vi.stubEnv('SCHEDULER_PROVIDER', 'unknown');
		expect(schedulerProviderConfigured()).toBe(false);
	});
});
