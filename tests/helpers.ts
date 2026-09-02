import type { AuthContext } from '$lib/server/context';
import { getSql } from '$lib/server/db';
import { signup, type SignupResult } from '$lib/server/domain/auth';
import { startCheckout } from '$lib/server/domain/billing';
import { FakeBillingProvider } from '$lib/server/providers/fake-billing';
import { createContact } from '$lib/server/domain/contacts';
import { uuidv7 } from '$lib/server/ids';
import { findOrCreateConversation, touchConversation } from '$lib/server/repos/conversations';
import { insertMessage } from '$lib/server/repos/messages';
import { insertPhoneNumber } from '$lib/server/repos/phone-numbers';
import type { Contact, Message } from '$lib/types';
import type { ConversationRecord } from '$lib/server/repos/conversations';

let seq = 0;
let phoneSeq = 0;

export function uniqueEmail(prefix = 'user'): string {
	seq += 1;
	return `${prefix}.${Date.now()}.${seq}@kisocrm.test`;
}

export async function createWorkspace(prefix = 'user'): Promise<SignupResult> {
	return signup(getSql(), {
		email: uniqueEmail(prefix),
		password: 'password12',
		name: 'Test Owner',
		workspaceName: `${prefix} workspace`
	});
}

export function authContext(result: SignupResult): AuthContext {
	return {
		requestId: 'test-request',
		userId: result.user.id,
		accountId: result.account.id,
		locationId: result.location.id,
		role: result.membership.role
	};
}

export async function activateTestBilling(result: SignupResult): Promise<FakeBillingProvider> {
	const provider = new FakeBillingProvider();
	await startCheckout(getSql(), provider, authContext(result), 'http://kisocrm.test');
	return provider;
}

export async function createTestConversation(
	result: SignupResult,
	input: { customerMessage?: string; consentPhone?: string } = {}
): Promise<{ contact: Contact; conversation: ConversationRecord; message: Message }> {
	const sql = getSql();
	const ctx = authContext(result);
	phoneSeq += 1;
	const suffix = String(1_000_000 + (Date.now() + phoneSeq) % 9_000_000).slice(-7);
	const customerPhone = input.consentPhone ?? `+1512${suffix}`;
	const locationPhone = `+1737${String(1_000_000 + (Date.now() + phoneSeq * 7) % 9_000_000).slice(-7)}`;
	const contact = await createContact(sql, ctx, {
		firstName: 'Riley',
		lastName: 'Customer',
		email: null,
		phone: customerPhone
	});
	const number = await insertPhoneNumber(sql, {
		id: uuidv7(),
		accountId: ctx.accountId,
		locationId: ctx.locationId,
		e164: locationPhone,
		providerNumberId: `test-number-${uuidv7()}`
	});
	const conversation = await findOrCreateConversation(sql, {
		id: uuidv7(),
		accountId: ctx.accountId,
		locationId: ctx.locationId,
		contactId: contact.id,
		phoneNumberId: number.id,
		assigneeUserId: ctx.userId
	});
	const createdAt = new Date();
	const message = await insertMessage(sql, {
		id: uuidv7(),
		accountId: ctx.accountId,
		locationId: ctx.locationId,
		conversationId: conversation.id,
		contactId: contact.id,
		phoneNumberId: number.id,
		direction: 'inbound',
		body: input.customerMessage ?? 'Our water heater is leaking and we need help today.',
		status: 'received',
		providerMessageId: `test-message-${uuidv7()}`,
		notBefore: null,
		createdBy: null
	});
	if (!message) throw new Error('test message insert failed');
	await touchConversation(sql, ctx.accountId, conversation.id, createdAt);
	return { contact, conversation, message };
}
