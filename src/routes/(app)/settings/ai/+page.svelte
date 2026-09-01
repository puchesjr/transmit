<script lang="ts">
	import { createQuery, useQueryClient } from '@tanstack/svelte-query';
	import { api } from '$lib/client/api';
	import ErrorText from '$lib/client/ErrorText.svelte';
	import SettingsNav from '$lib/client/SettingsNav.svelte';
	import type { AiArtifact, AiSettings } from '$lib/types';

	const queryClient = useQueryClient();
	const settingsQuery = createQuery(() => ({
		queryKey: ['ai-settings'],
		queryFn: () => api.get<{ settings: AiSettings }>('/api/v1/ai/settings')
	}));
	const followUpsQuery = createQuery(() => ({
		queryKey: ['ai-follow-ups'],
		queryFn: () => api.get<{ artifacts: AiArtifact[] }>('/api/v1/ai/follow-ups')
	}));

	let enabled = $state(true);
	let followUpEnabled = $state(true);
	let followUpAfterDays = $state(2);
	let initialized = $state(false);
	let saving = $state(false);
	let saved = $state(false);
	let saveError = $state<unknown>(null);

	$effect(() => {
		if (!initialized && settingsQuery.data?.settings) {
			enabled = settingsQuery.data.settings.enabled;
			followUpEnabled = settingsQuery.data.settings.followUpEnabled;
			followUpAfterDays = settingsQuery.data.settings.followUpAfterDays;
			initialized = true;
		}
	});

	async function save(event: SubmitEvent) {
		event.preventDefault();
		saving = true;
		saved = false;
		saveError = null;
		try {
			await api.put<{ settings: AiSettings }>('/api/v1/ai/settings', {
				enabled,
				followUpEnabled,
				followUpAfterDays
			});
			saved = true;
			await queryClient.invalidateQueries({ queryKey: ['ai-settings'] });
		} catch (error) {
			saveError = error;
		} finally {
			saving = false;
		}
	}
</script>

<div class="page-wrap max-w-5xl">
	<SettingsNav />

	<header class="page-header">
		<div>
			<p class="mb-2 text-xs font-bold tracking-[0.12em] text-accent uppercase">Workspace settings</p>
			<h1 class="page-title">AI assistance</h1>
			<p class="page-subtitle">
				Turn real customer conversations into faster, clearer replies. Every draft stays under human control.
			</p>
		</div>
		<span class="badge self-start sm:self-auto">
			<span class={`mr-1.5 size-1.5 rounded-full ${enabled ? 'bg-emerald-500' : 'bg-zinc-400'}`}></span>
			{enabled ? 'Enabled' : 'Paused'}
		</span>
	</header>

	{#if settingsQuery.isPending}
		<div class="card p-8 text-sm text-muted">Loading AI settings…</div>
	{:else if settingsQuery.isError}
		<div class="card p-6"><ErrorText error={settingsQuery.error} /></div>
	{:else}
		<form class="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]" onsubmit={save}>
			<section class="card overflow-hidden">
				<div class="panel-heading">
					<div>
						<h2 class="panel-title">Drafting controls</h2>
						<p class="mt-1 text-xs text-muted">The workspace kill switch applies immediately.</p>
					</div>
					<span class="flex size-9 items-center justify-center rounded-xl bg-accent/10 text-accent" aria-hidden="true">✦</span>
				</div>
				<div class="space-y-5 p-5 sm:p-6">
					<label class="flex cursor-pointer items-start justify-between gap-5 rounded-2xl border border-line bg-canvas/55 p-4">
						<span>
							<span class="block text-sm font-semibold">AI suggestions and summaries</span>
							<span class="mt-1 block text-xs leading-5 text-muted">Allow new reply choices, summaries, and follow-up drafts.</span>
						</span>
						<input class="mt-1 size-5 accent-accent" type="checkbox" bind:checked={enabled} />
					</label>

					<label class={`flex items-start justify-between gap-5 rounded-2xl border border-line p-4 ${enabled ? 'cursor-pointer bg-canvas/55' : 'bg-canvas/30 opacity-60'}`}>
						<span>
							<span class="block text-sm font-semibold">Prepare idle-lead follow-ups</span>
							<span class="mt-1 block text-xs leading-5 text-muted">Queue a draft for owner review. Transmit never sends it automatically.</span>
						</span>
						<input class="mt-1 size-5 accent-accent" type="checkbox" bind:checked={followUpEnabled} disabled={!enabled} />
					</label>

					<label class="block max-w-xs">
						<span class="label">Draft after this many idle days</span>
						<input class="input" type="number" min="1" max="30" bind:value={followUpAfterDays} disabled={!enabled || !followUpEnabled} />
					</label>

					<div class="flex flex-wrap items-center gap-3">
						<button class="btn w-full sm:w-auto" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save AI settings'}</button>
						{#if saved}<p class="text-sm font-semibold text-emerald-700 dark:text-emerald-300" role="status">Saved</p>{/if}
					</div>
					<ErrorText error={saveError} />
				</div>
			</section>

			<aside class="space-y-4">
				<section class="rounded-2xl bg-sidebar p-5 text-white shadow-[0_16px_42px_rgba(15,23,42,0.16)]">
					<p class="text-[10px] font-bold tracking-[0.12em] text-white/65 uppercase">Human-in-the-loop</p>
					<h2 class="mt-2 text-lg font-bold tracking-[-0.025em]">AI helps your team respond. It does not impersonate them.</h2>
					<ul class="mt-4 space-y-3 text-sm leading-6 text-white/70">
						<li>• Customer text is treated as untrusted input.</li>
						<li>• New messages make old drafts stale.</li>
						<li>• Opt-out, quiet-hour, and billing rules still control sending.</li>
						<li>• Generations and draft selections are written to the customer timeline.</li>
					</ul>
				</section>

				<section class="card p-5">
					<p class="text-xs font-semibold text-muted">Follow-ups awaiting review</p>
					{#if followUpsQuery.isPending}
						<p class="mt-2 text-sm text-muted">Loading…</p>
					{:else}
						<p class="mt-2 text-3xl font-bold tracking-[-0.04em]">{followUpsQuery.data?.artifacts.length ?? 0}</p>
						<p class="mt-1 text-xs leading-5 text-muted">Open the matching Inbox conversation to review and send.</p>
					{/if}
				</section>
			</aside>
		</form>
	{/if}
</div>
