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

<div class="mx-auto max-w-3xl space-y-6">
	<p>
		<a class="text-sm text-muted hover:text-ink" href={resolve('/companies')}>← Companies</a>
	</p>

	{#if detailQuery.isPending}
		<p class="text-sm text-muted">Loading company…</p>
	{:else if detailQuery.isError}
		<ErrorText error={detailQuery.error} />
	{:else if detailQuery.data}
		<header>
			<h1 class="text-2xl font-semibold tracking-tight">{detailQuery.data.company.name}</h1>
			<p class="text-sm text-muted">{detailQuery.data.company.domain ?? 'No domain'}</p>
		</header>
		<section class="card p-4">
			<h2 class="section-title">Contacts</h2>
			{#if detailQuery.data.contacts.length === 0}
				<p class="mt-3 text-sm text-muted">No associated contacts.</p>
			{:else}
				<ul class="mt-3 divide-y divide-line">
					{#each detailQuery.data.contacts as contact (contact.id)}
						<li class="py-2">
							<a class="text-accent hover:underline" href={resolve(`/contacts/${contact.id}`)}>
								{contactName(contact)}
							</a>
							{#if contact.email}
								<span class="ml-2 text-sm text-muted">{contact.email}</span>
							{/if}
						</li>
					{/each}
				</ul>
			{/if}
		</section>
	{/if}
</div>
