<script lang="ts">
	import { createQuery, useQueryClient } from '@tanstack/svelte-query';
	import { api } from '$lib/client/api';
	import ErrorText from '$lib/client/ErrorText.svelte';
	import SettingsNav from '$lib/client/SettingsNav.svelte';
	import { LAUNCH_PRICE } from '$lib/pricing';
	import type { BillingSummary } from '$lib/types';

	const queryClient = useQueryClient();
	const billingQuery = createQuery(() => ({
		queryKey: ['billing-summary'],
		queryFn: () => api.get<{ billing: BillingSummary }>('/api/v1/billing/summary')
	}));

	let actionError = $state<unknown>(null);
	let starting = $state(false);
	let openingPortal = $state(false);
	let billing = $derived(billingQuery.data?.billing ?? null);
	let totalMessages = $derived(
		(billing?.usage ?? []).reduce(
			(total, row) => total + row.outboundMessages + row.inboundMessages,
			0
		)
	);
	let totalCallSeconds = $derived(
		(billing?.usage ?? []).reduce((total, row) => total + row.callSeconds, 0)
	);
	let trialProgress = $derived(
		billing ? Math.min(100, (billing.trialMessagesUsed / billing.trialMessageCap) * 100) : 0
	);

	const statusCopy: Record<string, { label: string; detail: string; tone: string; dot: string }> = {
		unconfigured: {
			label: 'Trial not started',
			detail: 'Add a card to activate your workspace and provision a phone number.',
			tone: 'bg-amber-50 text-amber-800 dark:bg-amber-950/45 dark:text-amber-200',
			dot: 'bg-amber-500'
		},
		trialing: {
			label: 'Free trial',
			detail: 'Your card is saved. You will not be charged until the trial ends.',
			tone: 'bg-blue-50 text-blue-800 dark:bg-blue-950/45 dark:text-blue-200',
			dot: 'bg-blue-500'
		},
		active: {
			label: 'Active',
			detail: 'Your workspace is active and usage is metered automatically.',
			tone: 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/45 dark:text-emerald-200',
			dot: 'bg-emerald-500'
		},
		past_due: {
			label: 'Payment needs attention',
			detail: 'Update your payment method before the grace period ends.',
			tone: 'bg-red-50 text-red-800 dark:bg-red-950/45 dark:text-red-200',
			dot: 'bg-red-500'
		},
		canceled: {
			label: 'Canceled',
			detail: 'Restart billing to restore outbound messaging.',
			tone: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200',
			dot: 'bg-zinc-500'
		}
	};

	function shortDate(value: string | null): string {
		if (!value) return '—';
		return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(
			new Date(value)
		);
	}

	function callTime(seconds: number): string {
		if (seconds < 60) return `${seconds}s`;
		return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
	}

	async function startTrial() {
		actionError = null;
		starting = true;
		try {
			const result = await api.post<{ url: string }>('/api/v1/billing/checkout');
			window.location.assign(result.url);
		} catch (error) {
			actionError = error;
			starting = false;
		}
	}

	async function manageBilling() {
		actionError = null;
		openingPortal = true;
		try {
			const result = await api.post<{ url: string }>('/api/v1/billing/portal');
			window.location.assign(result.url);
		} catch (error) {
			actionError = error;
			openingPortal = false;
		}
	}

	async function refresh() {
		await queryClient.invalidateQueries({ queryKey: ['billing-summary'] });
	}
</script>

