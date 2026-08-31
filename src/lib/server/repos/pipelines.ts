import type { Pipeline, PipelineStage } from '$lib/types';
import type { Queryable } from '../db';

type PipelineRow = {
	id: string;
	name: string;
	is_default: boolean;
};

type StageRow = {
	id: string;
	pipeline_id: string;
	name: string;
	position: number;
};

export async function insertPipeline(
	sql: Queryable,
	row: { id: string; accountId: string; name: string; isDefault: boolean }
): Promise<void> {
	await sql`
		insert into pipelines (id, account_id, name, is_default)
		values (${row.id}, ${row.accountId}, ${row.name}, ${row.isDefault})
	`;
}

export async function insertPipelineStage(
	sql: Queryable,
	row: { id: string; accountId: string; pipelineId: string; name: string; position: number }
): Promise<void> {
	await sql`
		insert into pipeline_stages (id, account_id, pipeline_id, name, position)
		values (${row.id}, ${row.accountId}, ${row.pipelineId}, ${row.name}, ${row.position})
	`;
}

export async function listPipelines(sql: Queryable, accountId: string): Promise<Pipeline[]> {
	const pipelines = await sql<PipelineRow[]>`
		select id, name, is_default
		from pipelines
		where account_id = ${accountId}
		order by is_default desc, name asc
	`;
	if (pipelines.length === 0) return [];

	const stages = await sql<StageRow[]>`
		select id, pipeline_id, name, position
		from pipeline_stages
		where account_id = ${accountId}
		order by position asc, id asc
	`;

	const byPipeline = new Map<string, PipelineStage[]>();
	for (const stage of stages) {
		const list = byPipeline.get(stage.pipeline_id) ?? [];
		list.push({
			id: stage.id,
			pipelineId: stage.pipeline_id,
			name: stage.name,
			position: stage.position
		});
		byPipeline.set(stage.pipeline_id, list);
	}

	return pipelines.map((pipeline) => ({
		id: pipeline.id,
		name: pipeline.name,
		isDefault: pipeline.is_default,
		stages: byPipeline.get(pipeline.id) ?? []
	}));
}

export async function getDefaultPipeline(sql: Queryable, accountId: string): Promise<Pipeline | null> {
	const pipelines = await listPipelines(sql, accountId);
	return pipelines.find((pipeline) => pipeline.isDefault) ?? pipelines[0] ?? null;
}

export async function getStage(
	sql: Queryable,
	accountId: string,
	id: string
): Promise<(PipelineStage & { accountId: string }) | null> {
	const rows = await sql<(StageRow & { account_id: string })[]>`
		select id, account_id, pipeline_id, name, position
		from pipeline_stages
		where account_id = ${accountId} and id = ${id}
		limit 1
	`;
	const row = rows[0];
	if (!row) return null;
	return {
		id: row.id,
		accountId: row.account_id,
		pipelineId: row.pipeline_id,
		name: row.name,
		position: row.position
	};
}
