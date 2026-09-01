import { describe, expect, it } from 'vitest';
import { getSql } from '$lib/server/db';
import { uuidv7 } from '$lib/server/ids';
import { createCompany } from '$lib/server/domain/companies';
import { createContact } from '$lib/server/domain/contacts';
import { createOpportunity, moveOpportunityStage } from '$lib/server/domain/opportunities';
import { getCompany } from '$lib/server/repos/companies';
import { getCallBySession, insertInboundCall, listCalls } from '$lib/server/repos/calls';
import { findOrCreateConversation, getConversation } from '$lib/server/repos/conversations';
import { insertMessage, listMessagesForConversation } from '$lib/server/repos/messages';
import { getOpportunity, updateOpportunityStage } from '$lib/server/repos/opportunities';
import { insertPhoneNumber, listPhoneNumbers } from '$lib/server/repos/phone-numbers';
import { getLocation, updateLocationVoiceSettings } from '$lib/server/repos/locations';
import { listPipelines } from '$lib/server/repos/pipelines';
import { authContext, createWorkspace } from '../helpers';
import { getLeadForm, listLeadForms } from '$lib/server/repos/lead-capture';
import {
	createWebhookEndpoint,
	getWebhookSettings,
	queueOutboundWebhookEvent
} from '$lib/server/domain/outbound-webhooks';