<div class="page-wrap max-w-6xl">
	<SettingsNav />

	<header class="page-header">
		<div>
			<p class="mb-2 text-xs font-bold tracking-[0.12em] text-accent uppercase">Workspace settings</p>
			<h1 class="page-title">Billing & usage</h1>
			<p class="page-subtitle">One subscription for your locations, with transparent messaging usage.</p>
		</div>
		{#if billing}
			<span class={`badge self-start sm:self-auto ${statusCopy[billing.status].tone}`}>
				<span class={`mr-1.5 size-1.5 rounded-full ${statusCopy[billing.status].dot}`}></span>
				{statusCopy[billing.status].label}
			</span>
		{/if}
	</header>

	{#if billingQuery.isPending}
		<div class="card p-8 text-sm text-muted">Loading billing details…</div>
	{:else if billingQuery.error}
		<div class="card p-6">
			<ErrorText error={billingQuery.error} />
			<button class="btn-secondary mt-4" type="button" onclick={refresh}>Try again</button>
		</div>
	{:else if billing}
		<section class="relative overflow-hidden rounded-3xl bg-sidebar p-6 text-white shadow-[0_22px_60px_rgba(15,23,42,0.18)] sm:p-8">
			<div class="absolute -top-24 -right-20 size-72 rounded-full bg-accent/20 blur-3xl"></div>
			<div class="relative grid gap-8 lg:grid-cols-[1.35fr_0.65fr] lg:items-end">
				<div>
					<p class="text-xs font-bold tracking-[0.13em] text-white/65 uppercase">Transmit workspace</p>
					<h2 class="mt-3 max-w-xl text-2xl font-bold tracking-[-0.035em] sm:text-3xl">
						{statusCopy[billing.status].label}
					</h2>
					<p class="mt-2 max-w-xl text-sm leading-6 text-white/55">{statusCopy[billing.status].detail}</p>
					<div class="mt-6 flex flex-col items-stretch gap-3 sm:flex-row sm:flex-wrap sm:items-center">
						{#if billing.status === 'unconfigured' || billing.status === 'canceled'}
							<button class="btn w-full sm:w-auto" type="button" onclick={startTrial} disabled={starting}>
								{starting ? 'Opening checkout…' : 'Start 14-day trial'}
							</button>
						{:else}
							<button class="btn w-full sm:w-auto" type="button" onclick={manageBilling} disabled={openingPortal}>
								{openingPortal ? 'Opening portal…' : 'Manage billing'}
							</button>
						{/if}
						{#if billing.providerMode === 'demo'}
							<span class="inline-flex items-center rounded-xl border border-white/10 bg-white/[0.06] px-3 py-2 text-xs font-semibold text-white/65">
								Demo billing · no card charged
							</span>
						{/if}
					</div>
				</div>
				<div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
					<div class="rounded-2xl border border-white/10 bg-white/[0.055] p-4 backdrop-blur">
						<p class="text-[10px] font-bold tracking-[0.12em] text-white/65 uppercase">Current period</p>
						<p class="mt-1.5 text-sm font-semibold">{shortDate(billing.currentPeriodStart)} – {shortDate(billing.currentPeriodEnd)}</p>
					</div>
					<div class="rounded-2xl border border-white/10 bg-white/[0.055] p-4 backdrop-blur">
						<p class="text-[10px] font-bold tracking-[0.12em] text-white/65 uppercase">Payment method</p>
						<p class="mt-1.5 text-sm font-semibold">{billing.cardOnFile ? 'Card on file' : 'Not added yet'}</p>
					</div>
				</div>
			</div>
		</section>

		<ErrorText error={actionError} />

		<div class="grid gap-4 sm:grid-cols-3">
			<div class="card p-5">
				<p class="text-xs font-semibold text-muted">Location subscription</p>
				<p class="mt-2 text-3xl font-bold tracking-[-0.04em]">${LAUNCH_PRICE.locationMonthlyDollars}<span class="text-sm font-medium text-muted"> / month</span></p>
				<p class="mt-1 text-xs text-muted">Per active location</p>
			</div>
			<div class="card p-5">
				<p class="text-xs font-semibold text-muted">Messages this period</p>
				<p class="mt-2 text-3xl font-bold tracking-[-0.04em]">{totalMessages.toLocaleString()}</p>
				<p class="mt-1 text-xs text-muted">${LAUNCH_PRICE.messageDollars.toFixed(2)} each · sent or received</p>
			</div>
			<div class="card p-5">
				<p class="text-xs font-semibold text-muted">Call time</p>
				<p class="mt-2 text-3xl font-bold tracking-[-0.04em]">{callTime(totalCallSeconds)}</p>
				<p class="mt-1 text-xs text-muted">Across {billing.usage.length} {billing.usage.length === 1 ? 'location' : 'locations'}</p>
			</div>
		</div>

		{#if billing.status === 'trialing'}
			<section class="card p-5 sm:p-6">
				<div class="flex flex-wrap items-end justify-between gap-4">
					<div>
						<h2 class="panel-title">Trial message allowance</h2>
						<p class="mt-1 text-sm text-muted">Outbound sends pause at the hard trial limit.</p>
					</div>
					<div class="text-right">
						<p class="text-2xl font-bold tracking-[-0.04em]" aria-label={`${billing.trialMessagesUsed} of ${billing.trialMessageCap} trial messages used`}>{billing.trialMessagesUsed}<span class="text-sm font-medium text-muted"> / {billing.trialMessageCap}</span></p>
						<p class="mt-1 text-xs text-muted">Trial ends {shortDate(billing.trialEndsAt)}</p>
					</div>
				</div>
				<div class="mt-5 h-2 overflow-hidden rounded-full bg-ink/[0.07] dark:bg-white/10">
					<div class="h-full rounded-full bg-accent transition-all" style={`width: ${trialProgress}%`}></div>
				</div>
			</section>
		{/if}

		<section class="card overflow-hidden">
			<div class="panel-heading">
				<div>
					<h2 class="panel-title">Usage by location</h2>
					<p class="mt-0.5 text-xs text-muted">The invoice is reconciled against these immutable usage events.</p>
				</div>
				<span class="flex size-9 items-center justify-center rounded-xl bg-accent/10 text-accent">
					<svg class="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 19V9M10 19V5M16 19v-7M22 19H2" /></svg>
				</span>
			</div>
			<ul class="divide-y divide-line md:hidden">
				{#each billing.usage as row (row.locationId)}
					<li class="px-4 py-4">
						<p class="text-sm font-semibold">{row.locationName}</p>
						<dl class="mt-3 grid grid-cols-3 gap-2">
							<div><dt class="text-[10px] font-bold tracking-wide text-muted uppercase">Outbound</dt><dd class="mt-1 text-sm font-semibold tabular-nums">{row.outboundMessages.toLocaleString()}</dd></div>
							<div><dt class="text-[10px] font-bold tracking-wide text-muted uppercase">Inbound</dt><dd class="mt-1 text-sm font-semibold tabular-nums">{row.inboundMessages.toLocaleString()}</dd></div>
							<div><dt class="text-[10px] font-bold tracking-wide text-muted uppercase">Call time</dt><dd class="mt-1 text-sm font-semibold tabular-nums">{callTime(row.callSeconds)}</dd></div>
						</dl>
					</li>
				{/each}
			</ul>
			<div class="hidden overflow-x-auto md:block">
				<table class="w-full min-w-[620px] text-left text-sm">
					<thead class="border-b border-line bg-canvas/70 text-[10px] font-bold tracking-[0.11em] text-muted uppercase">
						<tr><th class="px-5 py-3.5">Location</th><th class="px-5 py-3.5 text-right">Outbound</th><th class="px-5 py-3.5 text-right">Inbound</th><th class="px-5 py-3.5 text-right">Call time</th></tr>
					</thead>
					<tbody class="divide-y divide-line">
						{#each billing.usage as row (row.locationId)}
							<tr class="transition hover:bg-canvas/55">
								<td class="px-5 py-4 font-semibold">{row.locationName}</td>
								<td class="px-5 py-4 text-right tabular-nums">{row.outboundMessages.toLocaleString()}</td>
								<td class="px-5 py-4 text-right tabular-nums">{row.inboundMessages.toLocaleString()}</td>
								<td class="px-5 py-4 text-right tabular-nums">{callTime(row.callSeconds)}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</section>
	{/if}
</div>
