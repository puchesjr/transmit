import { describe, expect, it } from 'vitest';
import { getSql } from '$lib/server/db';
import {
	getLeadCaptureSettings,
	parseLeadCaptureSubmission,
	submitLeadCapture
} from '$lib/server/domain/lead-capture';
import {
	createWebhookEndpoint,
	getWebhookSettings,
	parseCreateWebhookEndpoint,
	queueOutboundWebhookEvent,
	verifyWebhookSignature
} from '$lib/server/domain/outbound-webhooks';
import { importContactsCsv, parseContactImport } from '$lib/server/domain/contact-import';
import {
	getConversationThread,
	provisionNumber,
	submitMessagingRegistration
} from '$lib/server/domain/messaging';
import { listAccountOpportunities, moveOpportunityStage } from '$lib/server/domain/opportunities';
import { handleTelnyxWebhook } from '$lib/server/domain/webhooks';
import { AppError } from '$lib/server/errors';
import { drainOutbox } from '$lib/server/outbox';
import { FakeAiProvider } from '$lib/server/providers/fake-ai';
import { FakeBillingProvider } from '$lib/server/providers/fake-billing';
import { FakeOutboundWebhookProvider } from '$lib/server/providers/fake-outbound-webhook';
import {
	FAKE_WEBHOOK_SIGNATURE,
	FakeMessagingProvider,
	FakeVoiceProvider
} from '$lib/server/providers/fake';
import { getContact, listContacts } from '$lib/server/repos/contacts';
import { getDefaultPipeline } from '$lib/server/repos/pipelines';
import { outboxHandlers } from '$lib/server/worker';
import { activateTestBilling, authContext, createWorkspace, registrationInput } from '../helpers';

let numberSequence = 7200;

async function setupCapture(prefix: string) {
	const sql = getSql();
	const workspace = await createWorkspace(prefix);
	const ctx = authContext(workspace);
	const messaging = new FakeMessagingProvider();
	const billing = await activateTestBilling(workspace);
	await submitMessagingRegistration(
		sql,
		messaging,
		ctx,
		registrationInput({
			legalName: 'Fast Home Services LLC',
			website: 'https://example.test',
			contactEmail: 'owner@example.test',
			useCase: 'Reply to website service requests',
			sampleMessage: 'Thanks for reaching out. Reply STOP to opt out.'
		})
	);
	numberSequence += 1;
	const number = await provisionNumber(sql, messaging, ctx, `+1512555${numberSequence}`);
	const settings = await getLeadCaptureSettings(sql, ctx);
	return { sql, workspace, ctx, messaging, billing, number, settings };
}

