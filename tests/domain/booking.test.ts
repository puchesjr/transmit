import * as schedulerModule from '$lib/server/providers/scheduler';
import { listMessagesForBookingSession } from '$lib/server/repos/messages';
import { describe, expect, it, vi } from 'vitest';
import { getSql } from '$lib/server/db';
import {
	expireBookingSession,
	confirmBooking,
	processSchedulerCleanup,
	sendHumanBookingReply,
	cancelBooking,
	continueBookingConversation,
	editBookingSettings,
	getAccountBookingSettings,
	getPublicBookingState,
	holdBookingSlot,
	parseBookingStart,
	requestBookingHandoff,
	startBookingSession,
	takeOverBookingSession
} from '$lib/server/domain/booking';
import { getConversationThread, provisionNumber, submitMessagingRegistration } from '$lib/server/domain/messaging';
import { FakeAiProvider } from '$lib/server/providers/fake-ai';
import { FakeSchedulerProvider } from '$lib/server/providers/fake-scheduler';
import {
	getAppointmentForSession,
	getBookingService,
	getBookingSession,
	getBookingSettings
} from '$lib/server/repos/booking';
import { getContact, updateContactConsent } from '$lib/server/repos/contacts';
import { updateLocationQuietHours } from '$lib/server/repos/locations';
import { listActivitiesForContact } from '$lib/server/repos/activities';
import { FakeMessagingProvider } from '$lib/server/providers/fake';
import { activateTestBilling, authContext, createWorkspace, registrationInput } from '../helpers';

let numberSequence = 8100;

async function setupBooking(prefix: string) {
	const sql = getSql();
	const workspace = await createWorkspace(prefix);
	const ctx = authContext(workspace);
	await activateTestBilling(workspace);
	const messaging = new FakeMessagingProvider();
	await submitMessagingRegistration(
		sql,
		messaging,
		ctx,
		registrationInput({
			legalName: 'Bookable Home Services LLC',
			website: 'https://example.test',
			contactEmail: 'owner@example.test',
			useCase: 'Appointment confirmations and customer service',
			sampleMessage: 'Your appointment is confirmed. Reply STOP to opt out.'
		})
	);
	numberSequence += 1;
	await provisionNumber(sql, messaging, ctx, `+1512555${numberSequence}`);
	const { drainOutbox } = await import('$lib/server/outbox');
	const { outboxHandlers } = await import('$lib/server/worker');
	const { FakeVoiceProvider } = await import('$lib/server/providers/fake');
	const { FakeBillingProvider } = await import('$lib/server/providers/fake-billing');
	const { FakeOutboundWebhookProvider } = await import('$lib/server/providers/fake-outbound-webhook');
	await drainOutbox(
		sql,
		{
			messaging,
			voice: new FakeVoiceProvider(),
			billing: new FakeBillingProvider(),
			ai: new FakeAiProvider(),
			webhook: new FakeOutboundWebhookProvider()
		},
		outboxHandlers
	);
	let settings = await getAccountBookingSettings(sql, ctx);
	await editBookingSettings(sql, ctx, {
		...settings.settings,
		enabled: true,
		providerLocationId: null
	});
	settings = await getAccountBookingSettings(sql, ctx);
	const publicKey = settings.appointmentPublicKey!;
	const service = settings.services[0];
	const input = parseBookingStart({
		firstName: 'Morgan',
		lastName: 'Lee',
		phone: `+1512${String(1_000_000 + numberSequence).slice(-7)}`,
		email: `morgan.${numberSequence}@example.test`,
		serviceId: service.id,
		consent: true,
		submissionKey: `booking-submission-${numberSequence}`,
		sessionToken: `bookingtoken${String(numberSequence).padStart(52, '0')}`,
		sourcePage: 'https://partner.example.test/ac',
		campaign: { source: 'google', campaign: 'summer-service' }
	});
	const started = await startBookingSession(sql, publicKey, input, {
		ip: `203.0.113.${numberSequence % 200}`,
		userAgent: 'vitest'
	});
	if (!started.state) throw new Error('booking did not start');
	return { sql, workspace, ctx, publicKey, input, started: started.state, service };
}

