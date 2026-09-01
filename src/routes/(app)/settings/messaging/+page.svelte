<script lang="ts">
	import { createQuery, useQueryClient } from '@tanstack/svelte-query';
	import { api } from '$lib/client/api';
	import ErrorText from '$lib/client/ErrorText.svelte';
	import VoiceSettings from '$lib/client/VoiceSettings.svelte';
	import SettingsNav from '$lib/client/SettingsNav.svelte';
	import type { MessagingRegistration, PhoneNumber } from '$lib/types';

	const queryClient = useQueryClient();

	const registrationQuery = createQuery(() => ({
		queryKey: ['messaging-registration'],
		queryFn: () =>
			api.get<{ registration: MessagingRegistration | null }>('/api/v1/messaging/registration')
	}));
	const numbersQuery = createQuery(() => ({
		queryKey: ['phone-numbers'],
		queryFn: () => api.get<{ numbers: PhoneNumber[] }>('/api/v1/messaging/numbers')
	}));

	let legalName = $state('');
	let ein = $state('');
	let website = $state('');
	let address = $state('');
	let contactEmail = $state('');
	let useCase = $state('Customer service and appointment follow-ups for our business.');
	let sampleMessage = $state('Hi {name}, thanks for reaching out — how can we help? Reply STOP to opt out.');
	let registrationError = $state<unknown>(null);
	let submitting = $state(false);
	let refreshing = $state(false);

	let areaCode = $state('');
	let searchResults = $state<{ e164: string }[]>([]);
	let searchError = $state<unknown>(null);
	let searching = $state(false);
	let buyingE164 = $state<string | null>(null);
	let buyError = $state<unknown>(null);

	let registration = $derived(registrationQuery.data?.registration ?? null);
	let numbers = $derived(numbersQuery.data?.numbers ?? []);

	async function submitRegistration(event: SubmitEvent) {
		event.preventDefault();
		registrationError = null;
		submitting = true;
		try {
			await api.post('/api/v1/messaging/registration', {
				legalName,
				ein,
				website,
				address,
				contactEmail,
				useCase,
				sampleMessage
			});
			await queryClient.invalidateQueries({ queryKey: ['messaging-registration'] });
		} catch (err) {
			registrationError = err;
		} finally {
			submitting = false;
		}
	}

	async function refreshStatus() {
		refreshing = true;
		registrationError = null;
		try {
			await api.post('/api/v1/messaging/registration/refresh');
			await queryClient.invalidateQueries({ queryKey: ['messaging-registration'] });
		} catch (err) {
			registrationError = err;
		} finally {
			refreshing = false;
		}
	}

	async function search(event: SubmitEvent) {
		event.preventDefault();
		searchError = null;
		searching = true;
		try {
			const result = await api.post<{ numbers: { e164: string }[] }>(
				'/api/v1/messaging/numbers/search',
				{ areaCode }
			);
			searchResults = result.numbers;
		} catch (err) {
			searchError = err;
		} finally {
			searching = false;
		}
	}

	async function buy(e164: string) {
		buyError = null;
		buyingE164 = e164;
		try {
			await api.post('/api/v1/messaging/numbers', { e164 });
			searchResults = [];
			await queryClient.invalidateQueries({ queryKey: ['phone-numbers'] });
		} catch (err) {
			buyError = err;
		} finally {
			buyingE164 = null;
		}
	}

	const statusStyles: Record<string, string> = {
		approved:
			'bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200 dark:bg-emerald-950/45 dark:text-emerald-300 dark:ring-emerald-900',
		submitted:
			'bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200 dark:bg-amber-950/45 dark:text-amber-300 dark:ring-amber-900',
		rejected:
			'bg-red-50 text-red-700 ring-1 ring-inset ring-red-200 dark:bg-red-950/45 dark:text-red-300 dark:ring-red-900'
	};
</script>

