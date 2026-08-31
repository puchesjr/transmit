<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { createQuery, useQueryClient } from '@tanstack/svelte-query';
	import { api } from '$lib/client/api';
	import ErrorText from '$lib/client/ErrorText.svelte';
	import { contactName, formatCents, formatWhen } from '$lib/format';
	import type { Activity, Company, Contact, Opportunity } from '$lib/types';

	const queryClient = useQueryClient();
	let contactId = $derived(page.params.id);

	const detailQuery = createQuery(() => ({
		queryKey: ['contact', contactId],
		queryFn: () =>
			api.get<{ contact: Contact; companies: Company[]; opportunities: Opportunity[] }>(
				`/api/v1/contacts/${contactId}`
			),
		enabled: Boolean(contactId)
	}));

	const companiesQuery = createQuery(() => ({
		queryKey: ['companies'],
		queryFn: () => api.get<{ companies: Company[] }>('/api/v1/companies')
	}));

	const timelineQuery = createQuery(() => ({
		queryKey: ['contact-activities', contactId],
		queryFn: () => api.get<{ activities: Activity[] }>(`/api/v1/contacts/${contactId}/activities`),
		enabled: Boolean(contactId)
	}));

	let companyId = $state('');
	let newCompanyName = $state('');
	let oppName = $state('');
	let oppAmount = $state('');
	let associateError = $state<unknown>(null);
	let companyError = $state<unknown>(null);
	let oppError = $state<unknown>(null);
	let associating = $state(false);
	let creatingCompany = $state(false);
	let creatingOpp = $state(false);

	async function refresh() {
		await Promise.all([
			queryClient.invalidateQueries({ queryKey: ['contact', contactId] }),
			queryClient.invalidateQueries({ queryKey: ['contact-activities', contactId] }),
			queryClient.invalidateQueries({ queryKey: ['companies'] }),
			queryClient.invalidateQueries({ queryKey: ['opportunities'] })
		]);
	}

	async function associate(event: SubmitEvent) {
		event.preventDefault();
		if (!companyId) return;
		associateError = null;
		associating = true;
		try {
			await api.post(`/api/v1/contacts/${contactId}/companies`, { companyId });
			companyId = '';
			await refresh();
		} catch (err) {
			associateError = err;
		} finally {
			associating = false;
		}
	}

	async function createCompany(event: SubmitEvent) {
		event.preventDefault();
		companyError = null;
		creatingCompany = true;
		try {
			await api.post('/api/v1/companies', { name: newCompanyName, contactId });
			newCompanyName = '';
			await refresh();
		} catch (err) {
			companyError = err;
		} finally {
			creatingCompany = false;
		}
	}

	async function createOpportunity(event: SubmitEvent) {
		event.preventDefault();
		oppError = null;
		creatingOpp = true;
		try {
			const dollars = oppAmount.trim() ? Number(oppAmount) : null;
			const amountCents =
				dollars == null || Number.isNaN(dollars) ? null : Math.round(dollars * 100);
			await api.post('/api/v1/opportunities', {
				name: oppName,
				contactId,
				amountCents
			});
			oppName = '';
			oppAmount = '';
			await refresh();
		} catch (err) {
			oppError = err;
		} finally {
			creatingOpp = false;
		}
	}

	let associatedIds = $derived(new Set(detailQuery.data?.companies.map((c) => c.id) ?? []));
	let availableCompanies = $derived(
		(companiesQuery.data?.companies ?? []).filter((company) => !associatedIds.has(company.id))
	);
</script>

<div class="mx-auto max-w-4xl space-y-6">
	<p>
		<a class="text-sm text-muted hover:text-ink" href={resolve('/contacts')}>← Contacts</a>
	</p>

	{#if detailQuery.isPending}
		<p class="text-sm text-muted">Loading contact…</p>
	{:else if detailQuery.isError}
		<ErrorText error={detailQuery.error} />
	{:else if detailQuery.data}
		{@const contact = detailQuery.data.contact}
		<header class="space-y-1">
			<h1 class="text-2xl font-semibold tracking-tight">{contactName(contact)}</h1>
			<p class="text-sm text-muted">
				{contact.email ?? 'No email'}
				{#if contact.phone} · {contact.phone}{/if}
			</p>
		</header>

		<section class="grid gap-6 md:grid-cols-2">
			<div class="card p-4 space-y-4">
				<h2 class="text-sm font-semibold uppercase tracking-wide text-muted">Companies</h2>
				{#if detailQuery.data.companies.length === 0}
					<p class="text-sm text-muted">Not associated yet.</p>
				{:else}
					<ul class="space-y-1 text-sm">
						{#each detailQuery.data.companies as company (company.id)}
							<li>
								<a class="text-brick hover:underline" href={resolve(`/companies/${company.id}`)}>
									{company.name}
								</a>
							</li>
						{/each}
					</ul>
				{/if}
				<form class="flex gap-2" onsubmit={associate}>
					<select class="input" bind:value={companyId}>
						<option value="">Associate existing…</option>
						{#each availableCompanies as company (company.id)}
							<option value={company.id}>{company.name}</option>
						{/each}
					</select>
					<button class="btn-secondary shrink-0" type="submit" disabled={associating || !companyId}>
						Associate
					</button>
				</form>
				<ErrorText error={associateError} />
				<form class="flex gap-2" onsubmit={createCompany}>
					<input class="input" placeholder="New company name" bind:value={newCompanyName} />
					<button class="btn-secondary shrink-0" type="submit" disabled={creatingCompany}>
						Create
					</button>
				</form>
				<ErrorText error={companyError} />
			</div>

			<div class="card p-4 space-y-4">
				<h2 class="text-sm font-semibold uppercase tracking-wide text-muted">Opportunities</h2>
				{#if detailQuery.data.opportunities.length === 0}
					<p class="text-sm text-muted">None yet.</p>
				{:else}
					<ul class="space-y-2 text-sm">
						{#each detailQuery.data.opportunities as opportunity (opportunity.id)}
							<li class="flex items-center justify-between gap-2">
								<a class="text-brick hover:underline" href={resolve(`/opportunities/${opportunity.id}`)}>
									{opportunity.name}
								</a>
								<span class="text-muted">{opportunity.stageName} · {formatCents(opportunity.amountCents)}</span>
							</li>
						{/each}
					</ul>
				{/if}
				<form class="space-y-2" onsubmit={createOpportunity}>
					<input class="input" placeholder="Opportunity name" bind:value={oppName} required />
					<input class="input" placeholder="Amount USD (optional)" bind:value={oppAmount} />
					<button class="btn" type="submit" disabled={creatingOpp}>Create opportunity</button>
				</form>
				<ErrorText error={oppError} />
			</div>
		</section>

		<section class="card p-4">
			<h2 class="text-sm font-semibold uppercase tracking-wide text-muted">Timeline</h2>
			{#if timelineQuery.isPending}
				<p class="mt-3 text-sm text-muted">Loading activity…</p>
			{:else if timelineQuery.isError}
				<div class="mt-3"><ErrorText error={timelineQuery.error} /></div>
			{:else if (timelineQuery.data?.activities.length ?? 0) === 0}
				<p class="mt-3 text-sm text-muted">No activity yet.</p>
			{:else}
				<ol class="mt-4 space-y-4">
					{#each timelineQuery.data?.activities ?? [] as activity (activity.id)}
						<li class="border-l-2 border-line pl-4">
							<p class="text-sm">{activity.summary}</p>
							<p class="text-xs text-muted">{formatWhen(activity.createdAt)}</p>
						</li>
					{/each}
				</ol>
			{/if}
		</section>
	{/if}
</div>
