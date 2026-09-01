<script lang="ts">
	import { resolve } from '$app/paths';
	import { createQuery, useQueryClient } from '@tanstack/svelte-query';
	import { api } from '$lib/client/api';
	import ErrorText from '$lib/client/ErrorText.svelte';
	import { formatWhen } from '$lib/format';
	import type { BusinessDayKey, BusinessHours, Call, VoiceSettings } from '$lib/types';

	const queryClient = useQueryClient();
	const DAYS: { key: BusinessDayKey; label: string }[] = [
		{ key: 'mon', label: 'Monday' },
		{ key: 'tue', label: 'Tuesday' },
		{ key: 'wed', label: 'Wednesday' },
		{ key: 'thu', label: 'Thursday' },
		{ key: 'fri', label: 'Friday' },
		{ key: 'sat', label: 'Saturday' },
		{ key: 'sun', label: 'Sunday' }
	];

	const settingsQuery = createQuery(() => ({
		queryKey: ['voice-settings'],
		queryFn: () => api.get<{ settings: VoiceSettings }>('/api/v1/voice/settings')
	}));
	const callsQuery = createQuery(() => ({
		queryKey: ['voice-calls'],
		queryFn: () => api.get<{ calls: Call[] }>('/api/v1/voice/calls'),
		refetchInterval: 5000
	}));

	let initialized = $state(false);
	let forwardingNumber = $state('');
	let timezone = $state('America/Chicago');
	let missedCallTextbackEnabled = $state(true);
	let missedCallTemplate = $state('Sorry we missed your call — how can we help? Reply STOP to opt out.');
	let businessHours = $state<BusinessHours>({
		mon: { enabled: true, opensAt: '08:00', closesAt: '17:00' },
		tue: { enabled: true, opensAt: '08:00', closesAt: '17:00' },
		wed: { enabled: true, opensAt: '08:00', closesAt: '17:00' },
		thu: { enabled: true, opensAt: '08:00', closesAt: '17:00' },
		fri: { enabled: true, opensAt: '08:00', closesAt: '17:00' },
		sat: { enabled: false, opensAt: '08:00', closesAt: '17:00' },
		sun: { enabled: false, opensAt: '08:00', closesAt: '17:00' }
	});
	let saving = $state(false);
	let saveError = $state<unknown>(null);
	let saved = $state(false);

	$effect(() => {
		const settings = settingsQuery.data?.settings;
		if (!settings || initialized) return;
		forwardingNumber = settings.forwardingNumber ?? '';
		timezone = settings.timezone;
		missedCallTextbackEnabled = settings.missedCallTextbackEnabled;
		missedCallTemplate = settings.missedCallTemplate;
		businessHours = structuredClone(settings.businessHours);
		initialized = true;
	});

	async function save(event: SubmitEvent) {
		event.preventDefault();
		saveError = null;
		saved = false;
		saving = true;
		try {
			await api.put('/api/v1/voice/settings', {
				forwardingNumber,
				timezone,
				missedCallTextbackEnabled,
				missedCallTemplate,
				businessHours
			});
			await queryClient.invalidateQueries({ queryKey: ['voice-settings'] });
			saved = true;
		} catch (error) {
			saveError = error;
		} finally {
			saving = false;
		}
	}

	function duration(call: Call): string {
		if (call.durationSeconds == null) return '—';
		if (call.durationSeconds < 60) return `${call.durationSeconds}s`;
		return `${Math.floor(call.durationSeconds / 60)}m ${call.durationSeconds % 60}s`;
	}

	let calls = $derived(callsQuery.data?.calls ?? []);
</script>

