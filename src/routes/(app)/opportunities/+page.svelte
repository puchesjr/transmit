<script lang="ts">
	import { resolve } from '$app/paths';
	import { createQuery, useQueryClient } from '@tanstack/svelte-query';
	import { api } from '$lib/client/api';
	import ErrorText from '$lib/client/ErrorText.svelte';
	import { contactName, formatCents } from '$lib/format';
	import type { Contact, Opportunity, Pipeline } from '$lib/types';

	const queryClient = useQueryClient();
	const boardQuery = createQuery(() => ({
		queryKey: ['opportunities'],
		queryFn: () =>
			api.get<{ opportunities: Opportunity[]; pipelines: Pipeline[] }>('/api/v1/opportunities')
	}));
	const contactsQuery = createQuery(() => ({
		queryKey: ['contacts'],
		queryFn: () => api.get<{ contacts: Contact[] }>('/api/v1/contacts')
	}));

	let name = $state('');
	let contactId = $state('');
	let amount = $state('');
	let error = $state<unknown>(null);
	let pending = $state(false);
	let movingId = $state<string | null>(null);
	let moveError = $state<unknown>(null);
	let quickAddOpen = $state(false);
	let activeStageId = $state<string | null>(null);

	let pipeline = $derived(boardQuery.data?.pipelines.find((item) => item.isDefault) ?? boardQuery.data?.pipelines[0]);
	let stages = $derived(pipeline?.stages ?? []);

	function opportunitiesFor(stageId: string) {
		return (boardQuery.data?.opportunities ?? []).filter((item) => item.stageId === stageId);
	}

	$effect(() => {
		if (activeStageId || stages.length === 0) return;
		activeStageId =
			stages.find((stage) => opportunitiesFor(stage.id).length > 0)?.id ?? stages[0].id;
	});

	async function onsubmit(event: SubmitEvent) {
		event.preventDefault();
		error = null;
		pending = true;
		try {
			const dollars = amount.trim() ? Number(amount) : null;
			const amountCents =
				dollars == null || Number.isNaN(dollars) ? null : Math.round(dollars * 100);
			await api.post('/api/v1/opportunities', {
				name,
				contactId: contactId || null,
				amountCents
			});
			name = '';
			contactId = '';
			amount = '';
			quickAddOpen = false;
			await queryClient.invalidateQueries({ queryKey: ['opportunities'] });
		} catch (err) {
			error = err;
		} finally {
			pending = false;
		}
	}

	async function move(opportunityId: string, stageId: string): Promise<boolean> {
		movingId = opportunityId;
		moveError = null;
		try {
			await api.post(`/api/v1/opportunities/${opportunityId}/stage`, { stageId });
			await queryClient.invalidateQueries({ queryKey: ['opportunities'] });
			await queryClient.invalidateQueries({ queryKey: ['contact'] });
			await queryClient.invalidateQueries({ queryKey: ['contact-activities'] });
			await queryClient.invalidateQueries({ queryKey: ['opportunity'] });
			return true;
		} catch (err) {
			moveError = err;
			return false;
		} finally {
			movingId = null;
		}
	}
</script>

