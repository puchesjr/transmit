<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import { createQuery, useQueryClient } from '@tanstack/svelte-query';
	import { api } from '$lib/client/api';
	import ErrorText from '$lib/client/ErrorText.svelte';
	import { contactName, formatCents, formatWhen } from '$lib/format';
	import type { Activity, Company, Contact, Message, Opportunity } from '$lib/types';

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

	const threadQuery = createQuery(() => ({
		queryKey: ['thread', contactId],
		queryFn: () =>
			api.get<{ contact: Contact; messages: Message[] }>(`/api/v1/contacts/${contactId}/messages`),
		enabled: Boolean(contactId),
		refetchInterval: 5000
	}));

	let smsBody = $state('');
	let smsError = $state<unknown>(null);
	let sendingSms = $state(false);

	onMount(() => {
		void api
			.post(`/api/v1/contacts/${contactId}/messages/read`)
			.then(() => queryClient.invalidateQueries({ queryKey: ['conversations'] }))
			.catch(() => {});
	});

	async function sendMessage(event: SubmitEvent) {
		event.preventDefault();
		smsError = null;
		sendingSms = true;
		try {
			await api.post(`/api/v1/contacts/${contactId}/messages`, { body: smsBody });
			smsBody = '';
			await Promise.all([
				queryClient.invalidateQueries({ queryKey: ['thread', contactId] }),
				queryClient.invalidateQueries({ queryKey: ['contact-activities', contactId] }),
				queryClient.invalidateQueries({ queryKey: ['conversations'] })
			]);
		} catch (err) {
			smsError = err;
		} finally {
			sendingSms = false;
		}
	}

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
				<h2 class="section-title">Companies</h2>
				{#if detailQuery.data.companies.length === 0}
					<p class="text-sm text-muted">Not associated yet.</p>
				{:else}
					<ul class="space-y-1 text-sm">
						{#each detailQuery.data.companies as company (company.id)}
							<li>
								<a class="text-accent hover:underline" href={resolve(`/companies/${company.id}`)}>
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
				<h2 class="section-title">Opportunities</h2>
				{#if detailQuery.data.opportunities.length === 0}
					<p class="text-sm text-muted">None yet.</p>
				{:else}
					<ul class="space-y-2 text-sm">
						{#each detailQuery.data.opportunities as opportunity (opportunity.id)}
							<li class="flex items-center justify-between gap-2">
								<a class="text-accent hover:underline" href={resolve(`/opportunities/${opportunity.id}`)}>
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
			<h2 class="section-title">Conversation</h2>
			{#if threadQuery.isPending}
				<p class="mt-3 text-sm text-muted">Loading messages…</p>
			{:else if threadQuery.isError}
				<div class="mt-3"><ErrorText error={threadQuery.error} /></div>
			{:else}
				{#if (threadQuery.data?.messages.length ?? 0) === 0}
					<p class="mt-3 text-sm text-muted">No messages yet.</p>
				{:else}
					<ol class="mt-4 flex flex-col gap-2">
						{#each threadQuery.data?.messages ?? [] as message (message.id)}
							<li
								class={message.direction === 'outbound'
									? 'max-w-[85%] self-end rounded-2xl rounded-br-sm bg-accent px-3.5 py-2 text-sm text-white'
									: 'max-w-[85%] self-start rounded-2xl rounded-bl-sm bg-canvas px-3.5 py-2 text-sm'}
							>
								<p class="whitespace-pre-wrap break-words">{message.body}</p>
								<p
									class={message.direction === 'outbound'
										? 'mt-0.5 text-right text-[10px] text-white/70'
										: 'mt-0.5 text-[10px] text-muted'}
								>
									{formatWhen(message.createdAt)}
									{#if message.direction === 'outbound'}· {message.status}{/if}
								</p>
							</li>
						{/each}
					</ol>
				{/if}
				{#if contact.messagingConsent === 'opted_out'}
					<p class="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
						This contact opted out of SMS. Sending is disabled.
					</p>
				{:else}
					<form class="mt-4 flex gap-2" onsubmit={sendMessage}>
						<input
							class="input"
							placeholder={contact.phone ? 'Text this contact…' : 'Add a phone number to text'}
							bind:value={smsBody}
							disabled={!contact.phone}
						/>
						<button
							class="btn shrink-0"
							type="submit"
							disabled={sendingSms || !smsBody.trim() || !contact.phone}
						>
							Send
						</button>
					</form>
					<div class="mt-2"><ErrorText error={smsError} /></div>
				{/if}
			{/if}
		</section>

		<section class="card p-4">
			<h2 class="section-title">Timeline</h2>
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