describe('conversational booking', () => {
	it('qualifies a lead, holds only a real slot, books once, and queues a quiet-hour-safe confirmation', async () => {
		const setup = await setupBooking('booking-happy');
		const ai = new FakeAiProvider();
		const scheduler = new FakeSchedulerProvider();

		const duplicate = await startBookingSession(setup.sql, setup.publicKey, setup.input, {
			ip: '203.0.113.25',
			userAgent: 'vitest-retry'
		});
		expect(duplicate.duplicate).toBe(true);
		expect(duplicate.state?.session.id).toBe(setup.started.session.id);

		const offered = await continueBookingConversation(
			setup.sql,
			ai,
			scheduler,
			setup.publicKey,
			setup.input.sessionToken,
			'The AC stopped cooling at 123 Main Street, Austin TX 78701.'
		);
		expect(offered.session.status).toBe('offering');
		expect(offered.session.qualification).toMatchObject({
			serviceAddress: expect.stringContaining('123 Main Street'),
			urgency: 'medium'
		});
		expect(offered.availableSlots.length).toBeGreaterThan(0);

		const offeredSlot = offered.availableSlots[0];
		const held = await holdBookingSlot(
			setup.sql,
			scheduler,
			setup.publicKey,
			setup.input.sessionToken,
			offeredSlot.id
		);
		expect(held.session.status).toBe('held');
		expect(held.session.heldSlot?.startsAt).toBe(offeredSlot.startsAt);

		await updateLocationQuietHours(setup.sql, setup.ctx.accountId, setup.ctx.locationId, {
			timezone: 'UTC',
			quietStart: '00:00',
			quietEnd: '23:59'
		});
		const booked = await confirmBooking(
			setup.sql,
			scheduler,
			setup.publicKey,
			setup.input.sessionToken
		);
		expect(booked.session.status).toBe('booked');
		expect(booked.appointment).toMatchObject({
			startsAt: offeredSlot.startsAt,
			status: 'booked'
		});
		expect(scheduler.bookings.size).toBe(1);

		const retry = await confirmBooking(
			setup.sql,
			scheduler,
			setup.publicKey,
			setup.input.sessionToken
		);
		expect(retry.appointment?.id).toBe(booked.appointment?.id);
		expect(scheduler.bookings.size).toBe(1);

		const thread = await getConversationThread(
			setup.sql,
			setup.ctx,
			booked.session.conversationId
		);
		const confirmation = thread.messages.find((message) => message.channel === 'sms');
		expect(confirmation).toMatchObject({ status: 'queued' });
		expect(confirmation?.notBefore).not.toBeNull();
		expect(confirmation?.body).toContain('STOP');
		const contact = await getContact(setup.sql, setup.ctx.accountId, booked.session.contactId);
		expect(contact?.messagingConsent).toBe('opted_in');
		const activities = await listActivitiesForContact(
			setup.sql,
			setup.ctx.accountId,
			booked.session.contactId
		);
		expect(activities.map((activity) => activity.type)).toEqual(
			expect.arrayContaining([
				'booking.started',
				'ai.concierge_turn',
				'booking.slot_held',
				'appointment.booked'
			])
		);
	});

	it('routes unsupported requests to a human and records explicit takeover', async () => {
		const setup = await setupBooking('booking-handoff');
		const state = await continueBookingConversation(
			setup.sql,
			new FakeAiProvider(),
			new FakeSchedulerProvider(),
			setup.publicKey,
			setup.input.sessionToken,
			'I need help disputing an invoice and want a person.'
		);
		expect(state.session).toMatchObject({
			status: 'handoff',
			handoffReason: 'The visitor asked for a person'
		});
		const activities = await listActivitiesForContact(
			setup.sql,
			setup.ctx.accountId,
			state.session.contactId
		);
		expect(activities).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					type: 'ai.concierge_turn',
					payload: expect.objectContaining({ action: 'handoff' })
				})
			])
		);
		const taken = await takeOverBookingSession(
			setup.sql,
			setup.ctx,
			state.session.id
		);
		expect(taken.takenOverBy).toBe(setup.ctx.userId);
	});

	it('audits AI failures before routing the conversation to a human', async () => {
		const setup = await setupBooking('booking-ai-failure');
		const ai = new FakeAiProvider();
		ai.continueConcierge = async () => {
			throw new Error('AI provider unavailable');
		};
		const state = await continueBookingConversation(
			setup.sql,
			ai,
			new FakeSchedulerProvider(),
			setup.publicKey,
			setup.input.sessionToken,
			'The AC is broken at 42 Elm Street, Austin TX.'
		);
		expect(state.session.status).toBe('handoff');
		const activities = await listActivitiesForContact(
			setup.sql,
			setup.ctx.accountId,
			state.session.contactId
		);
		expect(activities).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					type: 'ai.concierge_failed',
					payload: expect.objectContaining({
						action: 'failed',
						provider: 'fake'
					})
				})
			])
		);
	});

	it('cancels substituted scheduler slots and routes uncertainty to a human', async () => {
		const holdSetup = await setupBooking('booking-slot-hold-substitution');
		const holdScheduler = new FakeSchedulerProvider();
		const offered = await continueBookingConversation(
			holdSetup.sql,
			new FakeAiProvider(),
			holdScheduler,
			holdSetup.publicKey,
			holdSetup.input.sessionToken,
			'The AC is leaking at 12 Garden Lane, Austin TX.'
		);
		const realHold = holdScheduler.hold.bind(holdScheduler);
		holdScheduler.hold = async (input) => {
			const result = await realHold(input);
			return { ...result, slot: { ...result.slot, id: 'substituted-hold-slot' } };
		};
		const unsafeHold = await holdBookingSlot(
			holdSetup.sql,
			holdScheduler,
			holdSetup.publicKey,
			holdSetup.input.sessionToken,
			offered.availableSlots[0].id
		);
		expect(unsafeHold.session.status).toBe('handoff');
		expect(holdScheduler.cancelled.size).toBe(1);

		const bookSetup = await setupBooking('booking-slot-book-substitution');
		const bookScheduler = new FakeSchedulerProvider();
		const bookOffered = await continueBookingConversation(
			bookSetup.sql,
			new FakeAiProvider(),
			bookScheduler,
			bookSetup.publicKey,
			bookSetup.input.sessionToken,
			'The furnace is noisy at 88 Hill Street, Austin TX.'
		);
		await holdBookingSlot(
			bookSetup.sql,
			bookScheduler,
			bookSetup.publicKey,
			bookSetup.input.sessionToken,
			bookOffered.availableSlots[0].id
		);
		const realBook = bookScheduler.book.bind(bookScheduler);
		bookScheduler.book = async (input) => {
			const result = await realBook(input);
			return {
				...result,
				slot: { ...result.slot, startsAt: new Date(Date.parse(result.slot.startsAt) + 3_600_000).toISOString() }
			};
		};
		const unsafeBooking = await confirmBooking(
			bookSetup.sql,
			bookScheduler,
			bookSetup.publicKey,
			bookSetup.input.sessionToken
		);
		expect(unsafeBooking.session.status).toBe('handoff');
		expect(bookScheduler.cancelled.size).toBe(1);
		expect(
			await getAppointmentForSession(
				bookSetup.sql,
				bookSetup.ctx.accountId,
				bookSetup.started.session.id
			)
		).toBeNull();
	});

	it('routes scheduler hold and booking failures to a human without creating an appointment', async () => {
		const holdSetup = await setupBooking('booking-hold-failure');
		const holdScheduler = new FakeSchedulerProvider();
		const offered = await continueBookingConversation(
			holdSetup.sql,
			new FakeAiProvider(),
			holdScheduler,
			holdSetup.publicKey,
			holdSetup.input.sessionToken,
			'The AC is broken at 40 Walnut Street, Austin TX.'
		);
		holdScheduler.hold = async () => {
			throw new Error('Scheduler hold timeout');
		};
		const holdState = await holdBookingSlot(
			holdSetup.sql,
			holdScheduler,
			holdSetup.publicKey,
			holdSetup.input.sessionToken,
			offered.availableSlots[0].id
		);
		expect(holdState.session).toMatchObject({
			status: 'handoff',
			handoffReason: 'The scheduler could not verify the selected hold'
		});

		const bookSetup = await setupBooking('booking-confirm-failure');
		const bookScheduler = new FakeSchedulerProvider();
		const bookOffered = await continueBookingConversation(
			bookSetup.sql,
			new FakeAiProvider(),
			bookScheduler,
			bookSetup.publicKey,
			bookSetup.input.sessionToken,
			'The furnace is broken at 80 Walnut Street, Austin TX.'
		);
		await holdBookingSlot(
			bookSetup.sql,
			bookScheduler,
			bookSetup.publicKey,
			bookSetup.input.sessionToken,
			bookOffered.availableSlots[0].id
		);
		bookScheduler.book = async () => {
			throw new Error('Scheduler booking timeout');
		};
		const bookState = await confirmBooking(
			bookSetup.sql,
			bookScheduler,
			bookSetup.publicKey,
			bookSetup.input.sessionToken
		);
		expect(bookState.session).toMatchObject({
			status: 'handoff',
			handoffReason: 'The scheduler could not verify the final booking'
		});
		expect(
			await getAppointmentForSession(
				bookSetup.sql,
				bookSetup.ctx.accountId,
				bookSetup.started.session.id
			)
		).toBeNull();
	});

	it('collapses concurrent confirmations into one appointment and one SMS', async () => {
		const setup = await setupBooking('booking-confirm-race');
		const scheduler = new FakeSchedulerProvider();
		const offered = await continueBookingConversation(
			setup.sql,
			new FakeAiProvider(),
			scheduler,
			setup.publicKey,
			setup.input.sessionToken,
			'The AC is not cooling at 55 Cedar Avenue, Austin TX.'
		);
		await holdBookingSlot(
			setup.sql,
			scheduler,
			setup.publicKey,
			setup.input.sessionToken,
			offered.availableSlots[0].id
		);
		const [first, second] = await Promise.all([
			confirmBooking(setup.sql, scheduler, setup.publicKey, setup.input.sessionToken),
			confirmBooking(setup.sql, scheduler, setup.publicKey, setup.input.sessionToken)
		]);
		expect(second.appointment?.id).toBe(first.appointment?.id);
		expect(scheduler.bookings.size).toBe(1);
		const thread = await getConversationThread(
			setup.sql,
			setup.ctx,
			first.session.conversationId
		);
		expect(thread.messages.filter((message) => message.channel === 'sms')).toHaveLength(1);
	});

	it('expires unfinished sessions into a human follow-up path', async () => {
		const setup = await setupBooking('booking-timeout');
		await setup.sql`
			update booking_sessions
			set expires_at = now() - interval '1 minute'
			where account_id = ${setup.ctx.accountId} and id = ${setup.started.session.id}
		`;
		const state = await getPublicBookingState(
			setup.sql,
			setup.publicKey,
			setup.input.sessionToken
		);
		expect(state.session.status).toBe('expired');
		expect(state.session.handoffReason).toContain('timed out');
	});

	it('releases a held scheduler slot when the website session times out', async () => {
		const setup = await setupBooking('booking-expire-hold');
		const scheduler = new FakeSchedulerProvider();
		const offered = await continueBookingConversation(
			setup.sql,
			new FakeAiProvider(),
			scheduler,
			setup.publicKey,
			setup.input.sessionToken,
			'The AC is broken at 88 Pine Street, Austin TX.'
		);
		await holdBookingSlot(
			setup.sql,
			scheduler,
			setup.publicKey,
			setup.input.sessionToken,
			offered.availableSlots[0].id
		);
		await setup.sql`
			update booking_sessions
			set expires_at = now() - interval '1 minute'
			where account_id = ${setup.ctx.accountId} and id = ${setup.started.session.id}
		`;
		await getPublicBookingState(setup.sql, setup.publicKey, setup.input.sessionToken);
		const jobs = await setup.sql<{ payload: Record<string, unknown> }[]>`
			select payload from outbox
			where account_id = ${setup.ctx.accountId} and kind = 'booking.scheduler.cleanup'
		`;
		expect(jobs).toHaveLength(1);
		expect(jobs[0].payload.input).toMatchObject({
			holdId: expect.any(String),
			idempotencyKey: `expire-hold:${setup.started.session.id}`
		});
	});

	it('books the appointment but never sends a confirmation after an opt-out', async () => {
		const setup = await setupBooking('booking-optout');
		const ai = new FakeAiProvider();
		const scheduler = new FakeSchedulerProvider();
		const offered = await continueBookingConversation(
			setup.sql,
			ai,
			scheduler,
			setup.publicKey,
			setup.input.sessionToken,
			'The furnace is not heating at 44 Oak Road, Austin TX.'
		);
		const held = await holdBookingSlot(
			setup.sql,
			scheduler,
			setup.publicKey,
			setup.input.sessionToken,
			offered.availableSlots[0].id
		);
		await updateContactConsent(
			setup.sql,
			setup.ctx.accountId,
			held.session.contactId,
			'opted_out'
		);
		const booked = await confirmBooking(
			setup.sql,
			scheduler,
			setup.publicKey,
			setup.input.sessionToken
		);
		expect(booked.session.status).toBe('booked');
		const thread = await getConversationThread(
			setup.sql,
			setup.ctx,
			booked.session.conversationId
		);
		expect(thread.messages.some((message) => message.channel === 'sms')).toBe(false);
		expect(await getAppointmentForSession(setup.sql, setup.ctx.accountId, booked.session.id)).not.toBeNull();
	});

	it('supports an explicit handoff before qualification', async () => {
		const setup = await setupBooking('booking-explicit-handoff');
		const state = await requestBookingHandoff(
			setup.sql,
			setup.publicKey,
			setup.input.sessionToken
		);
		expect(state.session.status).toBe('handoff');
		expect((await getBookingSession(setup.sql, setup.ctx.accountId, state.session.id))?.status).toBe(
			'handoff'
		);
	});

	it('cancels a provider-backed appointment idempotently', async () => {
		const setup = await setupBooking('booking-cancel');
		const scheduler = new FakeSchedulerProvider();
		const offered = await continueBookingConversation(
			setup.sql,
			new FakeAiProvider(),
			scheduler,
			setup.publicKey,
			setup.input.sessionToken,
			'The heater needs service at 77 River Road, Austin TX.'
		);
		await holdBookingSlot(
			setup.sql,
			scheduler,
			setup.publicKey,
			setup.input.sessionToken,
			offered.availableSlots[0].id
		);
		await confirmBooking(
			setup.sql,
			scheduler,
			setup.publicKey,
			setup.input.sessionToken
		);
		const cancelled = await cancelBooking(
			setup.sql,
			scheduler,
			setup.publicKey,
			setup.input.sessionToken,
			'Customer schedule changed'
		);
		expect(cancelled.session.status).toBe('cancelled');
		expect(cancelled.appointment).toMatchObject({
			status: 'cancelled',
			cancellationReason: 'Customer schedule changed'
		});
		expect(scheduler.cancelled.size).toBe(1);
	});

	it('keeps settings, services, sessions, and appointments isolated by account_id', async () => {
		const setup = await setupBooking('booking-tenant-a');
		const stranger = await createWorkspace('booking-tenant-b');
		const scheduler = new FakeSchedulerProvider();
		const offered = await continueBookingConversation(
			setup.sql,
			new FakeAiProvider(),
			scheduler,
			setup.publicKey,
			setup.input.sessionToken,
			'The unit is not cooling at 901 Pine Avenue, Austin TX.'
		);
		await holdBookingSlot(
			setup.sql,
			scheduler,
			setup.publicKey,
			setup.input.sessionToken,
			offered.availableSlots[0].id
		);
		const booked = await confirmBooking(
			setup.sql,
			scheduler,
			setup.publicKey,
			setup.input.sessionToken
		);
		expect(
			await getBookingSettings(setup.sql, stranger.account.id, setup.ctx.locationId)
		).toBeNull();
		expect(
			await getBookingService(
				setup.sql,
				stranger.account.id,
				setup.ctx.locationId,
				setup.service.id
			)
		).toBeNull();
		expect(
			await getBookingSession(setup.sql, stranger.account.id, booked.session.id)
		).toBeNull();
		expect(
			await getAppointmentForSession(setup.sql, stranger.account.id, booked.session.id)
		).toBeNull();
	});

	it('scopes provider booking identifiers to each account', async () => {
		const firstSetup = await setupBooking('booking-provider-key-a');
		const secondSetup = await setupBooking('booking-provider-key-b');

		for (const setup of [firstSetup, secondSetup]) {
			const scheduler = new FakeSchedulerProvider();
			const offered = await continueBookingConversation(
				setup.sql,
				new FakeAiProvider(),
				scheduler,
				setup.publicKey,
				setup.input.sessionToken,
				'The AC needs service at 500 Market Street, Austin TX.'
			);
			await holdBookingSlot(
				setup.sql,
				scheduler,
				setup.publicKey,
				setup.input.sessionToken,
				offered.availableSlots[0].id
			);
			const realBook = scheduler.book.bind(scheduler);
			scheduler.book = async (input) => ({
				...(await realBook(input)),
				bookingId: 'provider-local-booking-1'
			});
			const state = await confirmBooking(
				setup.sql,
				scheduler,
				setup.publicKey,
				setup.input.sessionToken
			);
			expect(state.appointment?.status).toBe('booked');
		}
	});
});


