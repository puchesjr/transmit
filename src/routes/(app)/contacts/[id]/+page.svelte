<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import { createQuery, useQueryClient } from '@tanstack/svelte-query';
	import { api } from '$lib/client/api';
	import ErrorText from '$lib/client/ErrorText.svelte';
	import { contactName, formatCents, formatWhen } from '$lib/format';
	import type {
		Activity,
		AiArtifact,
		AiSummaryContent,
		Company,
		Contact,
		Message,
		Opportunity
	} from '$lib/types';

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

	const aiSummaryQuery = createQuery(() => ({
		queryKey: ['ai-summary', contactId],
		queryFn: () =>
			api.get<{ artifact: AiArtifact | null }>(`/api/v1/ai/contacts/${contactId}/summary`),
		enabled: Boolean(contactId)
	}));

	let summaryArtifact = $derived(aiSummaryQuery.data?.artifact ?? null);
	let aiSummary = $derived(
		summaryArtifact?.kind === 'summary'
			? (summaryArtifact.content as AiSummaryContent)
			: null
	);
	let latestMessageId = $derived(threadQuery.data?.messages.at(-1)?.id ?? null);
	let summaryIsCurrent = $derived(
		summaryArtifact?.status === 'ready' && summaryArtifact.sourceLastMessageId === latestMessageId
	);
	let generatingSummary = $state(false);
	let summaryError = $state<unknown>(null);

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
				queryClient.invalidateQueries({ queryKey: ['conversations'] }),
				queryClient.invalidateQueries({ queryKey: ['ai-summary', contactId] })
			]);
		} catch (err) {
			smsError = err;
		} finally {
			sendingSms = false;
		}
	}

	async function generateSummary() {
		generatingSummary = true;
		summaryError = null;
		try {
			await api.post(`/api/v1/ai/contacts/${contactId}/summary`);
			await Promise.all([
				queryClient.invalidateQueries({ queryKey: ['ai-summary', contactId] }),
				queryClient.invalidateQueries({ queryKey: ['contact-activities', contactId] })
			]);
		} catch (error) {
			summaryError = error;
		} finally {
			generatingSummary = false;
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

<div class="page-wrap max-w-6xl">
	<p>
		<a class="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-muted transition hover:text-ink" href={resolve('/contacts')}>
			<span class="flex size-8 items-center justify-center rounded-lg border border-line bg-paper">←</span> Customers
		</a>
	</p>

	{#if detailQuery.isPending}
		<p class="text-sm text-muted">Loading customer…</p>
	{:else if detailQuery.isError}
		<ErrorText error={detailQuery.error} />
	{:else if detailQuery.data}
		{@const contact = detailQuery.data.contact}
		<header class="card grid grid-cols-[auto_minmax(0,1fr)] items-center gap-4 p-4 sm:flex sm:gap-5 sm:p-6">
			<span class="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-action text-xl font-bold text-white shadow-[0_10px_25px_rgba(159,54,8,0.2)]">
				{(contactName(contact).charAt(0) || '#').toUpperCase()}
			</span>
			<div class="min-w-0 flex-1">
				<p class="mb-1.5 text-[10px] font-bold tracking-[0.12em] text-accent uppercase">Customer profile</p>
				<h1 class="text-2xl font-bold tracking-[-0.04em] sm:text-3xl">{contactName(contact)}</h1>
				<div class="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted">
					<span>{contact.email ?? 'No email'}</span>
					{#if contact.phone}<span>{contact.phone}</span>{/if}
				</div>
			</div>
			<span class={`badge col-span-2 self-start sm:self-auto ${contact.messagingConsent === 'opted_out' ? 'bg-red-50 text-red-700 dark:bg-red-950/50 dark:text-red-300' : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/45 dark:text-emerald-300'}`}>
				<span class={`mr-1.5 size-1.5 rounded-full ${contact.messagingConsent === 'opted_out' ? 'bg-red-500' : 'bg-emerald-500'}`}></span>
				{contact.messagingConsent === 'opted_out' ? 'SMS opted out' : 'SMS enabled'}
			</span>
		</header>

		<section class="card overflow-hidden border-accent/20">
			<div class="panel-heading flex-col items-stretch bg-accent/[0.035] sm:flex-row sm:items-center dark:bg-accent/[0.06]">
				<div class="flex items-center gap-3">
					<span class="flex size-9 items-center justify-center rounded-xl bg-accent text-sm font-bold text-white" aria-hidden="true">✦</span>
					<div>
						<h2 class="panel-title">AI customer brief</h2>
						<p class="mt-0.5 text-xs text-muted">Intent, urgency, and the next best communication step.</p>
					</div>
				</div>
				<button class="btn-secondary w-full px-3 py-2 text-xs sm:min-h-9 sm:w-auto" type="button" onclick={generateSummary} disabled={generatingSummary || (threadQuery.data?.messages.length ?? 0) === 0}>
					{generatingSummary ? 'Summarizing…' : summaryIsCurrent ? 'Refresh brief' : 'Summarize conversation'}
				</button>
			</div>
			<div class="p-5 sm:p-6">
				{#if summaryIsCurrent && aiSummary}
					<div class="grid gap-5 lg:grid-cols-[1.35fr_0.65fr]">
						<div>
							<div class="flex flex-wrap items-center gap-2">
								<span class={`badge ${aiSummary.urgency === 'high' ? 'bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-200' : aiSummary.urgency === 'medium' ? 'bg-amber-100 text-amber-900 dark:bg-amber-950/60 dark:text-amber-200' : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200'}`}>
									{aiSummary.urgency} urgency
								</span>
								<span class="text-xs font-semibold text-ink">{aiSummary.intent}</span>
							</div>
							<p class="mt-3 text-sm leading-6 text-ink">{aiSummary.summary}</p>
							{#if aiSummary.facts.length > 0}
								<ul class="mt-3 space-y-1 text-xs leading-5 text-muted">
									{#each aiSummary.facts as fact (fact)}<li>• {fact}</li>{/each}
								</ul>
							{/if}
						</div>
						<div class="rounded-2xl bg-sidebar p-4 text-white">
							<p class="text-[10px] font-bold tracking-[0.11em] text-white/65 uppercase">Recommended next action</p>
							<p class="mt-2 text-sm leading-6 text-white/85">{aiSummary.nextAction}</p>
						</div>
					</div>
				{:else if summaryArtifact && !summaryIsCurrent}
					<p class="text-sm text-muted">The conversation changed after this brief was created. Refresh it for current guidance.</p>
				{:else}
					<p class="text-sm text-muted">
						{(threadQuery.data?.messages.length ?? 0) > 0
							? 'Create a concise brief from the real conversation when your team needs context.'
							: 'A brief becomes available after the first customer conversation.'}
					</p>
				{/if}
				{#if summaryError}<div class="mt-3"><ErrorText error={summaryError} /></div>{/if}
			</div>
		</section>

		<section class="grid gap-6 lg:grid-cols-2">
			<div class="card overflow-hidden">
				<div class="panel-heading"><h2 class="panel-title">Companies</h2><span class="badge">{detailQuery.data.companies.length}</span></div>
				<div class="space-y-4 p-5">
				{#if detailQuery.data.companies.length === 0}
					<p class="text-sm text-muted">Not associated yet.</p>
				{:else}
					<ul class="space-y-2 text-sm">
						{#each detailQuery.data.companies as company (company.id)}
							<li class="rounded-xl bg-canvas px-3 py-2.5">
								<a class="font-semibold text-ink hover:text-accent" href={resolve(`/companies/${company.id}`)}>
									{company.name}
								</a>
							</li>
						{/each}
					</ul>
				{/if}
				<form class="flex flex-col gap-2 sm:flex-row" onsubmit={associate}>
					<select class="input" aria-label="Company to associate" bind:value={companyId}>
						<option value="">Associate existing…</option>
						{#each availableCompanies as company (company.id)}
							<option value={company.id}>{company.name}</option>
						{/each}
					</select>
					<button class="btn-secondary w-full shrink-0 sm:w-auto" type="submit" disabled={associating || !companyId}>
						Associate
					</button>
				</form>
				<ErrorText error={associateError} />
				<form class="flex flex-col gap-2 sm:flex-row" onsubmit={createCompany}>
					<input class="input" aria-label="New company name" placeholder="New company name" bind:value={newCompanyName} />
					<button class="btn-secondary w-full shrink-0 sm:w-auto" type="submit" disabled={creatingCompany}>
						Create
					</button>
				</form>
				<ErrorText error={companyError} />
				</div>
			</div>

			<div class="card overflow-hidden">
				<div class="panel-heading"><h2 class="panel-title">Leads</h2><span class="badge">{detailQuery.data.opportunities.length}</span></div>
				<div class="space-y-4 p-5">
				{#if detailQuery.data.opportunities.length === 0}
					<p class="text-sm text-muted">None yet.</p>
				{:else}
					<ul class="space-y-2 text-sm">
						{#each detailQuery.data.opportunities as opportunity (opportunity.id)}
							<li class="flex flex-col items-start gap-1.5 rounded-xl bg-canvas px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
								<a class="min-w-0 truncate font-semibold text-ink hover:text-accent" href={resolve(`/opportunities/${opportunity.id}`)}>
									{opportunity.name}
								</a>
								<span class="text-xs text-muted sm:shrink-0">{opportunity.stageName} · {formatCents(opportunity.amountCents)}</span>
							</li>
						{/each}
					</ul>
				{/if}
				<form class="space-y-2" onsubmit={createOpportunity}>
					<input class="input" aria-label="Opportunity name" placeholder="Opportunity name" bind:value={oppName} required />
					<input class="input" aria-label="Amount in USD (optional)" placeholder="Amount USD (optional)" bind:value={oppAmount} />
					<button class="btn w-full sm:w-auto" type="submit" disabled={creatingOpp}>Create lead</button>
				</form>
				<ErrorText error={oppError} />
				</div>
			</div>
		</section>

		<section class="card overflow-hidden">
			<div class="panel-heading">
				<div><h2 class="panel-title">Conversation</h2><p class="mt-0.5 text-xs text-muted">Two-way SMS with {contactName(contact)}</p></div>
				<span class="flex size-9 items-center justify-center rounded-xl bg-accent/10 text-accent"><svg class="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg></span>
			</div>
			<div class="bg-canvas/55 p-4 sm:p-6">
			{#if threadQuery.isPending}
				<p class="text-sm text-muted">Loading messages…</p>
			{:else if threadQuery.isError}
				<ErrorText error={threadQuery.error} />
			{:else}
				{#if (threadQuery.data?.messages.length ?? 0) === 0}
					<div class="py-8 text-center"><p class="text-sm font-semibold">No messages yet</p><p class="mt-1 text-xs text-muted">Start the conversation below.</p></div>
				{:else}
					<ol class="flex flex-col gap-2.5">
						{#each threadQuery.data?.messages ?? [] as message (message.id)}
							<li
								class={message.direction === 'outbound'
									? 'message-out'
									: 'message-in'}
							>
								<p class="whitespace-pre-wrap break-words">{message.body}</p>
								<p
									class={message.direction === 'outbound'
										? 'mt-1 text-right text-[10px] text-white/55'
										: 'mt-1 text-[10px] text-muted'}
								>
									{formatWhen(message.createdAt)}
									{#if message.direction === 'outbound'}· {message.status}{/if}
								</p>
							</li>
						{/each}
					</ol>
				{/if}
				{#if contact.messagingConsent === 'opted_out'}
					<p class="mt-4 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-medium text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
						This customer opted out of SMS. Sending is disabled.
					</p>
				{:else}
					<form class="mt-5 flex gap-2 rounded-2xl border border-line bg-paper p-1.5 shadow-sm" onsubmit={sendMessage}>
						<input
							class="min-w-0 flex-1 bg-transparent px-3 py-2 text-sm text-ink outline-none placeholder:text-muted"
							aria-label="Message"
							placeholder={contact.phone ? 'Text this customer…' : 'Add a phone number to text'}
							bind:value={smsBody}
							disabled={!contact.phone}
						/>
						<button
							class="btn min-h-9 shrink-0 rounded-xl px-4 py-2"
							type="submit"
							disabled={sendingSms || !smsBody.trim() || !contact.phone}
						>
							Send
						</button>
					</form>
					<div class="mt-2"><ErrorText error={smsError} /></div>
				{/if}
			{/if}
			</div>
		</section>

		<section class="card overflow-hidden">
			<div class="panel-heading"><h2 class="panel-title">Timeline</h2><span class="text-xs text-muted">Recent activity</span></div>
			<div class="p-5 sm:p-6">
			{#if timelineQuery.isPending}
				<p class="text-sm text-muted">Loading activity…</p>
			{:else if timelineQuery.isError}
				<ErrorText error={timelineQuery.error} />
			{:else if (timelineQuery.data?.activities.length ?? 0) === 0}
				<p class="text-sm text-muted">No activity yet.</p>
			{:else}
				<ol class="space-y-1">
					{#each timelineQuery.data?.activities ?? [] as activity (activity.id)}
						<li class="relative ml-2 border-l border-line py-3 pl-7 last:border-transparent">
							<span class="absolute top-[18px] -left-[5px] size-2.5 rounded-full border-2 border-paper bg-accent ring-1 ring-line"></span>
							<p class="text-sm font-medium">{activity.summary}</p>
							<p class="mt-0.5 text-xs text-muted">{formatWhen(activity.createdAt)}</p>
						</li>
					{/each}
				</ol>
			{/if}
			</div>
		</section>
	{/if}
</div>
