import type { Opportunity, Pipeline } from '$lib/types';
import type { AuthContext } from '../context';
import type { Sql } from '../db';
import { AppError } from '../errors';
import { uuidv7 } from '../ids';
import { insertActivity } from '../repos/activities';
import { getCompany } from '../repos/companies';
import { getContact } from '../repos/contacts';
import { getLocation } from '../repos/locations';
import {
	getOpportunity,
	insertOpportunity,
	listOpportunities,
	updateOpportunityStage
} from '../repos/opportunities';
import { getDefaultPipeline, getStage, listPipelines } from '../repos/pipelines';
import {
	asObject,
	optionalAmountCents,
	optionalId,
	parseId,
	requiredString
} from '../validation';

export type CreateOpportunityInput = {
	name: string;
	contactId: string | null;
	companyId: string | null;
	amountCents: number | null;
	stageId: string | null;
	locationId?: string;
};

export function parseCreateOpportunity(body: unknown): CreateOpportunityInput {
	const obj = asObject(body);
	return {
		name: requiredString(obj.name, 'name', 200),
		contactId: optionalId(obj.contactId, 'contactId'),
		companyId: optionalId(obj.companyId, 'companyId'),
		amountCents: optionalAmountCents(obj.amountCents),
		stageId: optionalId(obj.stageId, 'stageId'),
		locationId: obj.locationId ? parseId(obj.locationId, 'locationId') : undefined
	};
}

export function parseMoveStage(body: unknown): { stageId: string } {
	const obj = asObject(body);
	return { stageId: parseId(obj.stageId, 'stageId') };
}

export async function createOpportunity(
	sql: Sql,
	ctx: AuthContext,
	input: CreateOpportunityInput
): Promise<Opportunity> {
	const locationId = input.locationId ?? ctx.locationId;
	const location = await getLocation(sql, ctx.accountId, locationId);
	if (!location) {
		throw new AppError('validation', 'location is invalid');
	}

	const pipeline = await getDefaultPipeline(sql, ctx.accountId);
	if (!pipeline || pipeline.stages.length === 0) {
		throw new AppError('internal', 'Default pipeline is missing');
	}

	let stage = pipeline.stages[0];
	if (input.stageId) {
		const found = pipeline.stages.find((item) => item.id === input.stageId);
		if (!found) {
			throw new AppError('validation', 'stage is invalid');
		}
		stage = found;
	}

	if (input.contactId) {
		const contact = await getContact(sql, ctx.accountId, input.contactId);
		if (!contact) {
			throw new AppError('validation', 'contact is invalid');
		}
	}
	if (input.companyId) {
		const company = await getCompany(sql, ctx.accountId, input.companyId);
		if (!company) {
			throw new AppError('validation', 'company is invalid');
		}
	}

	return sql.begin(async (tx) => {
		const opportunity = await insertOpportunity(tx, {
			id: uuidv7(),
			accountId: ctx.accountId,
			locationId,
			pipelineId: pipeline.id,
			stageId: stage.id,
			contactId: input.contactId,
			companyId: input.companyId,
			name: input.name,
			amountCents: input.amountCents,
			createdBy: ctx.userId
		});
		await insertActivity(tx, {
			id: uuidv7(),
			accountId: ctx.accountId,
			contactId: opportunity.contactId,
			companyId: opportunity.companyId,
			opportunityId: opportunity.id,
			type: 'opportunity.created',
			summary: `Opportunity ${opportunity.name} created in ${opportunity.stageName}`,
			payload: {
				opportunityId: opportunity.id,
				stageId: opportunity.stageId,
				stageName: opportunity.stageName
			},
			createdBy: ctx.userId
		});
		return opportunity;
	});
}

export async function listAccountOpportunities(
	sql: Sql,
	ctx: AuthContext
): Promise<{ opportunities: Opportunity[]; pipelines: Pipeline[] }> {
	const [opportunities, pipelines] = await Promise.all([
		listOpportunities(sql, ctx.accountId),
		listPipelines(sql, ctx.accountId)
	]);
	return { opportunities, pipelines };
}

export async function getOpportunityDetail(
	sql: Sql,
	ctx: AuthContext,
	id: string
): Promise<{ opportunity: Opportunity; pipelines: Pipeline[] }> {
	const opportunity = await getOpportunity(sql, ctx.accountId, id);
	if (!opportunity) {
		throw new AppError('not_found', 'Opportunity not found');
	}
	const pipelines = await listPipelines(sql, ctx.accountId);
	return { opportunity, pipelines };
}

export async function moveOpportunityStage(
	sql: Sql,
	ctx: AuthContext,
	id: string,
	stageId: string
): Promise<Opportunity> {
	const current = await getOpportunity(sql, ctx.accountId, id);
	if (!current) {
		throw new AppError('not_found', 'Opportunity not found');
	}
	const stage = await getStage(sql, ctx.accountId, stageId);
	if (!stage || stage.pipelineId !== current.pipelineId) {
		throw new AppError('validation', 'stage is invalid');
	}
	if (current.stageId === stage.id) {
		return current;
	}

	return sql.begin(async (tx) => {
		const updated = await updateOpportunityStage(tx, ctx.accountId, id, stage.id);
		if (!updated) {
			throw new AppError('not_found', 'Opportunity not found');
		}
		await insertActivity(tx, {
			id: uuidv7(),
			accountId: ctx.accountId,
			contactId: updated.contactId,
			companyId: updated.companyId,
			opportunityId: updated.id,
			type: 'opportunity.stage_changed',
			summary: `Opportunity ${updated.name} moved from ${current.stageName} to ${updated.stageName}`,
			payload: {
				fromStageId: current.stageId,
				fromStageName: current.stageName,
				toStageId: updated.stageId,
				toStageName: updated.stageName
			},
			createdBy: ctx.userId
		});
		return updated;
	});
}

export async function listAccountPipelines(sql: Sql, ctx: AuthContext): Promise<Pipeline[]> {
	return listPipelines(sql, ctx.accountId);
}
