import { contactName } from '$lib/format';
import type { Activity, Company, Contact, Opportunity } from '$lib/types';
import type { AuthContext } from '../context';
import type { Sql } from '../db';
import { AppError } from '../errors';
import { uuidv7 } from '../ids';
import { insertActivity, listActivitiesForContact } from '../repos/activities';
import { listCompaniesForContact } from '../repos/companies';
import { getContact, insertContact, listContacts } from '../repos/contacts';
import { getLocation } from '../repos/locations';
import { listOpportunitiesForContact } from '../repos/opportunities';
import { asObject, optionalString, parseId } from '../validation';

export type CreateContactInput = {
	firstName: string;
	lastName: string;
	email: string | null;
	phone: string | null;
	locationId?: string;
};

export function parseCreateContact(body: unknown): CreateContactInput {
	const obj = asObject(body);
	const firstName = optionalString(obj.firstName, 'firstName') ?? '';
	const lastName = optionalString(obj.lastName, 'lastName') ?? '';
	if (!firstName && !lastName) {
		throw new AppError('validation', 'firstName or lastName is required');
	}
	return {
		firstName,
		lastName,
		email: optionalString(obj.email, 'email', 320),
		phone: optionalString(obj.phone, 'phone', 40),
		locationId: obj.locationId ? parseId(obj.locationId, 'locationId') : undefined
	};
}

export async function createContact(
	sql: Sql,
	ctx: AuthContext,
	input: CreateContactInput
): Promise<Contact> {
	if (!input.firstName.trim() && !input.lastName.trim()) {
		throw new AppError('validation', 'firstName or lastName is required');
	}
	const locationId = input.locationId ?? ctx.locationId;
	const location = await getLocation(sql, ctx.accountId, locationId);
	if (!location) {
		throw new AppError('validation', 'location is invalid');
	}

	return sql.begin(async (tx) => {
		const contact = await insertContact(tx, {
			id: uuidv7(),
			accountId: ctx.accountId,
			locationId,
			firstName: input.firstName,
			lastName: input.lastName,
			email: input.email,
			phone: input.phone,
			createdBy: ctx.userId
		});
		await insertActivity(tx, {
			id: uuidv7(),
			accountId: ctx.accountId,
			contactId: contact.id,
			companyId: null,
			opportunityId: null,
			type: 'contact.created',
			summary: `${contactName(contact)} created`,
			payload: { contactId: contact.id },
			createdBy: ctx.userId
		});
		return contact;
	});
}

export async function listAccountContacts(sql: Sql, ctx: AuthContext): Promise<Contact[]> {
	return listContacts(sql, ctx.accountId);
}

export async function getContactDetail(
	sql: Sql,
	ctx: AuthContext,
	id: string
): Promise<{ contact: Contact; companies: Company[]; opportunities: Opportunity[] }> {
	const contact = await getContact(sql, ctx.accountId, id);
	if (!contact) {
		throw new AppError('not_found', 'Contact not found');
	}
	const [companies, opportunities] = await Promise.all([
		listCompaniesForContact(sql, ctx.accountId, id),
		listOpportunitiesForContact(sql, ctx.accountId, id)
	]);
	return { contact, companies, opportunities };
}

export async function getContactTimeline(
	sql: Sql,
	ctx: AuthContext,
	id: string
): Promise<Activity[]> {
	const contact = await getContact(sql, ctx.accountId, id);
	if (!contact) {
		throw new AppError('not_found', 'Contact not found');
	}
	return listActivitiesForContact(sql, ctx.accountId, id);
}
