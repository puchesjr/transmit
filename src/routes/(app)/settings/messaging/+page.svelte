<script lang="ts">
	import { createQuery, useQueryClient } from '@tanstack/svelte-query';
	import { api } from '$lib/client/api';
	import ErrorText from '$lib/client/ErrorText.svelte';
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
		approved: 'bg-green-100 text-green-800',
		submitted: 'bg-amber-100 text-amber-800',
		rejected: 'bg-red-100 text-red-800'
	};
</script>

<div class="mx-auto max-w-3xl space-y-6">
	<div>
		<h1 class="text-2xl font-semibold tracking-tight">Messaging</h1>
		<p class="text-sm text-muted">
			Carrier registration (10DLC) and phone numbers. Registration is required before texting.
		</p>
	</div>

	<section class="card space-y-4 p-5">
		<h2 class="section-title">Carrier registration</h2>

		{#if registrationQuery.isPending}
			<p class="text-sm text-muted">Loading…</p>
		{:else if registration}
			<div class="flex items-center gap-3">
				<span
					class={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${statusStyles[registration.status] ?? ''}`}
				>
					{registration.status}
				</span>
				<span class="text-sm">{registration.legalName}</span>
				{#if registration.status !== 'approved'}
					<button class="btn-secondary text-xs" onclick={refreshStatus} disabled={refreshing}>
						{refreshing ? 'Checking…' : 'Check status'}
					</button>
				{/if}
			</div>
			{#if registration.status === 'submitted'}
				<p class="text-sm text-muted">
					Carrier review usually takes a few business days. Sending is disabled until approval.
				</p>
			{:else if registration.status === 'rejected'}
				<p class="text-sm text-red-600">
					Rejected{registration.rejectionReason ? `: ${registration.rejectionReason}` : ''}. Contact
					support to resubmit.
				</p>
			{/if}
			<ErrorText error={registrationError} />
		{:else}
			<form class="grid gap-3 md:grid-cols-2" onsubmit={submitRegistration}>
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
				<div class="md:col-span-2">
					<button class="btn" type="submit" disabled={submitting}>
						{submitting ? 'Submitting…' : 'Submit registration'}
					</button>
				</div>
				<div class="md:col-span-2"><ErrorText error={registrationError} /></div>
			</form>
		{/if}
	</section>

	<section class="card space-y-4 p-5">
		<h2 class="section-title">Phone numbers</h2>

		{#if numbers.length > 0}
			<ul class="divide-y divide-line">
				{#each numbers as number (number.id)}
					<li class="flex items-center justify-between py-2">
						<span class="font-medium">{number.e164}</span>
						<span class="text-xs text-muted">active</span>
					</li>
				{/each}
			</ul>
		{:else}
			<p class="text-sm text-muted">No numbers yet. Search and pick one for this location.</p>
		{/if}

		<form class="flex items-end gap-2" onsubmit={search}>
			<div>
				<label class="label" for="area-code">Area code (optional)</label>
				<input id="area-code" class="input w-32" bind:value={areaCode} placeholder="512" />
			</div>
			<button class="btn-secondary" type="submit" disabled={searching}>
				{searching ? 'Searching…' : 'Search numbers'}
			</button>
		</form>
		<ErrorText error={searchError} />

		{#if searchResults.length > 0}
			<ul class="divide-y divide-line">
				{#each searchResults as result (result.e164)}
					<li class="flex items-center justify-between py-2">
						<span>{result.e164}</span>
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
	</section>
</div>