describe('booking security regressions', () => {
	it('isolates simultaneous public sessions and AI context from other chats and SMS', async () => {
		const setup = await setupBooking('booking-private');
		await requestBookingHandoff(setup.sql, setup.publicKey, setup.input.sessionToken);
		await takeOverBookingSession(setup.sql, setup.ctx, setup.started.session.id);
		await sendHumanBookingReply(setup.sql, setup.ctx, setup.started.session.id, 'Private access code 918273');
		const input = { ...setup.input, firstName: 'Visitor', submissionKey: 'another-private-submission', sessionToken: 'another-private-token-1234567890' };
		const second = await startBookingSession(setup.sql, setup.publicKey, input, { ip: null, userAgent: null });
		expect(second.state?.session.conversationId).toBe(setup.started.session.conversationId);
		expect(second.state?.messages).toHaveLength(1);
		expect(second.state?.messages[0].body).toContain('Hi Visitor');
		expect(JSON.stringify(second.state)).not.toContain('918273');
		const ai = new FakeAiProvider();
		const turn = vi.spyOn(ai, 'continueConcierge');
		await continueBookingConversation(setup.sql, ai, new FakeSchedulerProvider(), setup.publicKey, input.sessionToken, 'The AC is broken at 123 Main Street, Austin TX.');
		expect(JSON.stringify(turn.mock.calls)).not.toContain('918273');
		const first = await getPublicBookingState(setup.sql, setup.publicKey, setup.input.sessionToken);
		expect(JSON.stringify(first.messages)).not.toContain('123 Main Street');
		expect(await listMessagesForBookingSession(setup.sql, (await createWorkspace('other-tenant')).account.id, setup.started.session.id)).toEqual([]);
	});

	it('does not use email to assume ownership of another phone or reset a prior STOP', async () => {
		const setup = await setupBooking('booking-identity');
		await updateContactConsent(setup.sql, setup.ctx.accountId, setup.started.session.contactId, 'opted_out');
		const repeat = { ...setup.input, submissionKey: 'repeat-consent-submission', sessionToken: 'repeat-consent-token-123456789' };
		await startBookingSession(setup.sql, setup.publicKey, repeat, { ip: null, userAgent: null });
		expect((await getContact(setup.sql, setup.ctx.accountId, setup.started.session.contactId))?.messagingConsent).toBe('opted_out');
		const different = await startBookingSession(setup.sql, setup.publicKey, { ...repeat, phone: '+15125550123', submissionKey: 'different-phone-submission', sessionToken: 'different-phone-token-123456789' }, { ip: null, userAgent: null });
		expect(different.state?.session.contactId).not.toBe(setup.started.session.contactId);
	});

	it('accepts equivalent timezone-offset timestamps after Postgres persists the hold', async () => {
		const setup = await setupBooking('booking-offset');
		const scheduler = new FakeSchedulerProvider();
		const availability = scheduler.getAvailability.bind(scheduler);
		scheduler.getAvailability = async (input) => (await availability(input)).map(slot => ({ ...slot, startsAt: slot.startsAt.replace('Z', '+00:00'), endsAt: slot.endsAt.replace('Z', '+00:00') }));
		const offered = await continueBookingConversation(setup.sql, new FakeAiProvider(), scheduler, setup.publicKey, setup.input.sessionToken, 'The AC is broken at 123 Main Street, Austin TX.');
		await holdBookingSlot(setup.sql, scheduler, setup.publicKey, setup.input.sessionToken, offered.availableSlots[0].id);
		const booked = await confirmBooking(setup.sql, scheduler, setup.publicKey, setup.input.sessionToken);
		expect(booked.session.status).toBe('booked');
		expect(booked.messages.every(message => message.channel === 'web')).toBe(true);
	});

	it('does not offer slots with invalid timezones or the wrong service duration', async () => {
		const setup = await setupBooking('booking-invalid-zone');
		const scheduler = new FakeSchedulerProvider();
		const availability = scheduler.getAvailability.bind(scheduler);
		scheduler.getAvailability = async (input) => (await availability(input)).map((slot, index) => index % 2 ? { ...slot, timezone: 'Invalid/Zone' } : { ...slot, endsAt: new Date(Date.parse(slot.startsAt) + 60_000).toISOString() });
		const state = await continueBookingConversation(setup.sql, new FakeAiProvider(), scheduler, setup.publicKey, setup.input.sessionToken, 'The AC is broken at 123 Main Street, Austin TX.');
		expect(state.session.status).toBe('handoff');
		expect(state.availableSlots).toEqual([]);
	});

	it('persists cleanup before attempting it and retries provider failures with the same key', async () => {
		const setup = await setupBooking('booking-cleanup-retry');
		const scheduler = new FakeSchedulerProvider();
		const offered = await continueBookingConversation(setup.sql, new FakeAiProvider(), scheduler, setup.publicKey, setup.input.sessionToken, 'The AC is broken at 123 Main Street, Austin TX.');
		const hold = scheduler.hold.bind(scheduler);
		scheduler.hold = async input => { const result = await hold(input); return { ...result, slot: { ...result.slot, id: 'wrong-slot' } }; };
		const cancel = vi.spyOn(scheduler, 'cancel').mockRejectedValueOnce(new Error('temporary scheduler outage'));
		const state = await holdBookingSlot(setup.sql, scheduler, setup.publicKey, setup.input.sessionToken, offered.availableSlots[0].id);
		expect(state.session.status).toBe('handoff');
		const jobs = await setup.sql<{payload: Record<string, unknown>}[]>`select payload from outbox where account_id = ${setup.ctx.accountId} and kind = 'booking.scheduler.cleanup'`;
		expect(jobs).toHaveLength(1);
		await processSchedulerCleanup(setup.sql, scheduler, jobs[0].payload);
		expect(cancel.mock.calls[1][0]).toEqual(cancel.mock.calls[0][0]);
		expect(scheduler.cancelled.size).toBe(1);
	});

	it('enforces the start limit even when requests arrive together', async () => {
		const setup = await setupBooking('booking-parallel-rate');
		const results = await Promise.allSettled(Array.from({ length: 8 }, (_, index) => startBookingSession(setup.sql, setup.publicKey, { ...setup.input, submissionKey: `parallel-submission-${index}`, sessionToken: `parallel-token-1234567890-${index}` }, { ip: '203.0.113.250', userAgent: null })));
		expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(5);
		expect(results.filter(result => result.status === 'rejected')).toHaveLength(3);
	});
});


