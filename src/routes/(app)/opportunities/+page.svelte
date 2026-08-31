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

	let pipeline = $derived(boardQuery.data?.pipelines.find((item) => item.isDefault) ?? boardQuery.data?.pipelines[0]);
	let stages = $derived(pipeline?.stages ?? []);

	function opportunitiesFor(stageId: string) {
		return (boardQuery.data?.opportunities ?? []).filter((item) => item.stageId === stageId);
	}

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

<div class="space-y-6">
	<div>
		<h1 class="text-2xl font-semibold tracking-tight">Pipeline</h1>
		<p class="text-sm text-muted">
			{pipeline?.name ?? 'Sales'} — create a deal and move it through stages.
		</p>
	</div>

	<form class="card grid gap-3 p-4 md:grid-cols-4 md:items-end" {onsubmit}>
		<div>
			<label class="label" for="opp-name">Name</label>
			<input id="opp-name" class="input" bind:value={name} required />
		</div>
		<div>
			<label class="label" for="opp-contact">Contact</label>
			<select id="opp-contact" class="input" bind:value={contactId}>
				<option value="">Optional</option>
				{#each contactsQuery.data?.contacts ?? [] as contact (contact.id)}
					<option value={contact.id}>{contactName(contact)}</option>
				{/each}
			</select>
		</div>
		<div>
			<label class="label" for="opp-amount">Amount USD</label>
			<input id="opp-amount" class="input" bind:value={amount} placeholder="optional" />
		</div>
		<button class="btn" type="submit" disabled={pending}>
			{pending ? 'Creating…' : 'Create opportunity'}
		</button>
		<div class="md:col-span-4"><ErrorText {error} /></div>
	</form>

	{#if boardQuery.isPending}
		<p class="text-sm text-muted">Loading pipeline…</p>
	{:else if boardQuery.isError}
		<ErrorText error={boardQuery.error} />
	{:else}
		<ErrorText error={moveError} />
		<div class="flex gap-3 overflow-x-auto pb-4">
			{#each stages as stage (stage.id)}
				<section class="card flex w-64 shrink-0 flex-col p-3">
					<h2 class="px-1 text-xs font-semibold uppercase tracking-wide text-muted">
						{stage.name}
						<span class="font-normal">({opportunitiesFor(stage.id).length})</span>
					</h2>
					<ul class="mt-3 space-y-2">
						{#each opportunitiesFor(stage.id) as opportunity (opportunity.id)}
							<li class="rounded border border-line bg-canvas p-3">
								<a class="block font-medium hover:text-brick" href={resolve(`/opportunities/${opportunity.id}`)}>
									{opportunity.name}
								</a>
								<p class="mt-1 text-xs text-muted">
									{opportunity.contactName ?? 'No contact'} · {formatCents(opportunity.amountCents)}
								</p>
								<label class="mt-2 block text-[11px] text-muted">
									Move to
									<select
										class="input mt-1"
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
				</section>
			{/each}
		</div>
	{/if}
</div>
