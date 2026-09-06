<script lang="ts">
	import { onMount } from 'svelte';
	import type { PageData } from './$types';
	import type { PublicBookingState } from '$lib/types';

	let { data }: { data: PageData } = $props();
	let firstName = $state('');
	let lastName = $state('');
	let phone = $state('');
	let email = $state('');
	let serviceId = $state('');
	let consent = $state(false);
	let website = $state('');
	let sourcePage = $state('');
	let referrer = $state('');
	let campaign = $state<Record<string, string>>({});
	let submissionKey = $state('');
	let sessionToken = $state('');
	let bookingState = $state<PublicBookingState | null>(null);
	let chatBody = $state('');
	let busy = $state(false);
	let polling = $state(false);
	let errorMessage = $state('');

	let webMessages = $derived((bookingState?.messages ?? []).filter((message) => message.channel === 'web'));
	let terminal = $derived(
		bookingState ? ['booked', 'cancelled', 'expired'].includes(bookingState.session.status) : false
	);
	let canChat = $derived(
		bookingState ? ['qualifying', 'offering', 'handoff'].includes(bookingState.session.status) : false
	);

	onMount(() => {
		const params = new URLSearchParams(window.location.search);
		sourcePage = params.get('source_page') ?? params.get('sourcePage') ?? '';
		referrer = params.get('referrer') ?? document.referrer;
		campaign = Object.fromEntries(
			['source', 'medium', 'campaign', 'term', 'content']
				.map((key) => [key, params.get(`utm_${key}`) ?? ''])
				.filter(([, value]) => value)
		);
		submissionKey = crypto.randomUUID();
		sessionToken = `${crypto.randomUUID()}${crypto.randomUUID()}`.replaceAll('-', '');
		serviceId ||= data.profile.services[0]?.id ?? '';
		const timer = window.setInterval(() => void refresh(), 4000);
		return () => window.clearInterval(timer);
	});

	async function request(path: string, body?: unknown): Promise<PublicBookingState> {
		const response = await fetch(path, {
			method: body === undefined ? 'GET' : 'POST',
			headers: {
				accept: 'application/json',
				...(body === undefined ? {} : { 'content-type': 'application/json' }),
				...(bookingState && sessionToken ? { authorization: `Bearer ${sessionToken}` } : {})
			},
			body: body === undefined ? undefined : JSON.stringify(body)
		});
		const payload = (await response.json().catch(() => ({}))) as {
			data?: { state?: PublicBookingState };
			error?: { message?: string };
		};
		if (!response.ok || !payload.data?.state) {
			throw new Error(payload.error?.message ?? 'The booking request could not be completed.');
		}
		return payload.data.state;
	}

	function sessionPath(action = ''): string {
		return `/api/v1/public/booking/${encodeURIComponent(data.profile.publicKey)}/session${action}`;
	}

	async function start(event: SubmitEvent) {
		event.preventDefault();
		busy = true;
		errorMessage = '';
		try {
			bookingState = await request(
				`/api/v1/public/booking/${encodeURIComponent(data.profile.publicKey)}/sessions`,
				{
					firstName,
					lastName,
					phone,
					email,
					serviceId,
					consent,
					website,
					sourcePage,
					referrer,
					campaign,
					submissionKey,
					sessionToken
				}
			);
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : 'The booking chat could not start.';
		} finally {
			busy = false;
		}
	}

	async function refresh() {
		if (!bookingState || terminal || polling || busy) return;
		polling = true;
		try {
			bookingState = await request(sessionPath());
		} catch {
			// Keep the last visible state during a transient polling failure.
		} finally {
			polling = false;
		}
	}

	async function act(path: string, body: unknown = {}) {
		busy = true;
		errorMessage = '';
		try {
			bookingState = await request(sessionPath(path), body);
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : 'That step could not be completed.';
		} finally {
			busy = false;
		}
	}

	async function send(event: SubmitEvent) {
		event.preventDefault();
		const body = chatBody.trim();
		if (!body) return;
		chatBody = '';
		await act('/messages', { body });
	}

	function slotLabel(startsAt: string, timezone: string): string {
		return new Intl.DateTimeFormat('en-US', {
			timeZone: timezone,
			weekday: 'short',
			month: 'short',
			day: 'numeric',
			hour: 'numeric',
			minute: '2-digit',
			timeZoneName: 'short'
		}).format(new Date(startsAt));
	}
</script>

<svelte:head>
	<title>Book an appointment · {data.profile.accountName}</title>
	<meta name="description" content={`Book a real available time with ${data.profile.accountName}.`} />
	<meta name="robots" content="noindex, nofollow" />
</svelte:head>