<div class="page-wrap max-w-5xl">
	<SettingsNav />
	<header class="page-header">
		<div>
			<p class="mb-2 text-xs font-bold tracking-[0.12em] text-accent uppercase">Workspace settings</p>
			<h1 class="page-title">Communications</h1>
			<p class="page-subtitle">Connect the local number your team uses for customer texts and calls.</p>
		</div>
		<span class={`badge self-start sm:self-auto ${registration?.status === 'approved' ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/45 dark:text-emerald-300' : ''}`}>
			<span class={`mr-1.5 size-1.5 rounded-full ${registration?.status === 'approved' ? 'bg-emerald-500' : 'bg-amber-500'}`}></span>
			{registration?.status === 'approved' ? 'Ready to text' : 'Setup required'}
		</span>
	</header>

	<div class="grid gap-4 sm:grid-cols-3">
		<div class="card flex items-center gap-4 p-4">
			<span class={`flex size-10 items-center justify-center rounded-xl text-sm font-bold ${registration ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/45 dark:text-emerald-300' : 'bg-accent/10 text-accent'}`}>{registration ? '✓' : '1'}</span>
			<div><p class="text-sm font-semibold">Carrier registration</p><p class="mt-0.5 text-xs text-muted">Business identity and use case</p></div>
		</div>
		<div class="card flex items-center gap-4 p-4">
			<span class={`flex size-10 items-center justify-center rounded-xl text-sm font-bold ${numbers.length > 0 ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/45 dark:text-emerald-300' : 'bg-ink/[0.05] text-muted'}`}>{numbers.length > 0 ? '✓' : '2'}</span>
			<div><p class="text-sm font-semibold">Phone number</p><p class="mt-0.5 text-xs text-muted">One local number per location</p></div>
		</div>
		<div class="card flex items-center gap-4 p-4">
			<span class={`flex size-10 items-center justify-center rounded-xl text-sm font-bold ${numbers.length > 0 ? 'bg-accent/10 text-accent' : 'bg-ink/[0.05] text-muted'}`}>3</span>
			<div><p class="text-sm font-semibold">Call routing</p><p class="mt-0.5 text-xs text-muted">Forwarding and textback</p></div>
		</div>
	</div>

	<section class="card overflow-hidden">
		<div class="panel-heading">
			<div><h2 class="panel-title">Carrier registration</h2><p class="mt-0.5 text-xs text-muted">Required for compliant business texting</p></div>
			<span class="flex size-9 items-center justify-center rounded-xl bg-accent/10 text-accent"><svg class="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M3 21h18M5 21V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16M9 8h1M14 8h1M9 12h1M14 12h1" /></svg></span>
		</div>
		<div class="p-5 sm:p-6">

		{#if registrationQuery.isPending}
			<p class="text-sm text-muted">Loading…</p>
		{:else if registration}
			<div class="flex flex-wrap items-center gap-3 rounded-2xl bg-canvas p-4">
				<span
					class={`rounded-full px-2.5 py-1 text-[11px] font-bold capitalize ${statusStyles[registration.status] ?? ''}`}
				>
					{registration.status}
				</span>
				<span class="text-sm font-semibold">{registration.legalName}</span>
				{#if registration.status !== 'approved'}
					<button class="btn-secondary ml-auto min-h-9 px-3 py-2 text-xs" onclick={refreshStatus} disabled={refreshing}>
						{refreshing ? 'Checking…' : 'Check status'}
					</button>
				{/if}
			</div>
			{#if registration.status === 'submitted'}
				<p class="text-sm text-muted">
					Carrier review usually takes a few business days. Sending is disabled until approval.
				</p>
			{:else if registration.status === 'rejected'}
				<p class="text-sm text-red-600 dark:text-red-300">
					Rejected{registration.rejectionReason ? `: ${registration.rejectionReason}` : ''}. Contact
					support to resubmit.
				</p>
			{/if}
			<ErrorText error={registrationError} />
		{:else}
			<form class="grid gap-4 md:grid-cols-2" onsubmit={submitRegistration}>
				<div>
					<label class="label" for="reg-legal">Legal business name</label>
					<input id="reg-legal" class="input" bind:value={legalName} required />
				</div>
				<div>
					<label class="label" for="reg-ein">EIN (optional)</label>
					<input id="reg-ein" class="input" bind:value={ein} />
				</div>
				<div>
					<label class="label" for="reg-website">Website (optional)</label>
					<input id="reg-website" class="input" bind:value={website} />
				</div>
				<div>
					<label class="label" for="reg-email">Contact email</label>
					<input id="reg-email" class="input" type="email" bind:value={contactEmail} required />
				</div>
				<div class="md:col-span-2">
					<label class="label" for="reg-address">Business address</label>
					<input id="reg-address" class="input" bind:value={address} required />
				</div>
				<div class="md:col-span-2">
					<label class="label" for="reg-usecase">What will you text about?</label>
					<textarea id="reg-usecase" class="input" rows="2" bind:value={useCase} required></textarea>
				</div>
				<div class="md:col-span-2">
					<label class="label" for="reg-sample">Sample message</label>
					<textarea id="reg-sample" class="input" rows="2" bind:value={sampleMessage} required
					></textarea>
				</div>
				<div class="flex items-center justify-between gap-4 border-t border-line pt-4 md:col-span-2">
					<p class="hidden text-xs leading-5 text-muted sm:block">Carrier review begins after submission.</p>
					<button class="btn sm:ml-auto" type="submit" disabled={submitting}>
						{submitting ? 'Submitting…' : 'Submit registration'}
					</button>
				</div>
				<div class="md:col-span-2"><ErrorText error={registrationError} /></div>
			</form>
		{/if}
		</div>
	</section>

	<section class="card overflow-hidden">
		<div class="panel-heading">
			<div><h2 class="panel-title">Phone numbers</h2><p class="mt-0.5 text-xs text-muted">Local identity for this location</p></div>
			<span class="flex size-9 items-center justify-center rounded-xl bg-accent/10 text-accent"><svg class="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M22 16.9v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.12.9.33 1.78.62 2.63a2 2 0 0 1-.45 2.11L8 9.73a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.85.29 1.73.5 2.63.62A2 2 0 0 1 22 16.9z" /></svg></span>
		</div>
		<div class="space-y-5 p-5 sm:p-6">

		{#if numbers.length > 0}
			<ul class="overflow-hidden rounded-2xl border border-line divide-y divide-line">
				{#each numbers as number (number.id)}
					<li class="flex flex-col items-start gap-2 bg-canvas/50 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
						<div><span class="block text-sm font-semibold">{number.e164}</span><span class="mt-0.5 block text-xs text-muted">{number.locationId ? 'Assigned to this location' : 'Location number'}</span></div>
						<span class="badge bg-emerald-50 text-emerald-700 dark:bg-emerald-950/45 dark:text-emerald-300"><span class="mr-1.5 size-1.5 rounded-full bg-emerald-500"></span>active</span>
					</li>
				{/each}
			</ul>
		{:else}
			<p class="text-sm text-muted">No numbers yet. Search and pick one for this location.</p>
		{/if}

		<form class="flex flex-col items-stretch gap-3 rounded-2xl bg-canvas p-4 sm:flex-row sm:items-end" onsubmit={search}>
			<div class="sm:flex-1">
				<label class="label" for="area-code">Area code (optional)</label>
				<input id="area-code" class="input sm:max-w-48" bind:value={areaCode} placeholder="512" />
			</div>
			<button class="btn-secondary" type="submit" disabled={searching}>
				{searching ? 'Searching…' : 'Search numbers'}
			</button>
		</form>
		<ErrorText error={searchError} />

		{#if searchResults.length > 0}
			<ul class="overflow-hidden rounded-2xl border border-line divide-y divide-line">
				{#each searchResults as result (result.e164)}
					<li class="flex items-center justify-between gap-4 px-4 py-3">
						<span class="font-medium">{result.e164}</span>
						<button
							class="btn text-xs"
							onclick={() => buy(result.e164)}
							disabled={buyingE164 !== null}
						>
							{buyingE164 === result.e164 ? 'Buying…' : 'Use this number'}
						</button>
					</li>
				{/each}
			</ul>
		{/if}
		<ErrorText error={buyError} />
		</div>
	</section>

	<VoiceSettings />
</div>
