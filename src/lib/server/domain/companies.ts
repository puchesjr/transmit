import { contactName } from '$lib/format';
import type { Company, Contact } from '$lib/types';
import type { AuthContext } from '../context';
import type { Sql } from '../db';
import { AppError } from '../errors';
import { uuidv7 } from '../ids';
import { insertActivity } from '../repos/activities';
import {
	getCompany,
	insertCompany,
	insertCompanyContact,
	listCompanies,
	listContactsForCompany
} from '../repos/companies';
import { getContact } from '../repos/contacts';
import { getLocation } from '../repos/locations';
import { asObject, optionalId, optionalString, parseId, requiredString } from '../validation';

export type CreateCompanyInput = {
	name: string;
	domain: string | null;
	contactId: string | null;
	locationId?: string;
};

export function parseCreateCompany(body: unknown): CreateCompanyInput {
	const obj = asObject(body);
	return {
		name: requiredString(obj.name, 'name', 200),
		domain: optionalString(obj.domain, 'domain', 200),
		contactId: optionalId(obj.contactId, 'contactId'),
		locationId: obj.locationId ? parseId(obj.locationId, 'locationId') : undefined
	};
}

export function parseAssociateCompany(body: unknown): { companyId: string } {
	const obj = asObject(body);
	return { companyId: parseId(obj.companyId, 'companyId') };
}

export async function createCompany(
	sql: Sql,
	ctx: AuthContext,
	input: CreateCompanyInput
): Promise<Company> {
	const locationId = input.locationId ?? ctx.locationId;
	const location = await getLocation(sql, ctx.accountId, locationId);
	if (!location) {
		throw new AppError('validation', 'location is invalid');
	}

	let contact: Contact | null = null;
	if (input.contactId) {
		contact = await getContact(sql, ctx.accountId, input.contactId);
		if (!contact) {
			throw new AppError('validation', 'contact is invalid');
		}
	}

	return sql.begin(async (tx) => {
		const company = await insertCompany(tx, {
			id: uuidv7(),
			accountId: ctx.accountId,
			locationId,
			name: input.name,
			domain: input.domain,
			createdBy: ctx.userId
		});
		await insertActivity(tx, {
			id: uuidv7(),
			accountId: ctx.accountId,
			contactId: contact?.id ?? null,
			companyId: company.id,
			opportunityId: null,
			type: 'company.created',
			summary: `Company ${company.name} created`,
			payload: { companyId: company.id, name: company.name },
			createdBy: ctx.userId
		});
		if (contact) {
			await insertCompanyContact(tx, {
				id: uuidv7(),
				accountId: ctx.accountId,
				companyId: company.id,
				contactId: contact.id
			});
			await insertActivity(tx, {
				id: uuidv7(),
				accountId: ctx.accountId,
				contactId: contact.id,
				companyId: company.id,
				opportunityId: null,
				type: 'company.associated',
				summary: `${company.name} associated with ${contactName(contact)}`,
				payload: { companyId: company.id, contactId: contact.id },
				createdBy: ctx.userId
			});
		}
		return company;
	});
}

export async function listAccountCompanies(sql: Sql, ctx: AuthContext): Promise<Company[]> {
	return listCompanies(sql, ctx.accountId);
}

export async function getCompanyDetail(
	sql: Sql,
	ctx: AuthContext,
	id: string
): Promise<{
	company: Company;
	contacts: { id: string; firstName: string; lastName: string; email: string | null }[];
}> {
	const company = await getCompany(sql, ctx.accountId, id);
	if (!company) {
		throw new AppError('not_found', 'Company not found');
	}
	const contacts = await listContactsForCompany(sql, ctx.accountId, id);
	return { company, contacts };
}

export async function associateCompanyToContact(
	sql: Sql,
	ctx: AuthContext,
	contactId: string,
	companyId: string
): Promise<{ associated: boolean }> {
	const contact = await getContact(sql, ctx.accountId, contactId);
	if (!contact) {
		throw new AppError('not_found', 'Contact not found');
	}
	const company = await getCompany(sql, ctx.accountId, companyId);
	if (!company) {
		throw new AppError('validation', 'company is invalid');
	}

	return sql.begin(async (tx) => {
		const inserted = await insertCompanyContact(tx, {
			id: uuidv7(),
			accountId: ctx.accountId,
			companyId,
			contactId
		});
		if (inserted) {
			await insertActivity(tx, {
				id: uuidv7(),
				accountId: ctx.accountId,
				contactId,
				companyId,
				opportunityId: null,
				type: 'company.associated',
				summary: `${company.name} associated with ${contactName(contact)}`,
				payload: { companyId, contactId },
				createdBy: ctx.userId
			});
		}
		return { associated: inserted };
	});
}
