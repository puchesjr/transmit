<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { createQuery } from '@tanstack/svelte-query';
	import { api } from '$lib/client/api';
	import ErrorText from '$lib/client/ErrorText.svelte';
	import { contactName } from '$lib/format';
	import type { Company } from '$lib/types';

	let companyId = $derived(page.params.id);

	const detailQuery = createQuery(() => ({
		queryKey: ['company', companyId],
		queryFn: () =>
			api.get<{
				company: Company;
				contacts: { id: string; firstName: string; lastName: string; email: string | null }[];
			}>(`/api/v1/companies/${companyId}`),
		enabled: Boolean(companyId)
	}));
</script>

<div class="page-wrap-narrow">
	<p>
		<a class="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-muted transition hover:text-ink" href={resolve('/companies')}><span class="flex size-8 items-center justify-center rounded-lg border border-line bg-paper">←</span> Companies</a>
	</p>

	{#if detailQuery.isPending}
		<p class="text-sm text-muted">Loading company…</p>
	{:else if detailQuery.isError}
		<ErrorText error={detailQuery.error} />
	{:else if detailQuery.data}
		<header class="card flex items-center gap-4 p-5 sm:p-6">
			<span class="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-action text-xl font-bold text-white shadow-[0_10px_25px_rgba(159,54,8,0.2)]">{(detailQuery.data.company.name.charAt(0) || '#').toUpperCase()}</span>
			<div class="min-w-0">
				<p class="mb-1.5 text-[10px] font-bold tracking-[0.12em] text-accent uppercase">Company profile</p>
				<h1 class="truncate text-2xl font-bold tracking-[-0.04em] sm:text-3xl">{detailQuery.data.company.name}</h1>
				<p class="mt-1 text-sm text-muted">{detailQuery.data.company.domain ?? 'No domain added'}</p>
			</div>
		</header>
		<section class="card overflow-hidden">
			<div class="panel-heading"><h2 class="panel-title">Associated customers</h2><span class="badge">{detailQuery.data.contacts.length}</span></div>
			{#if detailQuery.data.contacts.length === 0}
				<div class="p-6 text-sm text-muted">No associated customers.</div>
			{:else}
				<ul class="divide-y divide-line/70">
					{#each detailQuery.data.contacts as contact (contact.id)}
						<li>
							<a class="list-row" href={resolve(`/contacts/${contact.id}`)}>
								<span class="avatar">{(contactName(contact).charAt(0) || '#').toUpperCase()}</span>
								<span class="min-w-0 flex-1"><span class="block truncate text-sm font-semibold">{contactName(contact)}</span><span class="mt-0.5 block truncate text-xs text-muted">{contact.email ?? 'No email'}</span></span>
								<svg class="size-4 text-muted/45" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="m9 18 6-6-6-6" /></svg>
							</a>
						</li>
					{/each}
				</ul>
			{/if}
		</section>
	{/if}
</div>