<div class="page-wrap max-w-none">
	<header class="page-header">
		<div>
			<p class="mb-2 text-xs font-bold tracking-[0.12em] text-accent uppercase">Revenue</p>
			<h1 class="page-title">Leads</h1>
			<p class="page-subtitle">{pipeline?.name ?? 'Sales'} · Give every conversation a clear commercial outcome.</p>
		</div>
		<div class="flex items-center gap-2 self-start sm:self-auto">
			{#if boardQuery.data}<span class="badge">{boardQuery.data.opportunities.length} open</span>{/if}
			<span class="md:hidden">
				<button class="btn" type="button" onclick={() => (quickAddOpen = !quickAddOpen)}>
					{quickAddOpen ? 'Close' : 'New lead'}
				</button>
			</span>
		</div>
	</header>

	<form class={`card overflow-hidden ${quickAddOpen ? 'block' : 'hidden'} md:block`} {onsubmit}>
		<div class="panel-heading">
			<div><h2 class="panel-title">Quick add</h2><p class="mt-0.5 text-xs text-muted">Create a lead without leaving the board</p></div>
			<span class="flex size-9 items-center justify-center rounded-xl bg-accent/10 text-accent"><svg class="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14" /></svg></span>
		</div>
		<div class="grid gap-4 p-5 md:grid-cols-[1.2fr_1fr_0.8fr_auto] md:items-end">
			<div>
				<label class="label" for="opp-name">Name</label>
				<input id="opp-name" class="input" placeholder="New lead" bind:value={name} required />
			</div>
			<div>
				<label class="label" for="opp-contact">Customer</label>
				<select id="opp-contact" class="input" bind:value={contactId}>
					<option value="">Optional</option>
					{#each contactsQuery.data?.contacts ?? [] as contact (contact.id)}
						<option value={contact.id}>{contactName(contact)}</option>
					{/each}
				</select>
			</div>
			<div>
				<label class="label" for="opp-amount">Amount USD</label>
				<input id="opp-amount" class="input" bind:value={amount} placeholder="Optional" />
			</div>
			<button class="btn whitespace-nowrap" type="submit" disabled={pending}>
				{pending ? 'Creating…' : 'Create lead'}
			</button>
			<div class="md:col-span-4"><ErrorText {error} /></div>
		</div>
	</form>

	{#if boardQuery.isPending}
		<div class="card p-6 text-sm text-muted">Loading leads…</div>
	{:else if boardQuery.isError}
		<ErrorText error={boardQuery.error} />
	{:else}
		<ErrorText error={moveError} />
		<div class="scrollbar-none -mx-4 flex gap-2 overflow-x-auto px-4 pb-1 md:hidden" aria-label="Lead stages">
			{#each stages as stage (stage.id)}
				<button
					type="button"
					class={`min-h-10 shrink-0 rounded-full px-3.5 text-xs font-bold transition ${
						activeStageId === stage.id
							? 'bg-sidebar text-white shadow-sm'
							: 'border border-line bg-paper text-muted'
					}`}
					onclick={() => (activeStageId = stage.id)}
				>
					{stage.name} · {opportunitiesFor(stage.id).length}
				</button>
			{/each}
		</div>
		<!-- svelte-ignore a11y_no_noninteractive_tabindex (Scrollable regions must be keyboard-focusable.) -->
		<div class="grid gap-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent md:-mx-6 md:flex md:overflow-x-auto md:px-6 md:pb-4 xl:mx-0 xl:grid xl:grid-cols-5 xl:px-0" role="region" aria-label="Lead pipeline board" tabindex="0">
			{#each stages as stage (stage.id)}
				<section class={`${activeStageId === stage.id ? 'flex' : 'hidden'} min-h-52 min-w-0 flex-col rounded-2xl border border-line/80 bg-ink/[0.025] p-3.5 md:flex md:min-h-64 md:w-[286px] md:shrink-0 xl:w-auto`}>
					<div class="flex items-center justify-between gap-3 px-1 py-1">
						<h2 class="text-xs font-bold tracking-[0.04em] text-ink uppercase">
							{stage.name} <span class="text-muted">({opportunitiesFor(stage.id).length})</span>
						</h2>
						<span class="size-2 rounded-full bg-accent/70"></span>
					</div>
					<ul class="mt-3 space-y-2.5">
						{#each opportunitiesFor(stage.id) as opportunity (opportunity.id)}
							<li class="rounded-2xl border border-line/80 bg-paper p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition hover:-translate-y-0.5 hover:shadow-[0_10px_24px_rgba(15,23,42,0.08)]">
								<a class="block text-sm font-semibold tracking-[-0.01em] hover:text-accent" href={resolve(`/opportunities/${opportunity.id}`)}>
									{opportunity.name}
								</a>
								<div class="mt-3 flex items-center justify-between gap-2 border-b border-line/70 pb-3 text-xs text-muted">
									<span class="truncate">{opportunity.contactName ?? 'No contact'}</span>
									<span class="font-semibold text-ink">{formatCents(opportunity.amountCents)}</span>
								</div>
								<label class="mt-3 block text-[10px] font-bold tracking-wide text-muted uppercase">
									Move to
									<select
										class="input mt-1.5 min-h-9 py-1.5 text-xs"
										disabled={movingId === opportunity.id}
										onchange={async (event) => {
											const select = event.currentTarget as HTMLSelectElement;
											const value = select.value;
											if (value === opportunity.stageId) return;
											const moved = await move(opportunity.id, value);
											if (!moved) select.value = opportunity.stageId;
										}}
									>
										{#each stages as option (option.id)}
											<option value={option.id} selected={option.id === opportunity.stageId}>
												{option.name}
											</option>
										{/each}
									</select>
								</label>
							</li>
						{/each}
					</ul>
					{#if opportunitiesFor(stage.id).length === 0}
						<div class="flex flex-1 items-center justify-center rounded-xl border border-dashed border-line/80 bg-paper/45 p-5 text-center">
							<p class="text-xs leading-5 text-muted">No leads in this stage.</p>
						</div>
					{/if}
				</section>
			{/each}
		</div>
	{/if}
</div>
