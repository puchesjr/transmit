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

<div class="page-wrap-narrow max-w-3xl">
	<p>
		<a class="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-muted transition hover:text-ink" href={resolve('/opportunities')}><span class="flex size-8 items-center justify-center rounded-lg border border-line bg-paper">←</span> Leads</a>
	</p>

	{#if detailQuery.isPending}
		<p class="text-sm text-muted">Loading lead…</p>
	{:else if detailQuery.isError}
		<ErrorText error={detailQuery.error} />
	{:else if detailQuery.data}
		{@const opportunity = detailQuery.data.opportunity}
		<header class="card overflow-hidden">
			<div class="h-1.5 bg-accent"></div>
			<div class="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
				<div>
					<p class="mb-1.5 text-[10px] font-bold tracking-[0.12em] text-accent uppercase">Lead</p>
					<h1 class="text-2xl font-bold tracking-[-0.04em] sm:text-3xl">{opportunity.name}</h1>
				</div>
				<div class="sm:text-right"><p class="text-[10px] font-bold tracking-[0.1em] text-muted uppercase">Deal value</p><p class="mt-1 text-2xl font-bold tracking-[-0.03em]">{formatCents(opportunity.amountCents)}</p></div>
			</div>
		</header>
		<section class="card overflow-hidden">
			<div class="panel-heading"><h2 class="panel-title">Deal details</h2><span class="badge">Active</span></div>
			<div class="grid gap-5 p-5 sm:grid-cols-2 sm:p-6">
			<div class="rounded-xl bg-canvas p-4 text-sm">
				<span class="block text-[10px] font-bold tracking-wide text-muted uppercase">Customer</span>
				{#if opportunity.contactId}
					<a class="mt-1.5 block font-semibold text-ink hover:text-accent" href={resolve(`/contacts/${opportunity.contactId}`)}>
						{opportunity.contactName ?? 'Customer'}
					</a>
				{:else}
					<span class="mt-1.5 block">None</span>
				{/if}
			</div>
			<div class="rounded-xl bg-canvas p-4 text-sm">
				<span class="block text-[10px] font-bold tracking-wide text-muted uppercase">Company</span>
				{#if opportunity.companyId}
					<a class="mt-1.5 block font-semibold text-ink hover:text-accent" href={resolve(`/companies/${opportunity.companyId}`)}>
						{opportunity.companyName ?? 'Company'}
					</a>
				{:else}
					<span class="mt-1.5 block">None</span>
				{/if}
			</div>
			<label class="block text-sm sm:col-span-2">
				<span class="label">Stage</span>
				<select class="input" value={opportunity.stageId} onchange={move} disabled={moving}>
					{#each stages as stage (stage.id)}
						<option value={stage.id}>{stage.name}</option>
					{/each}
				</select>
			</label>
			<div class="sm:col-span-2"><ErrorText {error} /></div>
			</div>
		</section>
	{/if}
</div>
