import type { Opportunity } from '$lib/types';
import type { Queryable } from '../db';

type OpportunityRow = {
	id: string;
	location_id: string;
	pipeline_id: string;
	stage_id: string;
	stage_name: string;
	contact_id: string | null;
	company_id: string | null;
	contact_name: string | null;
	company_name: string | null;
	name: string;
	// bigint: postgres.js returns int8 as a string
	amount_cents: string | number | null;
	created_at: Date;
	updated_at: Date;
};

function mapOpportunity(row: OpportunityRow): Opportunity {
	return {
		id: row.id,
		locationId: row.location_id,
		pipelineId: row.pipeline_id,
		stageId: row.stage_id,
		stageName: row.stage_name,
		contactId: row.contact_id,
		companyId: row.company_id,
		contactName: row.contact_name,
		companyName: row.company_name,
		name: row.name,
		amountCents: row.amount_cents == null ? null : Number(row.amount_cents),
		createdAt: row.created_at.toISOString(),
		updatedAt: row.updated_at.toISOString()
	};
}

export async function insertOpportunity(
	sql: Queryable,
	row: {
		id: string;
		accountId: string;
		locationId: string;
		pipelineId: string;
		stageId: string;
		contactId: string | null;
		companyId: string | null;
		name: string;
		amountCents: number | null;
		createdBy: string;
	}
): Promise<Opportunity> {
	const rows = await sql<OpportunityRow[]>`
		insert into opportunities (
			id, account_id, location_id, pipeline_id, stage_id, contact_id, company_id, name, amount_cents, created_by
		)
		values (
			${row.id},
			${row.accountId},
			${row.locationId},
			${row.pipelineId},
			${row.stageId},
			${row.contactId},
			${row.companyId},
			${row.name},
			${row.amountCents},
			${row.createdBy}
		)
		returning id
	`;
	const created = await getOpportunity(sql, row.accountId, rows[0].id);
	if (!created) throw new Error('opportunity insert failed');
	return created;
}

export async function listOpportunities(sql: Queryable, accountId: string): Promise<Opportunity[]> {
	const rows = await sql<OpportunityRow[]>`
		select
			o.id,
			o.location_id,
			o.pipeline_id,
			o.stage_id,
			s.name as stage_name,
			o.contact_id,
			o.company_id,
			nullif(trim(concat_ws(' ', ct.first_name, ct.last_name)), '') as contact_name,
			co.name as company_name,
			o.name,
			o.amount_cents,
			o.created_at,
			o.updated_at
		from opportunities o
		join pipeline_stages s on s.id = o.stage_id and s.account_id = o.account_id
		left join contacts ct on ct.id = o.contact_id and ct.account_id = o.account_id
		left join companies co on co.id = o.company_id and co.account_id = o.account_id
		where o.account_id = ${accountId}
		order by o.created_at desc, o.id desc
		limit 200
	`;
	return rows.map(mapOpportunity);
}

export async function listOpportunitiesForContact(
	sql: Queryable,
	accountId: string,
	contactId: string
): Promise<Opportunity[]> {
	const rows = await sql<OpportunityRow[]>`
		select
			o.id,
			o.location_id,
			o.pipeline_id,
			o.stage_id,
			s.name as stage_name,
			o.contact_id,
			o.company_id,
			nullif(trim(concat_ws(' ', ct.first_name, ct.last_name)), '') as contact_name,
			co.name as company_name,
			o.name,
			o.amount_cents,
			o.created_at,
			o.updated_at
		from opportunities o
		join pipeline_stages s on s.id = o.stage_id and s.account_id = o.account_id
		left join contacts ct on ct.id = o.contact_id and ct.account_id = o.account_id
		left join companies co on co.id = o.company_id and co.account_id = o.account_id
		where o.account_id = ${accountId} and o.contact_id = ${contactId}
		order by o.created_at desc, o.id desc
	`;
	return rows.map(mapOpportunity);
}

export async function getOpportunity(
	sql: Queryable,
	accountId: string,
	id: string
): Promise<Opportunity | null> {
	const rows = await sql<OpportunityRow[]>`
		select
			o.id,
			o.location_id,
			o.pipeline_id,
			o.stage_id,
			s.name as stage_name,
			o.contact_id,
			o.company_id,
			nullif(trim(concat_ws(' ', ct.first_name, ct.last_name)), '') as contact_name,
			co.name as company_name,
			o.name,
			o.amount_cents,
			o.created_at,
			o.updated_at
		from opportunities o
		join pipeline_stages s on s.id = o.stage_id and s.account_id = o.account_id
		left join contacts ct on ct.id = o.contact_id and ct.account_id = o.account_id
		left join companies co on co.id = o.company_id and co.account_id = o.account_id
		where o.account_id = ${accountId} and o.id = ${id}
		limit 1
	`;
	return rows[0] ? mapOpportunity(rows[0]) : null;
}

export async function updateOpportunityStage(
	sql: Queryable,
	accountId: string,
	id: string,
	stageId: string
): Promise<Opportunity | null> {
	const rows = await sql<{ id: string }[]>`
		update opportunities
		set stage_id = ${stageId}, updated_at = now()
		where account_id = ${accountId} and id = ${id}
		returning id
	`;
	if (!rows[0]) return null;
	return getOpportunity(sql, accountId, rows[0].id);
}