describe('instant lead capture', () => {
	it('creates the customer, lead, conversation, consent evidence, and signed webhook once', async () => {
		const setup = await setupCapture('lead-capture');
		expect(setup.settings.ready).toBe(true);
		expect(setup.settings.forms.map((form) => form.kind)).toEqual([
			'service',
			'quote',
			'appointment',
			'question'
		]);
		const questionForm = setup.settings.forms.find((form) => form.kind === 'question')!;
		const endpoint = await createWebhookEndpoint(
			setup.sql,
			setup.ctx,
			parseCreateWebhookEndpoint({
				url: 'https://hooks.example.test/kiso',
				events: ['contact.created', 'message.received', 'opportunity.stage_changed']
			})
		);
		const input = parseLeadCaptureSubmission({
			firstName: 'Morgan',
			lastName: 'Lee',
			phone: '(512) 555-0188',
			email: 'morgan@example.test',
			message: 'Our water heater is leaking.',
			consent: true,
			submissionKey: 'submission-test-0001',
			sourcePage: 'https://customer.example/services/water-heaters',
			referrer: 'https://google.com/',
			campaign: { source: 'google', campaign: 'emergency-plumbing' }
		});

		const first = await submitLeadCapture(setup.sql, questionForm.publicKey, input, {
			ip: '203.0.113.10',
			userAgent: 'vitest'
		});
		const duplicate = await submitLeadCapture(setup.sql, questionForm.publicKey, input, {
			ip: '203.0.113.10',
			userAgent: 'vitest'
		});
		expect(first.duplicate).toBe(false);
		expect(duplicate.duplicate).toBe(true);
		expect(duplicate.capture?.id).toBe(first.capture?.id);
		expect(first.capture).toMatchObject({
			sourcePage: 'https://customer.example/services/water-heaters',
			referrer: 'https://google.com/',
			campaign: { source: 'google', campaign: 'emergency-plumbing' },
			message: 'Our water heater is leaking.',
			consentText: questionForm.consentText
		});
		expect(Number.isFinite(Date.parse(first.capture!.consentedAt))).toBe(true);

		const contact = await getContact(setup.sql, setup.ctx.accountId, first.capture!.contactId);
		expect(contact).toMatchObject({
			locationId: setup.ctx.locationId,
			phone: '+15125550188',
			messagingConsent: 'opted_in'
		});
		const thread = await getConversationThread(
			setup.sql,
			setup.ctx,
			first.capture!.conversationId
		);
		expect(thread.messages).toHaveLength(1);
		expect(thread.messages[0].body).toContain('Morgan');
		expect(thread.messages[0].body).toContain('STOP');
		const opportunities = await listAccountOpportunities(setup.sql, setup.ctx);
		expect(opportunities.opportunities).toHaveLength(1);
		expect(opportunities.opportunities[0]).toMatchObject({
			locationId: setup.ctx.locationId,
			contactId: contact?.id,
			stageName: 'Lead'
		});

		const webhook = new FakeOutboundWebhookProvider();
		await drainOutbox(
			setup.sql,
			{
				messaging: setup.messaging,
				voice: new FakeVoiceProvider(),
				billing: setup.billing,
				ai: new FakeAiProvider(),
				webhook
			},
			outboxHandlers
		);
		expect(setup.messaging.sent).toHaveLength(1);
		expect(webhook.deliveries).toHaveLength(1);
		const delivered = webhook.deliveries[0];
		expect(delivered.headers['x-kiso-event']).toBe('contact.created');
		expect(
			verifyWebhookSignature(
				delivered.body,
				delivered.headers['x-kiso-timestamp'],
				endpoint.signingSecret,
				delivered.headers['x-kiso-signature']
			)
		).toBe(true);
		const webhookSettings = await getWebhookSettings(setup.sql, setup.ctx);
		expect(webhookSettings.deliveries[0]).toMatchObject({ status: 'delivered', attempts: 1 });
	});

	it('requires explicit consent and kind-specific fields', async () => {
		const setup = await setupCapture('lead-validation');
		expect(() =>
			parseLeadCaptureSubmission({
				firstName: 'Taylor',
				phone: '+15125550199',
				message: 'Please call me',
				consent: false,
				submissionKey: 'submission-test-0002'
			})
		).toThrowError(AppError);
		const appointment = setup.settings.forms.find((form) => form.kind === 'appointment')!;
		const parsed = parseLeadCaptureSubmission({
			firstName: 'Taylor',
			phone: '+15125550199',
			requestedService: 'Furnace tune-up',
			consent: true,
			submissionKey: 'submission-test-0003'
		});
		await expect(
			submitLeadCapture(setup.sql, appointment.publicKey, parsed, {
				ip: null,
				userAgent: null
			})
		).rejects.toMatchObject({ code: 'validation', message: 'preferredTime is required' });
	});

	it('emits contact, inbound-message, and stage-change webhook events from their real domain paths', async () => {
		const setup = await setupCapture('lead-webhook-events');
		await createWebhookEndpoint(
			setup.sql,
			setup.ctx,
			parseCreateWebhookEndpoint({
				url: 'https://events.example.test/kiso',
				events: ['contact.created', 'message.received', 'opportunity.stage_changed']
			})
		);
		const form = setup.settings.forms.find((item) => item.kind === 'question')!;
		const captured = await submitLeadCapture(
			setup.sql,
			form.publicKey,
			parseLeadCaptureSubmission({
				firstName: 'Event',
				lastName: 'Customer',
				phone: '+15125550177',
				message: 'Please text me about service.',
				consent: true,
				submissionKey: 'event-coverage-0001'
			}),
			{ ip: '203.0.113.21', userAgent: 'vitest' }
		);
		const pipeline = await getDefaultPipeline(setup.sql, setup.ctx.accountId);
		if (!pipeline?.stages[1] || !captured.capture) throw new Error('test pipeline is incomplete');
		await moveOpportunityStage(
			setup.sql,
			setup.ctx,
			captured.capture.opportunityId,
			pipeline.stages[1].id
		);
		await handleTelnyxWebhook(
			setup.sql,
			setup.messaging,
			new FakeVoiceProvider(),
			JSON.stringify({
				data: {
					id: `evt-capture-${setup.ctx.accountId}`,
					event_type: 'message.received',
					payload: {
						id: `pm-capture-${setup.ctx.accountId}`,
						from: { phone_number: '+15125550177' },
						to: [{ phone_number: setup.number.e164 }],
						text: 'Thursday works for me.'
					}
				}
			}),
			FAKE_WEBHOOK_SIGNATURE,
			'0'
		);

		const webhook = new FakeOutboundWebhookProvider();
		await drainOutbox(
			setup.sql,
			{
				messaging: setup.messaging,
				voice: new FakeVoiceProvider(),
				billing: setup.billing,
				ai: new FakeAiProvider(),
				webhook
			},
			outboxHandlers
		);
		expect(webhook.deliveries.map((delivery) => delivery.headers['x-kiso-event']).sort()).toEqual([
			'contact.created',
			'message.received',
			'opportunity.stage_changed'
		]);
	});
});