describe('booking operational boundaries', () => {
	it('honors a booking pause after a slot has already been held', async () => {
		const setup = await setupBooking('booking-paused');
		const scheduler = new FakeSchedulerProvider();
		const offered = await continueBookingConversation(setup.sql, new FakeAiProvider(), scheduler, setup.publicKey, setup.input.sessionToken, 'The AC is broken at 123 Main Street, Austin TX.');
		await holdBookingSlot(setup.sql, scheduler, setup.publicKey, setup.input.sessionToken, offered.availableSlots[0].id);
		const settings = await getAccountBookingSettings(setup.sql, setup.ctx);
		await editBookingSettings(setup.sql, setup.ctx, { ...settings.settings, enabled: false });
		const state = await confirmBooking(setup.sql, scheduler, setup.publicKey, setup.input.sessionToken);
		expect(state.session.status).toBe('handoff');
		expect(scheduler.bookings.size).toBe(0);
	});

	it('retries customer cancellation through the outbox after a provider outage', async () => {
		const setup = await setupBooking('booking-cancel-retry');
		const scheduler = new FakeSchedulerProvider();
		const offered = await continueBookingConversation(setup.sql, new FakeAiProvider(), scheduler, setup.publicKey, setup.input.sessionToken, 'The AC is broken at 123 Main Street, Austin TX.');
		await holdBookingSlot(setup.sql, scheduler, setup.publicKey, setup.input.sessionToken, offered.availableSlots[0].id);
		await confirmBooking(setup.sql, scheduler, setup.publicKey, setup.input.sessionToken);
		const cancel = vi.spyOn(scheduler, 'cancel').mockRejectedValueOnce(new Error('temporary outage'));
		await expect(cancelBooking(setup.sql, scheduler, setup.publicKey, setup.input.sessionToken, 'Plans changed')).rejects.toThrow('temporary outage');
		const jobs = await setup.sql<{payload: Record<string, unknown>}[]>`select payload from outbox where account_id = ${setup.ctx.accountId} and kind = 'booking.scheduler.cleanup'`;
		expect(jobs).toHaveLength(1);
		await processSchedulerCleanup(setup.sql, scheduler, jobs[0].payload);
		const state = await getPublicBookingState(setup.sql, setup.publicKey, setup.input.sessionToken);
		expect(state.session.status).toBe('cancelled');
		expect(state.appointment?.status).toBe('cancelled');
		expect(cancel.mock.calls[1][0]).toEqual(cancel.mock.calls[0][0]);
	});
	it('rolls back timeout when cleanup cannot be queued, then retries once', async () => {
		const setup = await setupBooking('expire-rollback');
		const scheduler = new FakeSchedulerProvider();
		const offered = await continueBookingConversation(setup.sql, new FakeAiProvider(), scheduler, setup.publicKey, setup.input.sessionToken, 'The AC is broken at 123 Main Street, Austin TX.');
		await holdBookingSlot(setup.sql, scheduler, setup.publicKey, setup.input.sessionToken, offered.availableSlots[0].id);
		const sessionId = setup.started.session.id;
		await setup.sql`update booking_sessions set expires_at = now() - interval '1 minute' where account_id = ${setup.ctx.accountId} and id = ${sessionId}`;
		const provider = vi.spyOn(schedulerModule, 'getSchedulerProvider').mockRejectedValueOnce(new Error('configuration unavailable'));
		try {
			await expect(expireBookingSession(setup.sql, { accountId: setup.ctx.accountId, sessionId })).rejects.toThrow('configuration unavailable');
			const rows = await setup.sql`select status from booking_sessions where account_id = ${setup.ctx.accountId} and id = ${sessionId}`;
			expect(rows[0].status).toBe('held');
			provider.mockResolvedValue(scheduler);
			await expireBookingSession(setup.sql, { accountId: setup.ctx.accountId, sessionId });
			await expireBookingSession(setup.sql, { accountId: setup.ctx.accountId, sessionId });
			const jobs = await setup.sql`select id from outbox where account_id = ${setup.ctx.accountId} and kind = 'booking.scheduler.cleanup'`;
			expect(jobs).toHaveLength(1);
		} finally { provider.mockRestore(); }
	});

});
