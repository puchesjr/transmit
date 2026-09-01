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
	let createOpen = $state(false);

	async function onsubmit(event: SubmitEvent) {
		event.preventDefault();
		error = null;
		pending = true;
		try {
			await api.post('/api/v1/companies', { name, domain });
			name = '';
			domain = '';
			createOpen = false;
			await queryClient.invalidateQueries({ queryKey: ['companies'] });
		} catch (err) {
			error = err;
		} finally {
			pending = false;
		}
	}
</script>

<div class="page-wrap">
	<header class="page-header">
		<div>
			<p class="mb-2 text-xs font-bold tracking-[0.12em] text-accent uppercase">Organizations</p>
			<h1 class="page-title">Companies</h1>
			<p class="page-subtitle">Keep the people connected to every account you work with.</p>
		</div>
		<div class="flex items-center gap-2 self-start sm:self-auto">
			{#if companiesQuery.data}<span class="badge">{companiesQuery.data.companies.length} total</span>{/if}
			<span class="lg:hidden">
				<button class="btn" type="button" onclick={() => (createOpen = !createOpen)}>
					{createOpen ? 'Close' : 'New company'}
				</button>
			</span>
		</div>
	</header>

	<div class="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
		<section>
			{#if companiesQuery.isPending}
				<div class="card p-6 text-sm text-muted">Loading companies…</div>
			{:else if companiesQuery.isError}
				<div class="card p-6"><ErrorText error={companiesQuery.error} /></div>
			{:else if (companiesQuery.data?.companies.length ?? 0) === 0}
				<div class="empty-state">
					<span class="avatar mb-4 size-12">
						<svg class="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M3 21h18M5 21V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16M9 8h1M14 8h1M9 12h1M14 12h1" /></svg>
					</span>
					<p class="font-semibold text-ink">No companies yet</p>
					<p class="mt-1 text-sm text-muted">Add an organization and associate customers from their profile.</p>
				</div>
			{:else}
				<div class="card overflow-hidden">
					<div class="panel-heading"><h2 class="panel-title">All companies</h2><span class="text-xs text-muted">Account directory</span></div>
					<ul class="divide-y divide-line/70">
						{#each companiesQuery.data?.companies ?? [] as company (company.id)}
							<li>
								<a class="list-row" href={resolve(`/companies/${company.id}`)}>
									<span class="avatar">{(company.name.charAt(0) || '#').toUpperCase()}</span>
									<span class="min-w-0 flex-1">
										<span class="block truncate text-sm font-semibold">{company.name}</span>
										<span class="mt-0.5 block truncate text-xs text-muted">{company.domain ?? 'No domain added'}</span>
									</span>
									<svg class="size-4 text-muted/45" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="m9 18 6-6-6-6" /></svg>
								</a>
							</li>
						{/each}
					</ul>
				</div>
			{/if}
		</section>

		<form class={`card overflow-hidden lg:sticky lg:top-8 lg:block ${createOpen ? 'block' : 'hidden'}`} {onsubmit}>
			<div class="panel-heading">
				<div><h2 class="panel-title">New company</h2><p class="mt-0.5 text-xs text-muted">Add an organization</p></div>
				<span class="flex size-9 items-center justify-center rounded-xl bg-accent/10 text-accent"><svg class="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14" /></svg></span>
			</div>
			<div class="space-y-4 p-5">
				<div>
					<label class="label" for="company-name">Name</label>
					<input id="company-name" class="input" placeholder="Acme Services" bind:value={name} required />
				</div>
				<div>
					<label class="label" for="company-domain">Domain</label>
					<input id="company-domain" class="input" bind:value={domain} placeholder="example.com" />
				</div>
				<ErrorText {error} />
				<button class="btn w-full" type="submit" disabled={pending}>{pending ? 'Adding…' : 'Add company'}</button>
			</div>
		</form>
	</div>
</div>
