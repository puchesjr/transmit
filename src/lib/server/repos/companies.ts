import type { Company } from '$lib/types';
import type { Queryable } from '../db';

type CompanyRow = {
	id: string;
	location_id: string;
	name: string;
	domain: string | null;
	created_at: Date;
	updated_at: Date;
};

function mapCompany(row: CompanyRow): Company {
	return {
		id: row.id,
		locationId: row.location_id,
		name: row.name,
		domain: row.domain,
		createdAt: row.created_at.toISOString(),
		updatedAt: row.updated_at.toISOString()
	};
}

export async function insertCompany(
	sql: Queryable,
	row: {
		id: string;
		accountId: string;
		locationId: string;
		name: string;
		domain: string | null;
		createdBy: string;
	}
): Promise<Company> {
	const rows = await sql<CompanyRow[]>`
		insert into companies (id, account_id, location_id, name, domain, created_by)
		values (${row.id}, ${row.accountId}, ${row.locationId}, ${row.name}, ${row.domain}, ${row.createdBy})
		returning id, location_id, name, domain, created_at, updated_at
	`;
	return mapCompany(rows[0]);
}

export async function listCompanies(sql: Queryable, accountId: string): Promise<Company[]> {
	const rows = await sql<CompanyRow[]>`
		select id, location_id, name, domain, created_at, updated_at
		from companies
		where account_id = ${accountId}
		order by name asc, id asc
		limit 200
	`;
	return rows.map(mapCompany);
}

export async function getCompany(sql: Queryable, accountId: string, id: string): Promise<Company | null> {
	const rows = await sql<CompanyRow[]>`
		select id, location_id, name, domain, created_at, updated_at
		from companies
		where account_id = ${accountId} and id = ${id}
		limit 1
	`;
	return rows[0] ? mapCompany(rows[0]) : null;
}

export async function insertCompanyContact(
	sql: Queryable,
	row: { id: string; accountId: string; companyId: string; contactId: string }
): Promise<boolean> {
	const rows = await sql<{ id: string }[]>`
		insert into company_contacts (id, account_id, company_id, contact_id)
		values (${row.id}, ${row.accountId}, ${row.companyId}, ${row.contactId})
		on conflict (account_id, company_id, contact_id) do nothing
		returning id
	`;
	return rows.length > 0;
}

export async function listCompaniesForContact(
	sql: Queryable,
	accountId: string,
	contactId: string
): Promise<Company[]> {
	const rows = await sql<CompanyRow[]>`
		select c.id, c.location_id, c.name, c.domain, c.created_at, c.updated_at
		from company_contacts cc
		join companies c on c.id = cc.company_id and c.account_id = cc.account_id
		where cc.account_id = ${accountId} and cc.contact_id = ${contactId}
		order by c.name asc
	`;
	return rows.map(mapCompany);
}

export async function listContactsForCompany(
	sql: Queryable,
	accountId: string,
	companyId: string
): Promise<{ id: string; firstName: string; lastName: string; email: string | null }[]> {
	const rows = await sql<
		{ id: string; first_name: string; last_name: string; email: string | null }[]
	>`
		select ct.id, ct.first_name, ct.last_name, ct.email
		from company_contacts cc
		join contacts ct on ct.id = cc.contact_id and ct.account_id = cc.account_id
		where cc.account_id = ${accountId} and cc.company_id = ${companyId}
		order by ct.last_name asc, ct.first_name asc
	`;
	return rows.map((row) => ({
		id: row.id,
		firstName: row.first_name,
		lastName: row.last_name,
		email: row.email
	}));
}