describe('tenant isolation', () => {
	it('cannot update another account opportunity stage even with a known id', async () => {
		const sql = getSql();
		const seller = await createWorkspace('seller');
		const stranger = await createWorkspace('stranger');

		const opportunity = await createOpportunity(sql, authContext(seller), {
			name: 'Engine contract',
			contactId: null,
			companyId: null,
			amountCents: 100000,
			stageId: null
		});

		const strangerPipelines = await listPipelines(sql, stranger.account.id);
		const strangerStage = strangerPipelines[0]?.stages[1];
		expect(strangerStage).toBeTruthy();

		const updated = await updateOpportunityStage(
			sql,
			stranger.account.id,
			opportunity.id,
			strangerStage!.id
		);
		expect(updated).toBeNull();

		const original = await getOpportunity(sql, seller.account.id, opportunity.id);
		expect(original?.stageId).toBe(opportunity.stageId);
	});

	it('rejects moving a deal onto another account stage', async () => {
		const sql = getSql();
		const seller = await createWorkspace('move-seller');
		const stranger = await createWorkspace('move-stranger');
		const opportunity = await createOpportunity(sql, authContext(seller), {
			name: 'Hidden deal',
			contactId: null,
			companyId: null,
			amountCents: null,
			stageId: null
		});
		const strangerStage = (await listPipelines(sql, stranger.account.id))[0]?.stages[1];
		expect(strangerStage).toBeTruthy();

		await expect(
			moveOpportunityStage(sql, authContext(seller), opportunity.id, strangerStage!.id)
		).rejects.toMatchObject({ code: 'validation' });
	});

	it('scopes companies by account_id', async () => {
		const sql = getSql();
		const a = await createWorkspace('co-a');
		const b = await createWorkspace('co-b');
		const contact = await createContact(sql, authContext(a), {
			firstName: 'Jo',
			lastName: 'Host',
			email: null,
			phone: null
		});
		const company = await createCompany(sql, authContext(a), {
			name: 'Host Co',
			domain: null,
			contactId: contact.id
		});

		expect(await getCompany(sql, a.account.id, company.id)).not.toBeNull();
		expect(await getCompany(sql, b.account.id, company.id)).toBeNull();
	});

	it('scopes conversations, messages, and number lists by account_id', async () => {
		const sql = getSql();
		const a = await createWorkspace('message-a');
		const b = await createWorkspace('message-b');
		const customer = await createContact(sql, authContext(a), {
			firstName: 'Tenant',
			lastName: 'A',
			email: null,
			phone: '+15125550111'
		});
		const number = await insertPhoneNumber(sql, {
			id: uuidv7(),
			accountId: a.account.id,
			locationId: a.location.id,
			e164: '+15125550222',
			providerNumberId: 'tenant-a-number'
		});
		const conversation = await findOrCreateConversation(sql, {
			id: uuidv7(),
			accountId: a.account.id,
			locationId: a.location.id,
			contactId: customer.id,
			phoneNumberId: number.id,
			assigneeUserId: a.user.id
		});
		await insertMessage(sql, {
			id: uuidv7(),
			accountId: a.account.id,
			locationId: a.location.id,
			conversationId: conversation.id,
			contactId: customer.id,
			phoneNumberId: number.id,
			direction: 'outbound',
			body: 'Tenant A only',
			status: 'queued',
			providerMessageId: null,
			notBefore: null,
			createdBy: a.user.id
		});

		expect(await getConversation(sql, a.account.id, conversation.id)).not.toBeNull();
		expect(await getConversation(sql, b.account.id, conversation.id)).toBeNull();
		expect(
			await listMessagesForConversation(sql, b.account.id, conversation.id)
		).toEqual([]);
		expect((await listPhoneNumbers(sql, b.account.id)).some((row) => row.id === number.id)).toBe(
			false
		);
	});

	it('scopes calls and location voice settings by account_id', async () => {
		const sql = getSql();
		const a = await createWorkspace('call-a');
		const b = await createWorkspace('call-b');
		const customer = await createContact(sql, authContext(a), {
			firstName: 'Call', lastName: 'Owner', email: null, phone: '+15125550301'
		});
		const number = await insertPhoneNumber(sql, {
			id: uuidv7(), accountId: a.account.id, locationId: a.location.id,
			e164: '+15125550302', providerNumberId: 'voice-a-number'
		});
		const sessionId = `session-${uuidv7()}`;
		const call = await insertInboundCall(sql, {
			id: uuidv7(), accountId: a.account.id, locationId: a.location.id,
			contactId: customer.id, phoneNumberId: number.id,
			providerCallSessionId: sessionId, providerCallControlId: 'control-a',
			from: '+15125550301', to: number.e164, startedAt: new Date(), afterHours: false
		});
		await updateLocationVoiceSettings(sql, a.account.id, a.location.id, {
			timezone: 'America/Chicago', forwardingNumber: '+15125550303',
			missedCallTextbackEnabled: true,
			missedCallTemplate: 'Sorry we missed you. Reply STOP to opt out.',
			businessHours: {
				mon: { enabled: true, opensAt: '08:00', closesAt: '17:00' },
				tue: { enabled: true, opensAt: '08:00', closesAt: '17:00' },
				wed: { enabled: true, opensAt: '08:00', closesAt: '17:00' },
				thu: { enabled: true, opensAt: '08:00', closesAt: '17:00' },
				fri: { enabled: true, opensAt: '08:00', closesAt: '17:00' },
				sat: { enabled: false, opensAt: '08:00', closesAt: '17:00' },
				sun: { enabled: false, opensAt: '08:00', closesAt: '17:00' }
			}
		});

		expect(await getCallBySession(sql, a.account.id, sessionId)).toMatchObject({ id: call.id });
		expect(await getCallBySession(sql, b.account.id, sessionId)).toBeNull();
		expect((await listCalls(sql, b.account.id)).some((row) => row.id === call.id)).toBe(false);
		expect(await getLocation(sql, b.account.id, a.location.id)).toBeNull();
	});

	it('scopes lead forms, webhook endpoints, and deliveries by account_id', async () => {
		const sql = getSql();
		const a = await createWorkspace('capture-a');
		const b = await createWorkspace('capture-b');
		const form = (await listLeadForms(sql, a.account.id, a.location.id))[0];
		expect(form).toBeTruthy();
		expect(await getLeadForm(sql, a.account.id, form.id)).not.toBeNull();
		expect(await getLeadForm(sql, b.account.id, form.id)).toBeNull();

		await createWebhookEndpoint(sql, authContext(a), {
			url: 'https://tenant-a.example.test/transmit',
			events: ['contact.created']
		});
		await queueOutboundWebhookEvent(sql, {
			accountId: a.account.id,
			locationId: a.location.id,
			eventType: 'contact.created',
			data: { contact: { id: uuidv7() } }
		});
		const settingsA = await getWebhookSettings(sql, authContext(a));
		const settingsB = await getWebhookSettings(sql, authContext(b));
		expect(settingsA.endpoints).toHaveLength(1);
		expect(settingsA.deliveries).toHaveLength(1);
		expect(settingsB.endpoints).toEqual([]);
		expect(settingsB.deliveries).toEqual([]);
	});
});