describe('contact CSV import', () => {
	it('deduplicates customers and does not manufacture SMS consent', async () => {
		const sql = getSql();
		const workspace = await createWorkspace('csv-import');
		const ctx = authContext(workspace);
		const result = await importContactsCsv(
			sql,
			ctx,
			'name,email,phone\n"Ada Lovelace",ada@example.test,(512) 555-0111\n"Ada Duplicate",ada@example.test,(512) 555-0111\n"Bad Email",not-an-email,(512) 555-0112'
		);
		expect(result).toMatchObject({ totalRows: 3, created: 1, matched: 1, skipped: 1 });
		const contacts = await listContacts(sql, ctx.accountId);
		expect(contacts).toHaveLength(1);
		expect(contacts[0]).toMatchObject({
			firstName: 'Ada',
			lastName: 'Lovelace',
			messagingConsent: 'unknown'
		});
	});

	it('preserves quoted fields and enforces row and byte limits', async () => {
		const sql = getSql();
		const workspace = await createWorkspace('csv-limits');
		const ctx = authContext(workspace);
		const result = await importContactsCsv(
			sql,
			ctx,
			'first_name,last_name,email,phone\nAda,"Lovelace, Countess",ada.quoted@example.test,(512) 555-0133'
		);
		expect(result).toMatchObject({ totalRows: 1, created: 1, matched: 0, skipped: 0 });
		expect((await listContacts(sql, ctx.accountId))[0]).toMatchObject({
			firstName: 'Ada',
			lastName: 'Lovelace, Countess',
			messagingConsent: 'unknown'
		});

		const tooManyRows = [
			'name,email',
			...Array.from({ length: 501 }, (_, index) => `Customer ${index},customer${index}@example.test`)
		].join('\n');
		await expect(importContactsCsv(sql, ctx, tooManyRows)).rejects.toThrow(
			'limited to 500 contacts'
		);
		expect(() => parseContactImport({ csv: 'é'.repeat(500_001) })).toThrow(
			'1 MB or smaller'
		);
	});
});

describe('outbound webhook validation', () => {
	it('rejects non-HTTPS and literal private-network endpoints', () => {
		expect(() =>
			parseCreateWebhookEndpoint({ url: 'http://example.test/hook', events: ['contact.created'] })
		).toThrowError(AppError);
		expect(() =>
			parseCreateWebhookEndpoint({ url: 'https://127.0.0.1/hook', events: ['contact.created'] })
		).toThrowError(AppError);
	});

	it('retries failed delivery and records the eventual delivered state', async () => {
		const setup = await setupCapture('webhook-retry');
		await createWebhookEndpoint(
			setup.sql,
			setup.ctx,
			parseCreateWebhookEndpoint({
				url: 'https://retry.example.test/kiso',
				events: ['contact.created']
			})
		);
		await queueOutboundWebhookEvent(setup.sql, {
			accountId: setup.ctx.accountId,
			locationId: setup.ctx.locationId,
			eventType: 'contact.created',
			data: { contact: { id: 'retry-customer' } }
		});
		const webhook = new FakeOutboundWebhookProvider();
		webhook.responses.push(503, 204);
		const providers = {
			messaging: setup.messaging,
			voice: new FakeVoiceProvider(),
			billing: setup.billing,
			ai: new FakeAiProvider(),
			webhook
		};
		await drainOutbox(setup.sql, providers, outboxHandlers);
		expect((await getWebhookSettings(setup.sql, setup.ctx)).deliveries[0]).toMatchObject({
			status: 'pending',
			attempts: 1,
			responseStatus: 503
		});
		await setup.sql`
			update outbox
			set run_after = now()
			where account_id = ${setup.ctx.accountId}
				and kind = 'outbound_webhook.deliver' and processed_at is null
		`;
		await drainOutbox(setup.sql, providers, outboxHandlers);
		expect(webhook.deliveries).toHaveLength(2);
		expect((await getWebhookSettings(setup.sql, setup.ctx)).deliveries[0]).toMatchObject({
			status: 'delivered',
			attempts: 2,
			responseStatus: 204
		});
	});
});