<section class="card overflow-hidden">
	<div class="panel-heading">
		<div>
			<h2 class="panel-title">Calls & missed-call textback</h2>
			<p class="mt-0.5 text-xs text-muted">Forward calls during business hours and recover the ones you miss</p>
		</div>
		<span class="flex size-9 items-center justify-center rounded-xl bg-accent/10 text-accent">
			<svg class="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M22 16.9v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.12.9.33 1.78.62 2.63a2 2 0 0 1-.45 2.11L8 9.73a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.85.29 1.73.5 2.63.62A2 2 0 0 1 22 16.9z" /></svg>
		</span>
	</div>

	{#if settingsQuery.isPending}
		<div class="p-6 text-sm text-muted">Loading call settings…</div>
	{:else if settingsQuery.isError}
		<div class="p-6"><ErrorText error={settingsQuery.error} /></div>
	{:else}
		<form class="min-w-0 space-y-6 p-4 sm:space-y-7 sm:p-6" onsubmit={save}>
			<div class="grid gap-4 md:grid-cols-2">
				<div>
					<label class="label" for="voice-forwarding">Forward calls to</label>
					<input id="voice-forwarding" class="input" type="tel" bind:value={forwardingNumber} placeholder="+1 512 555 0100" />
					<p class="mt-1.5 text-xs text-muted">Usually the owner or front-desk mobile number.</p>
				</div>
				<div>
					<label class="label" for="voice-timezone">Location timezone</label>
					<select id="voice-timezone" class="input" bind:value={timezone}>
						<option value="America/New_York">Eastern</option>
						<option value="America/Chicago">Central</option>
						<option value="America/Denver">Mountain</option>
						<option value="America/Phoenix">Arizona</option>
						<option value="America/Los_Angeles">Pacific</option>
					</select>
				</div>
			</div>

			<fieldset>
				<legend class="text-sm font-semibold">Business hours</legend>
				<p class="mt-1 text-xs text-muted">Calls outside these hours receive the missed-call textback without ringing your team.</p>
				<div class="mt-3 min-w-0 overflow-hidden rounded-2xl border border-line divide-y divide-line">
					{#each DAYS as day (day.key)}
						<div class="grid min-w-0 gap-3 bg-canvas/40 px-2 py-3.5 sm:grid-cols-[9rem_minmax(0,1fr)] sm:items-center sm:gap-4 sm:px-4 sm:py-3">
							<label class="flex items-center gap-3 text-sm font-medium">
								<input class="size-4 accent-[var(--accent)]" type="checkbox" bind:checked={businessHours[day.key].enabled} />
								{day.label}
							</label>
							{#if businessHours[day.key].enabled}
								<div class="grid min-w-0 grid-cols-2 items-end gap-2">
									<label class="min-w-0"><span class="mb-1 block text-[10px] font-semibold text-muted">Opens</span><input aria-label={`${day.label} opens`} class="input min-h-10 min-w-0 px-2 py-1.5 text-sm" type="time" bind:value={businessHours[day.key].opensAt} /></label>
									<label class="min-w-0"><span class="mb-1 block text-[10px] font-semibold text-muted">Closes</span><input aria-label={`${day.label} closes`} class="input min-h-10 min-w-0 px-2 py-1.5 text-sm" type="time" bind:value={businessHours[day.key].closesAt} /></label>
								</div>
							{:else}
								<span class="text-xs font-medium text-muted">Closed</span>
							{/if}
						</div>
					{/each}
				</div>
			</fieldset>

			<div class="rounded-2xl border border-line bg-canvas/60 p-4">
				<label class="flex items-start justify-between gap-5" for="textback-enabled">
					<span><span class="block text-sm font-semibold">Automatic missed-call textback</span><span class="mt-1 block text-xs leading-5 text-muted">Queues a compliant SMS after an unanswered or after-hours call. Quiet hours still apply.</span></span>
					<input id="textback-enabled" class="mt-0.5 size-5 accent-[var(--accent)]" type="checkbox" bind:checked={missedCallTextbackEnabled} />
				</label>
				<div class="mt-4">
					<label class="label" for="missed-call-template">Textback message</label>
					<textarea id="missed-call-template" class="input" rows="3" bind:value={missedCallTemplate} disabled={!missedCallTextbackEnabled}></textarea>
					<div class="mt-1.5 flex justify-between gap-3 text-xs text-muted"><span>Must include STOP instructions.</span><span>{missedCallTemplate.length}/480</span></div>
				</div>
			</div>

			<div class="flex flex-col items-stretch gap-3 border-t border-line pt-5 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
				<div>{#if saved}<span class="text-sm font-semibold text-emerald-600 dark:text-emerald-300">Call settings saved</span>{/if}<ErrorText error={saveError} /></div>
				<button class="btn w-full sm:w-auto" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save call settings'}</button>
			</div>
		</form>
	{/if}
</section>

<section class="card overflow-hidden">
	<div class="panel-heading">
		<div><h2 class="panel-title">Recent calls</h2><p class="mt-0.5 text-xs text-muted">Latest outcomes for this workspace</p></div>
		<span class="badge">{calls.length}</span>
	</div>
	{#if callsQuery.isPending}
		<p class="p-6 text-sm text-muted">Loading calls…</p>
	{:else if calls.length === 0}
		<div class="p-6"><p class="text-sm font-semibold">No calls yet</p><p class="mt-1 text-sm text-muted">Incoming calls will appear here and on the customer timeline.</p></div>
	{:else}
		<ul class="divide-y divide-line">
			{#each calls.slice(0, 8) as call (call.id)}
				<li class="flex flex-col gap-2 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
					<div class="min-w-0">
						<a class="text-sm font-semibold hover:text-accent" href={resolve(`/contacts/${call.contactId}`)}>{call.contactName}</a>
						<p class="mt-1 truncate text-xs text-muted">{call.from} · {formatWhen(call.startedAt)}</p>
					</div>
					<div class="flex items-center gap-3 text-xs"><span class={`badge ${call.status === 'missed' ? 'bg-amber-50 text-amber-700 dark:bg-amber-950/45 dark:text-amber-300' : call.status === 'completed' ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/45 dark:text-emerald-300' : ''}`}>{call.afterHours ? 'after hours · ' : ''}{call.status}</span><span class="w-12 text-right text-muted">{duration(call)}</span></div>
				</li>
			{/each}
		</ul>
	{/if}
</section>
