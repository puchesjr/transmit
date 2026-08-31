<script lang="ts">
	import { resolve } from '$app/paths';
	import { createQuery, useQueryClient } from '@tanstack/svelte-query';
	import { api } from '$lib/client/api';
	import ErrorText from '$lib/client/ErrorText.svelte';
	import type { Company } from '$lib/types';

	const queryClient = useQueryClient();
	const companiesQuery = createQuery(() => ({
		queryKey: ['companies'],
		queryFn: () => api.get<{ companies: Company[] }>('/api/v1/companies')
	}));

	let name = $state('');
	let domain = $state('');
	let error = $state<unknown>(null);
	let pending = $state(false);

	async function onsubmit(event: SubmitEvent) {
		event.preventDefault();
		error = null;
		pending = true;
		try {
			await api.post('/api/v1/companies', { name, domain });
			name = '';
			domain = '';
			await queryClient.invalidateQueries({ queryKey: ['companies'] });
		} catch (err) {
			error = err;
		} finally {
			pending = false;
		}
	}
</script>

<div class="mx-auto max-w-4xl space-y-6">
	<div>
		<h1 class="text-2xl font-semibold tracking-tight">Companies</h1>
		<p class="text-sm text-muted">Accounts you sell into. Associate them from a contact.</p>
	</div>

	<form class="card grid gap-3 p-4 md:grid-cols-3 md:items-end" {onsubmit}>
		<div>
			<label class="label" for="company-name">Name</label>
			<input id="company-name" class="input" bind:value={name} required />
		</div>
		<div>
			<label class="label" for="company-domain">Domain</label>
			<input id="company-domain" class="input" bind:value={domain} placeholder="example.com" />
		</div>
		<button class="btn" type="submit" disabled={pending}>{pending ? 'Adding…' : 'Add company'}</button>
		<div class="md:col-span-3"><ErrorText {error} /></div>
	</form>

	{#if companiesQuery.isPending}
		<p class="text-sm text-muted">Loading companies…</p>
	{:else if companiesQuery.isError}
		<ErrorText error={companiesQuery.error} />
	{:else if (companiesQuery.data?.companies.length ?? 0) === 0}
		<div class="card p-8 text-sm text-muted">No companies yet.</div>
	{:else}
		<ul class="card divide-y divide-line">
			{#each companiesQuery.data?.companies ?? [] as company (company.id)}
				<li>
					<a
						class="flex items-center justify-between gap-4 px-4 py-3 hover:bg-canvas"
						href={resolve(`/companies/${company.id}`)}
					>
						<span class="font-medium">{company.name}</span>
						<span class="text-sm text-muted">{company.domain ?? ''}</span>
					</a>
				</li>
			{/each}
		</ul>
	{/if}
</div>
