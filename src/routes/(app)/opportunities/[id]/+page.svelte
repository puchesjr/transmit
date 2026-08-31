<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { createQuery, useQueryClient } from '@tanstack/svelte-query';
	import { api } from '$lib/client/api';
	import ErrorText from '$lib/client/ErrorText.svelte';
	import { formatCents } from '$lib/format';
	import type { Opportunity, Pipeline } from '$lib/types';

	const queryClient = useQueryClient();
	let opportunityId = $derived(page.params.id);

	const detailQuery = createQuery(() => ({
		queryKey: ['opportunity', opportunityId],
		queryFn: () =>
			api.get<{ opportunity: Opportunity; pipelines: Pipeline[] }>(
				`/api/v1/opportunities/${opportunityId}`
			),
		enabled: Boolean(opportunityId)
	}));

	let moving = $state(false);
	let error = $state<unknown>(null);

	let stages = $derived(
		detailQuery.data?.pipelines.find((pipeline) => pipeline.id === detailQuery.data?.opportunity.pipelineId)
			?.stages ?? []
	);

	async function move(event: Event) {
		const stageId = (event.currentTarget as HTMLSelectElement).value;
		const current = detailQuery.data?.opportunity.stageId;
		if (!stageId || stageId === current) return;
		error = null;
		moving = true;
		try {
			await api.post(`/api/v1/opportunities/${opportunityId}/stage`, { stageId });
			await Promise.all([
				queryClient.invalidateQueries({ queryKey: ['opportunity', opportunityId] }),
				queryClient.invalidateQueries({ queryKey: ['opportunities'] }),
				queryClient.invalidateQueries({ queryKey: ['contact-activities'] }),
				queryClient.invalidateQueries({ queryKey: ['contact'] })
			]);
		} catch (err) {
			error = err;
		} finally {
			moving = false;
		}
	}
</script>

<div class="mx-auto max-w-2xl space-y-6">
	<p>
		<a class="text-sm text-muted hover:text-ink" href={resolve('/opportunities')}>← Pipeline</a>
	</p>

	{#if detailQuery.isPending}
		<p class="text-sm text-muted">Loading opportunity…</p>
	{:else if detailQuery.isError}
		<ErrorText error={detailQuery.error} />
	{:else if detailQuery.data}
		{@const opportunity = detailQuery.data.opportunity}
		<header>
			<h1 class="text-2xl font-semibold tracking-tight">{opportunity.name}</h1>
			<p class="text-sm text-muted">{formatCents(opportunity.amountCents)}</p>
		</header>
		<section class="card space-y-4 p-4">
			<p class="text-sm">
				<span class="text-muted">Contact</span>
				{#if opportunity.contactId}
					<a class="ml-2 text-brick hover:underline" href={resolve(`/contacts/${opportunity.contactId}`)}>
						{opportunity.contactName ?? 'Contact'}
					</a>
				{:else}
					<span class="ml-2">None</span>
				{/if}
			</p>
			<p class="text-sm">
				<span class="text-muted">Company</span>
				{#if opportunity.companyId}
					<a class="ml-2 text-brick hover:underline" href={resolve(`/companies/${opportunity.companyId}`)}>
						{opportunity.companyName ?? 'Company'}
					</a>
				{:else}
					<span class="ml-2">None</span>
				{/if}
			</p>
			<label class="block text-sm">
				<span class="label">Stage</span>
				<select class="input" value={opportunity.stageId} onchange={move} disabled={moving}>
					{#each stages as stage (stage.id)}
						<option value={stage.id}>{stage.name}</option>
					{/each}
				</select>
			</label>
			<ErrorText {error} />
		</section>
	{/if}
</div>