<main class="relative min-h-dvh overflow-hidden bg-canvas px-3 py-4 text-ink sm:px-6 sm:py-8">
	<div class="pointer-events-none absolute -top-48 left-1/2 h-96 w-[42rem] -translate-x-1/2 rounded-full bg-accent/10 blur-3xl" aria-hidden="true"></div>
	<div class="relative mx-auto w-full max-w-2xl">
		<header class="mb-4 flex items-center justify-between gap-4 px-1 sm:mb-6">
			<div class="flex min-w-0 items-center gap-3">
				<span class="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-action text-lg font-black text-white shadow-lg shadow-accent/20" aria-hidden="true">K</span>
				<div class="min-w-0">
					<p class="truncate text-sm font-bold tracking-[-0.015em]">{data.profile.accountName}</p>
					<p class="truncate text-xs text-muted">{data.profile.locationName} · {data.profile.timezone}</p>
				</div>
			</div>
			<span class="badge shrink-0"><span class="mr-1.5 size-1.5 rounded-full bg-emerald-500"></span>Live schedule</span>
		</header>

		<section class="card overflow-hidden" aria-labelledby="booking-title">
			<div class="border-b border-line/80 bg-paper px-5 py-5 sm:px-7 sm:py-6">
				<p class="text-xs font-bold tracking-[0.12em] text-accent uppercase">AI concierge · human backup</p>
				<h1 id="booking-title" class="mt-2 text-3xl font-bold tracking-[-0.045em] sm:text-4xl">Book a real available time</h1>
				<p class="mt-3 max-w-xl text-sm leading-6 text-muted">Share the essentials, choose a live opening, and confirm it. If anything is uncertain, a person takes over.</p>
			</div>

			{#if !data.profile.available}
				<div class="flex min-h-72 flex-col items-center justify-center px-6 py-12 text-center" role="status">
					<span class="flex size-12 items-center justify-center rounded-full bg-amber-100 text-xl text-amber-900 dark:bg-amber-950 dark:text-amber-100" aria-hidden="true">!</span>
					<h2 class="mt-4 text-xl font-bold">Online booking is paused</h2>
					<p class="mt-2 max-w-sm text-sm leading-6 text-muted">{data.profile.unavailableReason}</p>
				</div>
			{:else if !bookingState}
				<form class="space-y-5 bg-paper px-5 py-6 sm:px-7 sm:py-7" onsubmit={start}>
					<div class="grid gap-4 sm:grid-cols-2">
						<label><span class="label">First name</span><input class="input" bind:value={firstName} autocomplete="given-name" required maxlength="100" /></label>
						<label><span class="label">Last name <span class="font-normal text-muted">(optional)</span></span><input class="input" bind:value={lastName} autocomplete="family-name" maxlength="100" /></label>
					</div>
					<div class="grid gap-4 sm:grid-cols-2">
						<label><span class="label">Mobile phone</span><input class="input" bind:value={phone} type="tel" inputmode="tel" autocomplete="tel" required placeholder="(555) 123-4567" aria-describedby="booking-phone-help" /></label>
						<label><span class="label">Email <span class="font-normal text-muted">(optional)</span></span><input class="input" bind:value={email} type="email" autocomplete="email" maxlength="320" /></label>
					</div>
					<p id="booking-phone-help" class="-mt-3 text-xs leading-5 text-muted">Your exact booking confirmation will be sent here by text.</p>
					<label><span class="label">Service</span><select class="input" bind:value={serviceId} required>{#each data.profile.services as service (service.id)}<option value={service.id}>{service.name} · {service.durationMinutes} min</option>{/each}</select></label>
					<input hidden bind:value={website} tabindex="-1" autocomplete="off" />
					<label class="flex cursor-pointer items-start gap-3 rounded-2xl border border-line bg-canvas/60 p-4">
						<input class="mt-0.5 size-5 shrink-0 accent-accent" type="checkbox" bind:checked={consent} required />
						<span class="text-xs leading-5 text-muted">{data.profile.consentText}</span>
					</label>
					{#if errorMessage}<p class="rounded-xl border border-red-300 bg-red-50 p-3 text-sm font-medium text-red-800 dark:border-red-900 dark:bg-red-950/50 dark:text-red-200" role="alert">{errorMessage}</p>{/if}
					<button class="btn w-full" type="submit" disabled={busy || !submissionKey || !sessionToken}>{busy ? 'Starting secure chat…' : 'Start booking'}</button>
					<p class="text-center text-[11px] leading-5 text-muted">Only scheduler-returned times can be offered or booked.</p>
				</form>
			{:else}
				<div class="bg-paper">
					<div class="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3 sm:px-6">
						<div><p class="text-xs font-bold tracking-[0.08em] text-muted uppercase">{bookingState.session.serviceName}</p><p class="mt-0.5 text-sm font-semibold capitalize">{bookingState.session.status === 'handoff' ? 'A person is joining' : bookingState.session.status}</p></div>
						{#if !terminal && bookingState.session.status !== 'handoff'}<button class="btn-ghost" type="button" onclick={() => act('/handoff')} disabled={busy}>Talk to a person</button>{/if}
					</div>

					<div class="max-h-[48vh] min-h-72 space-y-3 overflow-y-auto px-4 py-5 sm:px-6" aria-live="polite" aria-label="Booking conversation">
						{#each webMessages as message (message.id)}
							<div class={`flex ${message.direction === 'inbound' ? 'justify-end' : 'justify-start'}`}>
								<div class={`max-w-[88%] rounded-2xl px-4 py-3 text-sm leading-6 ${message.direction === 'inbound' ? 'rounded-br-md bg-action text-white' : 'rounded-bl-md border border-line bg-canvas text-ink'}`}>
									{message.body}
								</div>
							</div>
						{/each}
					</div>

					{#if bookingState.availableSlots.length > 0}
						<div class="border-t border-line bg-canvas/55 px-4 py-4 sm:px-6">
							<p class="text-xs font-bold tracking-[0.08em] text-muted uppercase">Available now</p>
							<div class="mt-3 grid gap-2 sm:grid-cols-2">
								{#each bookingState.availableSlots as slot (slot.id)}
									<button class="btn-secondary justify-start text-left" type="button" onclick={() => act('/hold', { slotId: slot.id })} disabled={busy}>{slotLabel(slot.startsAt, slot.timezone)}</button>
								{/each}
							</div>
						</div>
					{/if}

					{#if bookingState.session.status === 'held' && bookingState.session.heldSlot}
						<div class="border-t border-emerald-300 bg-emerald-50 px-4 py-5 text-emerald-950 dark:border-emerald-900 dark:bg-emerald-950/45 dark:text-emerald-100 sm:px-6">
							<p class="text-sm font-bold">Held: {slotLabel(bookingState.session.heldSlot.startsAt, bookingState.session.heldSlot.timezone)}</p>
							<p class="mt-1 text-xs leading-5 opacity-80">This is not booked until you confirm.</p>
							<div class="mt-3 flex flex-col gap-2 sm:flex-row"><button class="btn" type="button" onclick={() => act('/confirm')} disabled={busy}>{busy ? 'Confirming…' : 'Confirm appointment'}</button><button class="btn-secondary" type="button" onclick={() => act('/cancel', { reason: 'Visitor released the held time' })} disabled={busy}>Release hold</button></div>
						</div>
					{/if}

					{#if bookingState.session.status === 'booked' && bookingState.appointment}
						<div class="border-t border-emerald-300 bg-emerald-50 px-5 py-6 text-center text-emerald-950 dark:border-emerald-900 dark:bg-emerald-950/45 dark:text-emerald-100" role="status">
							<p class="text-xl font-bold">Appointment booked</p><p class="mt-2 text-sm">{slotLabel(bookingState.appointment.startsAt, bookingState.appointment.timezone)}</p><p class="mt-1 text-xs opacity-80">A confirmation text follows the same consent and quiet-hour protections as every Kiso message.</p>
						</div>
					{:else if bookingState.session.status === 'cancelled'}
						<div class="border-t border-line px-5 py-6 text-center" role="status"><p class="text-lg font-bold">Booking cancelled</p><p class="mt-1 text-sm text-muted">The team still has the lead context if you need help later.</p></div>
					{:else if bookingState.session.status === 'expired'}
						<div class="border-t border-amber-300 bg-amber-50 px-5 py-6 text-center text-amber-950 dark:border-amber-900 dark:bg-amber-950/45 dark:text-amber-100" role="status"><p class="text-lg font-bold">This chat timed out</p><p class="mt-1 text-sm opacity-80">The request is visible to the team for human follow-up.</p></div>
					{/if}

					{#if canChat && bookingState.session.status !== 'offering'}
						<form class="border-t border-line p-3 sm:p-4" onsubmit={send}>
							<label class="sr-only" for="booking-message">Message</label>
							<div class="flex items-end gap-2"><textarea id="booking-message" class="input min-h-12 flex-1 resize-none" rows="1" maxlength="2000" bind:value={chatBody} placeholder={bookingState.session.status === 'handoff' ? 'Add a message for the team' : 'Reply with the issue and service address'}></textarea><button class="btn min-h-12" type="submit" disabled={busy || !chatBody.trim()}>{busy ? 'Sending…' : 'Send'}</button></div>
						</form>
					{/if}
					{#if errorMessage}<p class="m-4 rounded-xl border border-red-300 bg-red-50 p-3 text-sm font-medium text-red-800 dark:border-red-900 dark:bg-red-950/50 dark:text-red-200" role="alert">{errorMessage}</p>{/if}
				</div>
			{/if}
		</section>
		<p class="mt-4 text-center text-[11px] leading-5 text-muted">Powered by Kiso CRM · Availability is verified before booking</p>
	</div>
</main>
