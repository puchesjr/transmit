import type { Activity } from '$lib/types';
import type { Queryable } from '../db';

type ActivityRow = {
	id: string;
	type: string;
	summary: string;
	contact_id: string | null;
	company_id: string | null;
	opportunity_id: string | null;
	payload: Record<string, unknown>;
	created_at: Date;
};

function mapActivity(row: ActivityRow): Activity {
	return {
		id: row.id,
		type: row.type,
		summary: row.summary,
		contactId: row.contact_id,
		companyId: row.company_id,
		opportunityId: row.opportunity_id,
		payload: row.payload ?? {},
		createdAt: row.created_at.toISOString()
	};
}

export async function insertActivity(
	sql: Queryable,
	row: {
		id: string;
		accountId: string;
		contactId: string | null;
		companyId: string | null;
		opportunityId: string | null;
		type: string;
		summary: string;
		payload: Record<string, unknown>;
		createdBy: string;
	}
): Promise<Activity> {
	const rows = await sql<ActivityRow[]>`
		insert into activities (
			id, account_id, contact_id, company_id, opportunity_id, type, summary, payload, created_by
		)
		values (
			${row.id},
			${row.accountId},
			${row.contactId},
			${row.companyId},
			${row.opportunityId},
			${row.type},
			${row.summary},
			${sql.json(row.payload as never)},
			${row.createdBy}
		)
		returning id, type, summary, contact_id, company_id, opportunity_id, payload, created_at
	`;
	return mapActivity(rows[0]);
}

export async function listActivitiesForContact(
	sql: Queryable,
	accountId: string,
	contactId: string
): Promise<Activity[]> {
	const rows = await sql<ActivityRow[]>`
		select id, type, summary, contact_id, company_id, opportunity_id, payload, created_at
		from activities
		where account_id = ${accountId} and contact_id = ${contactId}
		order by created_at desc, id desc
		limit 200
	`;
	return rows.map(mapActivity);
}
