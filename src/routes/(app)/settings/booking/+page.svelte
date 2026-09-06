<script lang="ts">
	import { onMount } from 'svelte';
	import { createQuery, useQueryClient } from '@tanstack/svelte-query';
	import { api } from '$lib/client/api';
	import ErrorText from '$lib/client/ErrorText.svelte';
	import SettingsNav from '$lib/client/SettingsNav.svelte';
	import type { BookingService, BookingSettings } from '$lib/types';

	type BookingSettingsResponse = {
		settings: BookingSettings;
		services: BookingService[];
		providerConfigured: boolean;
		appointmentPublicKey: string | null;
	};

	type ServiceDraft = Pick<BookingService, 'name' | 'durationMinutes' | 'providerServiceId' | 'enabled'>;

	const queryClient = useQueryClient();
	const settingsQuery = createQuery(() => ({
		queryKey: ['booking-settings'],
		queryFn: () => api.get<BookingSettingsResponse>('/api/v1/booking/settings')
	}));

	let initialized = $state(false);
	let enabled = $state(false);
	let providerLocationId = $state('');
	let minimumNoticeMinutes = $state(120);
	let bookingWindowDays = $state(14);
	let sessionTimeoutMinutes = $state(30);
	let confirmationTemplate = $state('');
	let serviceDrafts = $state<Record<string, ServiceDraft>>({});
	let newServiceName = $state('');
	let newServiceDuration = $state(60);
	let newProviderServiceId = $state('');
	let origin = $state('');
	let savingSettings = $state(false);
	let savingServiceId = $state('');
	let addingService = $state(false);
	let copied = $state(false);
	let settingsError = $state<unknown>(null);
	let serviceError = $state<unknown>(null);

	$effect(() => {
		if (!initialized && settingsQuery.data) {
			const data = settingsQuery.data;
			enabled = data.settings.enabled;
			providerLocationId = data.settings.providerLocationId ?? '';
			minimumNoticeMinutes = data.settings.minimumNoticeMinutes;
			bookingWindowDays = data.settings.bookingWindowDays;
			sessionTimeoutMinutes = data.settings.sessionTimeoutMinutes;
			confirmationTemplate = data.settings.confirmationTemplate;
			serviceDrafts = Object.fromEntries(
				data.services.map((service) => [
					service.id,
					{
						name: service.name,
						durationMinutes: service.durationMinutes,
						providerServiceId: service.providerServiceId,
						enabled: service.enabled
					}
				])
			);
			initialized = true;
		}
	});

	onMount(() => {
		origin = window.location.origin;
	});

	let bookingUrl = $derived(
		origin && settingsQuery.data?.appointmentPublicKey
			? `${origin}/book/${settingsQuery.data.appointmentPublicKey}`
			: ''
	);
	let ready = $derived(
		Boolean(
			enabled &&
			settingsQuery.data?.providerConfigured &&
			(settingsQuery.data?.services ?? []).some((service) => service.enabled)
		)
	);

	async function saveSettings(event: SubmitEvent) {
		event.preventDefault();
		savingSettings = true;
		settingsError = null;
		try {
			await api.put('/api/v1/booking/settings', {
				enabled,
				providerLocationId: providerLocationId || null,
				minimumNoticeMinutes,
				bookingWindowDays,
				sessionTimeoutMinutes,
				confirmationTemplate
			});
			initialized = false;
			await queryClient.invalidateQueries({ queryKey: ['booking-settings'] });
		} catch (error) {
			settingsError = error;
		} finally {
			savingSettings = false;
		}
	}

	async function saveService(id: string) {
		const draft = serviceDrafts[id];
		if (!draft) return;
		savingServiceId = id;
		serviceError = null;
		try {
			await api.put(`/api/v1/booking/services/${id}`, draft);
			initialized = false;
			await queryClient.invalidateQueries({ queryKey: ['booking-settings'] });
		} catch (error) {
			serviceError = error;
		} finally {
			savingServiceId = '';
		}
	}

	async function addService(event: SubmitEvent) {
		event.preventDefault();
		addingService = true;
		serviceError = null;
		try {
			await api.post('/api/v1/booking/services', {
				name: newServiceName,
				durationMinutes: newServiceDuration,
				providerServiceId: newProviderServiceId || null,
				enabled: true
			});
			newServiceName = '';
			newServiceDuration = 60;
			newProviderServiceId = '';
			initialized = false;
			await queryClient.invalidateQueries({ queryKey: ['booking-settings'] });
		} catch (error) {
			serviceError = error;
		} finally {
			addingService = false;
		}
	}

	async function copyLink() {
		if (!bookingUrl) return;
		await navigator.clipboard.writeText(bookingUrl);
		copied = true;
		setTimeout(() => (copied = false), 1600);
	}
