<script lang="ts">
	import { onMount } from 'svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	let firstName = $state('');
	let lastName = $state('');
	let phone = $state('');
	let email = $state('');
	let requestedService = $state('');
	let preferredTime = $state('');
	let message = $state('');
	let website = $state('');
	let consent = $state(false);
	let sourcePage = $state('');
	let referrer = $state('');
	let campaign = $state<Record<string, string>>({});
	let submissionKey = $state('');
	let submitting = $state(false);
	let submitted = $state(false);
	let errorMessage = $state('');

	let needsService = $derived(data.form.kind !== 'question');
	let needsPreferredTime = $derived(data.form.kind === 'appointment');
	let needsMessage = $derived(data.form.kind === 'question');

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
	});

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		submitting = true;
		errorMessage = '';
		try {
			const response = await fetch(`/api/v1/public/forms/${encodeURIComponent(data.form.publicKey)}`, {
				method: 'POST',
				headers: { 'content-type': 'application/json', accept: 'application/json' },
				body: JSON.stringify({
					firstName,
					lastName,
					phone,
					email,
					requestedService,
					preferredTime,
					message,
					website,
					consent,
					sourcePage,
					referrer,
					campaign,
					submissionKey
				})
			});
			const body = (await response.json().catch(() => ({}))) as {
				error?: { message?: string };
			};
			if (!response.ok) throw new Error(body.error?.message ?? 'We could not send your request.');
			submitted = true;
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : 'We could not send your request.';
		} finally {
			submitting = false;
		}
	}
</script>

<svelte:head>
	<title>{data.form.title} · {data.form.accountName}</title>
	<meta name="description" content={data.form.intro} />
	<meta name="robots" content="noindex, nofollow" />
</svelte:head>

<main class="relative min-h-dvh overflow-hidden bg-canvas px-4 py-6 text-ink sm:px-6 sm:py-10">
	<div class="pointer-events-none absolute -top-40 left-1/2 h-80 w-[36rem] -translate-x-1/2 rounded-full bg-accent/10 blur-3xl" aria-hidden="true"></div>
	<div class="relative mx-auto w-full max-w-xl">
		<header class="mb-5 flex items-center gap-3 px-1 sm:mb-7">
			<span class="flex size-10 items-center justify-center rounded-2xl bg-action text-lg font-black text-white shadow-lg shadow-accent/20" aria-hidden="true">T</span>
			<div>
				<p class="text-sm font-bold tracking-[-0.015em]">{data.form.accountName}</p>
				<p class="text-xs text-muted">{data.form.locationName}</p>
			</div>
		</header>

		<section class="card overflow-hidden">
			<div class="border-b border-line/80 bg-paper px-5 py-6 sm:px-8 sm:py-8">
				<p class="text-xs font-bold tracking-[0.12em] text-accent uppercase">Fast response by text</p>
				<h1 class="mt-2 text-3xl font-bold tracking-[-0.045em] sm:text-4xl">{data.form.title}</h1>
				<p class="mt-3 max-w-md text-sm leading-6 text-muted sm:text-base">{data.form.intro}</p>
			</div>

			{#if submitted}
				<div class="flex min-h-80 flex-col items-center justify-center px-6 py-12 text-center" role="status" tabindex="-1">
					<span class="flex size-14 items-center justify-center rounded-full bg-emerald-100 text-2xl text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200" aria-hidden="true">✓</span>
					<h2 class="mt-5 text-2xl font-bold tracking-[-0.035em]">Your request is in.</h2>
					<p class="mt-2 max-w-sm text-sm leading-6 text-muted">
						Watch for a text from {data.form.accountName}. You can reply directly to keep the conversation moving.
					</p>
				</div>
			{:else}
				<form class="space-y-5 bg-paper px-5 py-6 sm:px-8 sm:py-8" onsubmit={submit}>
					<div class="grid gap-4 sm:grid-cols-2">
						<label>
							<span class="label">First name</span>
							<input class="input" bind:value={firstName} name="firstName" autocomplete="given-name" required maxlength="100" />
						</label>
						<label>
							<span class="label">Last name <span class="font-normal text-muted">(optional)</span></span>
							<input class="input" bind:value={lastName} name="lastName" autocomplete="family-name" maxlength="100" />
						</label>
					</div>

					<label>
						<span class="label">Mobile phone</span>
						<input class="input" bind:value={phone} name="phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="(555) 123-4567" required aria-describedby="phone-help" />
						<span id="phone-help" class="mt-1.5 block text-xs leading-5 text-muted">We’ll send your confirmation and continue the conversation here.</span>
					</label>

					<label>
						<span class="label">Email <span class="font-normal text-muted">(optional)</span></span>
						<input class="input" bind:value={email} name="email" type="email" autocomplete="email" maxlength="320" />
					</label>

					{#if needsService}
						<label>
							<span class="label">What can we help with?</span>
							<input class="input" bind:value={requestedService} name="requestedService" autocomplete="off" placeholder="e.g. AC repair" required maxlength="200" />
						</label>
					{/if}

					{#if needsPreferredTime}
						<label>
							<span class="label">Preferred day or time</span>
							<input class="input" bind:value={preferredTime} name="preferredTime" autocomplete="off" placeholder="e.g. Tuesday morning" required maxlength="200" aria-describedby="time-help" />
							<span id="time-help" class="mt-1.5 block text-xs leading-5 text-muted">This is a request. The team will confirm availability by text.</span>
						</label>
					{/if}

					<label>
						<span class="label">{needsMessage ? 'Your question' : 'Anything else?'} {#if !needsMessage}<span class="font-normal text-muted">(optional)</span>{/if}</span>
						<textarea class="input min-h-28 resize-y" bind:value={message} name="message" rows="4" required={needsMessage} maxlength="2000" placeholder={needsMessage ? 'How can we help?' : 'Add details that will help the team prepare'}></textarea>
					</label>

					<input hidden bind:value={website} name="website" tabindex="-1" autocomplete="off" />

					<label class="flex cursor-pointer items-start gap-3 rounded-2xl border border-line bg-canvas/60 p-4">
						<input class="mt-0.5 size-5 shrink-0 accent-accent" type="checkbox" bind:checked={consent} required />
						<span class="text-xs leading-5 text-muted">{data.form.consentText}</span>
					</label>

					{#if errorMessage}
						<p class="rounded-xl border border-red-300 bg-red-50 p-3 text-sm font-medium text-red-800 dark:border-red-900 dark:bg-red-950/50 dark:text-red-200" role="alert">{errorMessage}</p>
					{/if}

					<button class="btn w-full" type="submit" disabled={submitting || !submissionKey}>
						{submitting ? 'Sending your request…' : `${data.form.title} by text`}
					</button>
					<p class="text-center text-[11px] leading-5 text-muted">Powered by Transmit · Secure lead response</p>
				</form>
			{/if}
		</section>
	</div>
</main>
