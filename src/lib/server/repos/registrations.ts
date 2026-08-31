import type { MessagingRegistration } from '$lib/types';
import type { Queryable } from '../db';

type RegistrationRow = {
	id: string;
	legal_name: string;
	ein: string | null;
	website: string | null;
	address: string;
	contact_email: string;
	use_case: string;
	sample_message: string;
	status: 'submitted' | 'approved' | 'rejected';
	provider_brand_id: string | null;
	provider_campaign_id: string | null;
	rejection_reason: string | null;
};

const COLUMNS = [
	'id',
	'legal_name',
	'ein',
	'website',
	'address',
	'contact_email',
	'use_case',
	'sample_message',
	'status',
	'provider_brand_id',
	'provider_campaign_id',
	'rejection_reason'
] as const;

function mapRegistration(row: RegistrationRow): MessagingRegistration {
	return {
		id: row.id,
		legalName: row.legal_name,
		ein: row.ein,
		website: row.website,
		address: row.address,
		contactEmail: row.contact_email,
		useCase: row.use_case,
		sampleMessage: row.sample_message,
		status: row.status,
		rejectionReason: row.rejection_reason
	};
}

export async function insertRegistration(
	sql: Queryable,
	row: {
		id: string;
		accountId: string;
		legalName: string;
		ein: string | null;
		website: string | null;
		address: string;
		contactEmail: string;
		useCase: string;
		sampleMessage: string;
		status: 'submitted' | 'approved';
		providerBrandId: string;
		providerCampaignId: string;
	}
): Promise<MessagingRegistration> {
	const rows = await sql<RegistrationRow[]>`
		insert into messaging_registrations (
			id, account_id, legal_name, ein, website, address, contact_email,
			use_case, sample_message, status, provider_brand_id, provider_campaign_id
		)
		values (
			${row.id}, ${row.accountId}, ${row.legalName}, ${row.ein}, ${row.website},
			${row.address}, ${row.contactEmail}, ${row.useCase}, ${row.sampleMessage},
			${row.status}, ${row.providerBrandId}, ${row.providerCampaignId}
		)
		returning ${sql(COLUMNS as unknown as string[])}
	`;
	return mapRegistration(rows[0]);
}

export async function getRegistration(
	sql: Queryable,
	accountId: string
): Promise<(MessagingRegistration & { providerBrandId: string | null; providerCampaignId: string | null }) | null> {
	const rows = await sql<RegistrationRow[]>`
		select ${sql(COLUMNS as unknown as string[])}
		from messaging_registrations
		where account_id = ${accountId}
		limit 1
	`;
	const row = rows[0];
	if (!row) return null;
	return {
		...mapRegistration(row),
		providerBrandId: row.provider_brand_id,
		providerCampaignId: row.provider_campaign_id
	};
}

export async function updateRegistrationStatus(
	sql: Queryable,
	accountId: string,
	status: 'submitted' | 'approved' | 'rejected',
	rejectionReason: string | null
): Promise<void> {
	await sql`
		update messaging_registrations
		set status = ${status}, rejection_reason = ${rejectionReason}, updated_at = now()
		where account_id = ${accountId}
	`;
}