</script>

<svelte:head><title>Conversational booking · Kiso CRM</title></svelte:head>

<div class="mx-auto max-w-6xl">
	<SettingsNav />
	<header class="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
		<div><p class="eyebrow">Phase 6B</p><h1 class="page-title">Conversational booking</h1><p class="page-subtitle">Qualify website leads, offer real availability, and book safely with a human fallback.</p></div>
		{#if settingsQuery.data}<span class={`badge self-start sm:self-auto ${ready ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200' : 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-100'}`}><span class={`mr-1.5 size-1.5 rounded-full ${ready ? 'bg-emerald-500' : 'bg-amber-500'}`}></span>{ready ? 'Ready to publish' : 'Setup needed'}</span>{/if}
	</header>

	{#if settingsQuery.isPending}
		<div class="card p-8 text-sm text-muted">Preparing booking settings…</div>
	{:else if settingsQuery.isError}
		<div class="card p-6"><ErrorText error={settingsQuery.error} /></div>
	{:else if settingsQuery.data}
		<div class="grid gap-5 xl:grid-cols-[1.05fr_0.95fr]">
			<form class="card overflow-hidden" onsubmit={saveSettings}>
				<div class="panel-heading"><div><h2 class="panel-title">Booking controls</h2><p class="mt-1 text-xs text-muted">The AI qualifies. The scheduler owns every slot and booking.</p></div></div>
				<div class="space-y-5 p-4 sm:p-6">
					<label class="flex items-start justify-between gap-4 rounded-xl border border-line bg-canvas/55 p-4"><span><span class="block text-sm font-bold">Accept conversational bookings</span><span class="mt-1 block text-xs leading-5 text-muted">Turn off to pause new sessions without hiding existing records.</span></span><input class="mt-1 size-5 accent-accent" type="checkbox" bind:checked={enabled} /></label>
					<label><span class="label">Provider location ID <span class="font-normal text-muted">(when required)</span></span><input class="input" bind:value={providerLocationId} maxlength="200" autocomplete="off" placeholder="Location key from the connected scheduler" /></label>
					<div class="grid gap-4 sm:grid-cols-3">
						<label><span class="label">Minimum notice</span><div class="flex items-center gap-2"><input class="input" type="number" min="0" max="10080" step="15" bind:value={minimumNoticeMinutes} /><span class="text-xs text-muted">min</span></div></label>
						<label><span class="label">Booking window</span><div class="flex items-center gap-2"><input class="input" type="number" min="1" max="90" bind:value={bookingWindowDays} /><span class="text-xs text-muted">days</span></div></label>
						<label><span class="label">Chat timeout</span><div class="flex items-center gap-2"><input class="input" type="number" min="5" max="120" bind:value={sessionTimeoutMinutes} /><span class="text-xs text-muted">min</span></div></label>
					</div>
					<label><span class="label">Confirmation text</span><textarea class="input min-h-28 resize-y" rows="4" maxlength="600" bind:value={confirmationTemplate}></textarea><span class="mt-1.5 block text-xs leading-5 text-muted">Use &#123;&#123;location_name&#125;&#125; and &#123;&#123;appointment_time&#125;&#125;. STOP language is required.</span></label>
					<div class="rounded-xl border border-line bg-canvas/55 p-4 text-xs leading-5 text-muted"><p class="font-bold text-ink">Connection status</p><p class="mt-1">{settingsQuery.data.providerConfigured ? 'Scheduler provider is configured for this environment.' : 'Scheduler provider credentials are not configured. Production booking stays unavailable.'}</p></div>
					<button class="btn w-full sm:w-auto" type="submit" disabled={savingSettings}>{savingSettings ? 'Saving…' : 'Save booking controls'}</button>
					<ErrorText error={settingsError} />
				</div>
			</form>

			<section class="card overflow-hidden" aria-labelledby="publish-heading">
				<div class="panel-heading"><div><h2 id="publish-heading" class="panel-title">Publish</h2><p class="mt-1 text-xs text-muted">The existing appointment form key now opens the concierge.</p></div></div>
				<div class="space-y-4 p-4 sm:p-6">
					<label><span class="label">Booking link</span><input class="input" readonly value={bookingUrl || 'Preparing booking link…'} aria-label="Public booking link" /></label>
					<div class="flex flex-col gap-2 sm:flex-row"><button class="btn-secondary" type="button" onclick={copyLink} disabled={!bookingUrl}>{copied ? 'Copied' : 'Copy link'}</button>{#if bookingUrl}<a class="btn-ghost text-center" href={bookingUrl} target="_blank" rel="noreferrer">Preview concierge ↗</a>{/if}</div>
					<div class="rounded-xl border border-emerald-300 bg-emerald-50 p-4 text-xs leading-5 text-emerald-950 dark:border-emerald-900 dark:bg-emerald-950/45 dark:text-emerald-100"><p class="font-bold">Safety boundary</p><p class="mt-1 opacity-85">AI never writes an appointment. It can request availability only after qualification; holds, booking, cancellation, and timeout transitions are deterministic server actions.</p></div>
				</div>
			</section>
		</div>

		<section class="card mt-5 overflow-hidden" aria-labelledby="services-heading">
			<div class="panel-heading"><div><h2 id="services-heading" class="panel-title">Location services</h2><p class="mt-1 text-xs text-muted">Duration and provider service IDs are location-specific.</p></div></div>
			<div class="grid gap-4 p-4 sm:p-6 xl:grid-cols-2">
				{#each settingsQuery.data.services as service (service.id)}
					{@const draft = serviceDrafts[service.id]}
					{#if draft}
						<article class="space-y-4 rounded-2xl border border-line bg-canvas/45 p-4">
							<div class="flex items-center justify-between gap-3"><h3 class="font-bold">{service.name}</h3><label class="flex items-center gap-2 text-xs font-semibold"><input class="size-4 accent-accent" type="checkbox" bind:checked={draft.enabled} /> Enabled</label></div>
							<div class="grid gap-3 sm:grid-cols-[1fr_8rem]"><label><span class="label">Service name</span><input class="input" bind:value={draft.name} maxlength="120" /></label><label><span class="label">Duration</span><input class="input" type="number" min="15" max="480" step="15" bind:value={draft.durationMinutes} /></label></div>
							<label><span class="label">Provider service ID <span class="font-normal text-muted">(optional)</span></span><input class="input" bind:value={draft.providerServiceId} maxlength="200" /></label>
							<button class="btn-secondary" type="button" onclick={() => saveService(service.id)} disabled={savingServiceId === service.id}>{savingServiceId === service.id ? 'Saving…' : 'Save service'}</button>
						</article>
					{/if}
				{/each}
				<form class="space-y-4 rounded-2xl border border-dashed border-accent/40 bg-accent/5 p-4" onsubmit={addService}>
					<h3 class="font-bold">Add a service</h3>
					<div class="grid gap-3 sm:grid-cols-[1fr_8rem]"><label><span class="label">Service name</span><input class="input" bind:value={newServiceName} required maxlength="120" placeholder="AC diagnostic" /></label><label><span class="label">Duration</span><input class="input" type="number" min="15" max="480" step="15" bind:value={newServiceDuration} /></label></div>
					<label><span class="label">Provider service ID <span class="font-normal text-muted">(optional)</span></span><input class="input" bind:value={newProviderServiceId} maxlength="200" /></label>
					<button class="btn" type="submit" disabled={addingService}>{addingService ? 'Adding…' : 'Add service'}</button>
				</form>
			</div>
			<div class="px-4 pb-4 sm:px-6 sm:pb-6"><ErrorText error={serviceError} /></div>
		</section>
	{/if}
</div>
