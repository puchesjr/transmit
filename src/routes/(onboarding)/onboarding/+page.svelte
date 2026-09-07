<script lang="ts">
	import TelecomFees from '$lib/client/TelecomFees.svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { createQuery, useQueryClient } from '@tanstack/svelte-query';
	import { api } from '$lib/client/api';
	import ErrorText from '$lib/client/ErrorText.svelte';
	import { LAUNCH_PRICE } from '$lib/pricing';
	import type { OnboardingSnapshot, OnboardingStep, VoiceSettings } from '$lib/types';

	const queryClient = useQueryClient();
	const STEPS: { id: Exclude<OnboardingStep, 'ready'>; label: string }[] = [
		{ id: 'trial', label: 'Trial' },
		{ id: 'register', label: 'Register' },
		{ id: 'number', label: 'Number' },
		{ id: 'calls', label: 'Calls' }
	];
	const STEP_ORDER: OnboardingStep[] = ['trial', 'register', 'number', 'calls', 'ready'];

	const onboardingQuery = createQuery(() => ({
		queryKey: ['onboarding-status'],
		queryFn: () => api.get<{ onboarding: OnboardingSnapshot }>('/api/v1/onboarding/status')
	}));

	let viewingStep = $state<OnboardingStep | null>(null);
	let snapshot = $derived(onboardingQuery.data?.onboarding ?? null);
	let currentStep = $derived(snapshot?.currentStep ?? 'trial');
	let step = $derived(viewingStep ?? currentStep);

	const voiceQuery = createQuery(() => ({
		queryKey: ['voice-settings'],
		queryFn: () => api.get<{ settings: VoiceSettings }>('/api/v1/voice/settings'),
		enabled: step === 'calls'
	}));

	let starting = $state(false);
	let dismissing = $state(false);
	let finishing = $state(false);
	let actionError = $state<unknown>(null);

	let legalName = $state('');
	let ein = $state('');
	let contactEmail = $state('');
	let contactPhone = $state('');
	let address = $state('');
	let city = $state('');
	let region = $state('');
	let postalCode = $state('');
	let useCase = $state('Customer service and appointment follow-ups for our business.');
	let sampleMessage = $state('Hi {name}, thanks for reaching out - how can we help? Reply STOP to opt out.');
	let registrationPrefill = $state(false);
	let submittingRegistration = $state(false);
	let registrationError = $state<unknown>(null);

	let areaCode = $state('');
	let searchResults = $state<{ e164: string }[]>([]);
	let searching = $state(false);
	let searchError = $state<unknown>(null);
	let buyingE164 = $state<string | null>(null);
	let buyError = $state<unknown>(null);

	let forwardingNumber = $state('');
	let timezone = $state('America/Chicago');
	let voiceLoaded = $state(false);
	let savingVoice = $state(false);
	let voiceError = $state<unknown>(null);

	$effect(() => {
		const next = snapshot;
		if (!next || registrationPrefill) return;
		legalName = next.workspaceName;
		contactEmail = next.userEmail;
		registrationPrefill = true;
	});

	$effect(() => {
		const settings = voiceQuery.data?.settings;
		if (!settings || voiceLoaded) return;
		forwardingNumber = settings.forwardingNumber ?? '';
		timezone = settings.timezone;
		voiceLoaded = true;
	});

	function canView(id: OnboardingStep): boolean {
		return STEP_ORDER.indexOf(id) <= STEP_ORDER.indexOf(currentStep);
	}

	function checkoutCanceled(): boolean {
		return page.url.searchParams.get('checkout') === 'canceled';
	}

	function trialEndLabel(value: string | null): string {
		if (!value) return '14 days from today';
		return new Intl.DateTimeFormat('en-US', {
			month: 'short',
			day: 'numeric',
			year: 'numeric',
			timeZone: 'UTC'
		}).format(new Date(value));
	}

	async function refreshStatus(next: OnboardingStep | null = null) {
		await queryClient.invalidateQueries({ queryKey: ['onboarding-status'] });
		viewingStep = next;
	}

	async function startTrial() {
		actionError = null;
		starting = true;
		try {
			const result = await api.post<{ url: string }>('/api/v1/billing/checkout', {
				returnTo: 'onboarding'
			});
			window.location.assign(result.url);
		} catch (error) {
			actionError = error;
			starting = false;
		}
	}

	async function submitRegistration(event: SubmitEvent) {
		event.preventDefault();
		registrationError = null;
		submittingRegistration = true;
		try {
			await api.post('/api/v1/messaging/registration', {
				legalName,
				ein,
				website: null,
				address,
				city,
				region,
				postalCode,
				contactEmail,
				contactPhone,
				useCase,
				sampleMessage
			});
			await refreshStatus();
		} catch (error) {
			registrationError = error;
		} finally {
			submittingRegistration = false;
		}
	}

	async function searchNumbers(event: SubmitEvent) {
		event.preventDefault();
		searchError = null;
		searching = true;
		try {
			const result = await api.post<{ numbers: { e164: string }[] }>(
				'/api/v1/messaging/numbers/search',
				{ areaCode }
			);
			searchResults = result.numbers;
		} catch (error) {
			searchError = error;
		} finally {
			searching = false;
		}
	}

	async function buyNumber(e164: string) {
		buyError = null;
		buyingE164 = e164;
		try {
			await api.post('/api/v1/messaging/numbers', { e164 });
			searchResults = [];
			await refreshStatus();
		} catch (error) {
			buyError = error;
		} finally {
			buyingE164 = null;
		}
	}

	async function saveCalls(event: SubmitEvent) {
		event.preventDefault();
		voiceError = null;
		savingVoice = true;
		try {
			const settings = voiceQuery.data?.settings;
			if (!settings) throw new Error('Call settings have not loaded yet');
			await api.put('/api/v1/voice/settings', {
				...settings,
				forwardingNumber: forwardingNumber.trim() || null,
				timezone
			});
			await queryClient.invalidateQueries({ queryKey: ['voice-settings'] });
			await refreshStatus('ready');
		} catch (error) {
			voiceError = error;
		} finally {
			savingVoice = false;
		}
	}

	async function skipCalls() {
		viewingStep = 'ready';
	}

	async function dismiss() {
		actionError = null;
		dismissing = true;
		try {
			await api.post('/api/v1/onboarding/complete', { action: 'dismiss' });
			await goto(resolve('/inbox'));
		} catch (error) {
			actionError = error;
			dismissing = false;
		}
	}

	async function openInbox() {
		actionError = null;
		finishing = true;
		try {
			await api.post('/api/v1/onboarding/complete', { action: 'complete' });
			await goto(resolve('/inbox'));
		} catch (error) {
			actionError = error;
			finishing = false;
		}
	}
</script>

<div class="flex flex-1 flex-col">
	<div class="mb-6">
		<p class="text-xs font-bold tracking-[0.12em] text-accent uppercase">You're in</p>
		<h1 class="mt-2 text-3xl font-bold tracking-[-0.045em]">The software is free for 14 days.</h1>
		<p class="mt-2 text-sm leading-6 text-muted">
			The phone company is not. They make every business that texts register. That's 10DLC. We pass their fee through. We don't hide it, and we don't skip it.
		</p>
	</div>

	<ol class="mb-6 grid grid-cols-4 gap-2" aria-label="Setup steps">
		{#each STEPS as item, index (item.id)}
			<li>
				<button
					class={`flex w-full flex-col items-start rounded-2xl border px-2.5 py-2.5 text-left transition sm:px-3 ${
						step === item.id || (step === 'ready' && item.id === 'calls' && currentStep === 'ready')
							? 'border-accent/40 bg-accent/8 text-ink'
							: canView(item.id)
								? 'border-line bg-paper text-ink hover:border-accent/30'
								: 'border-line/70 bg-paper/60 text-muted'
					}`}
					type="button"
					aria-current={step === item.id ? 'step' : undefined}
					disabled={!canView(item.id)}
					onclick={() => (viewingStep = item.id)}
				>
					<span class="text-[10px] font-bold tracking-[0.12em] uppercase">{index + 1}</span>
					<span class="mt-1 text-xs font-semibold sm:text-sm">{item.label}</span>
				</button>
			</li>
		{/each}
	</ol>

	{#if onboardingQuery.isPending}
		<div class="card p-6 text-sm text-muted">Loading your setup…</div>
	{:else if onboardingQuery.error}
		<div class="card space-y-4 p-6">
			<ErrorText error={onboardingQuery.error} />
			<button class="btn-secondary" type="button" onclick={() => onboardingQuery.refetch()}>Try again</button>
		</div>
	{:else if snapshot}
		<section class="card overflow-hidden">
			{#if step === 'register' || step === 'number'}<TelecomFees />{/if}
			{#if step === 'trial'}
				<div class="bg-sidebar p-6 text-white sm:p-8">
					<p class="text-xs font-bold tracking-[0.12em] text-white/65 uppercase">Step 1</p>
					<h2 class="mt-3 text-2xl font-bold tracking-[-0.035em]">This is trial software.</h2>
					<p class="mt-2 max-w-md text-sm leading-6 text-white/65">
						Kiso is free until {trialEndLabel(snapshot.trialEndsAt)}. Then it's ${LAUNCH_PRICE.locationMonthlyDollars} a month per location. We keep a card on file so you can get a number. Registration, the number, and calls are carrier bills. They are due when you file, trial or not.
					</p>
					<ul class="mt-5 space-y-2 text-sm text-white/80">
						<li>{LAUNCH_PRICE.trialOutboundMessages} SMS segments during the trial</li>
						<li>Then {LAUNCH_PRICE.includedSmsCredits} segments a month, then ${LAUNCH_PRICE.messageDollars.toFixed(2)} each</li>
						<li>Cancel before day 14 and Kiso stays free</li>
					</ul>
				</div>
				<div class="space-y-4 p-5 sm:p-6">
					{#if checkoutCanceled()}
						<p class="rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-sm font-medium text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">
							Checkout was canceled. Start the trial when you are ready.
						</p>
					{/if}
					{#if snapshot.trialStarted}
						<p class="text-sm text-muted">Trial is already active.</p>
						<button class="btn" type="button" onclick={() => (viewingStep = null)}>Continue</button>
					{:else}
						<button class="btn min-h-12 w-full sm:w-auto" type="button" onclick={startTrial} disabled={starting}>
							{starting ? 'Opening checkout…' : 'Start the software trial'}
						</button>
						<p class="text-sm text-muted">Next the carriers. That's 10DLC. That's their fee, not ours.</p>
						{#if snapshot.providerMode === 'demo'}
							<p class="text-xs text-muted">Demo billing · no card charged in this environment.</p>
						{/if}
					{/if}
					<ErrorText error={actionError} />
				</div>
			{:else if step === 'register'}
				<div class="panel-heading">
					<div>
						<h2 class="panel-title">The carriers require this</h2>
						<p class="mt-0.5 text-xs text-muted">
							If this number is going to text as your shop, AT&amp;T, Verizon, and T-Mobile have to know who you are. That's 10DLC. It takes a few days. We can't send on someone else's registration.
							{#if snapshot.providerMode === 'demo'}
								This demo approves at once. Live accounts wait on the carriers.
							{/if}
						</p>
					</div>
				</div>
				<div class="p-5 sm:p-6">
					{#if snapshot.registrationStatus}
						<div class="rounded-2xl bg-canvas p-4">
							<p class="text-sm font-semibold capitalize">{snapshot.registrationStatus}</p>
							<p class="mt-1 text-sm text-muted">
								{#if snapshot.registrationStatus === 'approved'}
									The carriers said yes. You can text.
								{:else if snapshot.registrationStatus === 'submitted'}
									They're reading it. That usually takes a few business days. You can still pick a number. It just won't send yet.
								{:else}
									They said no. Keep going, then talk to us before you pay to file again.
								{/if}
							</p>
						</div>
						<button class="btn mt-4" type="button" onclick={() => (viewingStep = null)}>Continue</button>
					{:else}
						<form class="grid gap-4 sm:grid-cols-2" onsubmit={submitRegistration}>
							<div class="sm:col-span-2">
								<label class="label" for="reg-legal">Legal business name</label>
								<input id="reg-legal" class="input" bind:value={legalName} required />
							</div>
							<div>
								<label class="label" for="reg-email">Contact email</label>
								<input id="reg-email" class="input" type="email" bind:value={contactEmail} required />
							</div>
							<div>
								<label class="label" for="reg-phone">Business phone</label>
								<input id="reg-phone" class="input" bind:value={contactPhone} required placeholder="5125550100" autocomplete="tel" />
							</div>
							<div>
								<label class="label" for="reg-ein">Business EIN</label>
								<input id="reg-ein" class="input" bind:value={ein} required placeholder="12-3456789" />
							</div>
							<div class="sm:col-span-2">
								<label class="label" for="reg-address">Business address</label>
								<input id="reg-address" class="input" bind:value={address} required autocomplete="street-address" />
							</div>
							<div>
								<label class="label" for="reg-city">City</label>
								<input id="reg-city" class="input" bind:value={city} required autocomplete="address-level2" />
							</div>
							<div class="grid grid-cols-2 gap-4">
								<div>
									<label class="label" for="reg-region">State</label>
									<input id="reg-region" class="input" bind:value={region} required maxlength="2" autocomplete="address-level1" />
								</div>
								<div>
									<label class="label" for="reg-zip">ZIP</label>
									<input id="reg-zip" class="input" bind:value={postalCode} required inputmode="numeric" autocomplete="postal-code" />
								</div>
							</div>
							<div class="sm:col-span-2">
								<label class="label" for="reg-usecase">What will you text about?</label>
								<textarea id="reg-usecase" class="input" rows="2" bind:value={useCase} required></textarea>
							</div>
							<div class="sm:col-span-2">
								<label class="label" for="reg-sample">Sample message</label>
								<textarea id="reg-sample" class="input" rows="2" bind:value={sampleMessage} required></textarea>
							</div>
							<div class="sm:col-span-2">
								<ErrorText error={registrationError} />
							</div>
							<div class="sm:col-span-2">
								<button class="btn min-h-12 w-full sm:w-auto" type="submit" disabled={submittingRegistration}>
									{submittingRegistration ? 'Submitting…' : 'Submit registration'}
								</button>
							</div>
						</form>
					{/if}
				</div>
			{:else if step === 'number'}
				<div class="panel-heading">
					<div>
						<h2 class="panel-title">A number for this shop</h2>
						<p class="mt-0.5 text-xs text-muted">One local number per location. You can buy it now. It will not send until the carriers say yes.</p>
					</div>
				</div>
				<div class="space-y-5 p-5 sm:p-6">
					{#if snapshot.hasNumber}
						<div class="rounded-2xl bg-canvas p-4">
							<p class="text-sm font-semibold">{snapshot.numberE164}</p>
							<p class="mt-1 text-sm text-muted">This is the number. Sending still waits on the carriers if they haven't approved you yet.</p>
						</div>
						<button class="btn" type="button" onclick={() => (viewingStep = null)}>Continue</button>
					{:else}
						<form class="flex flex-col items-stretch gap-3 rounded-2xl bg-canvas p-4 sm:flex-row sm:items-end" onsubmit={searchNumbers}>
							<div class="sm:flex-1">
								<label class="label" for="area-code">Area code (optional)</label>
								<input id="area-code" class="input sm:max-w-48" bind:value={areaCode} placeholder="512" inputmode="numeric" />
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
											type="button"
											onclick={() => buyNumber(result.e164)}
											disabled={buyingE164 !== null}
										>
											{buyingE164 === result.e164 ? 'Buying…' : 'Use this number'}
										</button>
									</li>
								{/each}
							</ul>
						{/if}
						<ErrorText error={buyError} />
					{/if}
				</div>
			{:else if step === 'calls'}
				<div class="panel-heading">
					<div>
						<h2 class="panel-title">When they miss you, we text them</h2>
						<p class="mt-0.5 text-xs text-muted">Ring the owner's cell. If nobody picks up, the customer gets a text from this number.</p>
					</div>
				</div>
				<form class="space-y-4 p-5 sm:p-6" onsubmit={saveCalls}>
					{#if voiceQuery.isError}
						<ErrorText error={voiceQuery.error} />
					{/if}
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
					<ErrorText error={voiceError} />
					<div class="flex flex-col gap-3 sm:flex-row">
						<button class="btn min-h-12" type="submit" disabled={savingVoice}>
							{savingVoice ? 'Saving…' : 'Save and continue'}
						</button>
						<button class="btn-secondary min-h-12" type="button" onclick={skipCalls}>Skip for now</button>
					</div>
				</form>
			{:else}
				<div class="p-6 sm:p-8">
					<p class="text-xs font-bold tracking-[0.12em] text-accent uppercase">That's it</p>
					<h2 class="mt-3 text-2xl font-bold tracking-[-0.035em]">The shop is open.</h2>
					<p class="mt-2 text-sm leading-6 text-muted">Kiso is on trial. If the carriers are still reading the paperwork, that's normal. Texts wait. The inbox does not.</p>
					<ul class="mt-6 space-y-3 text-sm">
						<li class="flex items-start gap-3">
							<span class="mt-0.5 font-bold text-accent">1</span>
							<span
								>{snapshot.trialStarted
									? `Kiso is free through ${trialEndLabel(snapshot.trialEndsAt)}`
									: 'Software trial not started'}</span
							>
						</li>
						<li class="flex items-start gap-3">
							<span class="mt-0.5 font-bold text-accent">2</span>
							<span
								>{snapshot.registrationStatus === 'approved'
									? 'The carriers said yes'
									: snapshot.registrationStatus === 'submitted'
										? 'The carriers have the paperwork'
										: snapshot.registrationStatus === 'rejected'
											? 'The carriers said no'
											: 'Still need to register with the carriers'}</span
							>
						</li>
						<li class="flex items-start gap-3">
							<span class="mt-0.5 font-bold text-accent">3</span>
							<span>{snapshot.numberE164 ?? 'No shop number yet'}</span>
						</li>
						<li class="flex items-start gap-3">
							<span class="mt-0.5 font-bold text-accent">4</span>
							<span
								>{snapshot.forwardingNumber
									? `Missed calls go to ${snapshot.forwardingNumber}`
									: 'Missed-call forwarding can wait'}</span
							>
						</li>
					</ul>
					<button class="btn mt-6 min-h-12" type="button" onclick={openInbox} disabled={finishing}>
						{finishing ? 'Opening inbox…' : 'Open the inbox'}
					</button>
					<ErrorText error={actionError} />
				</div>
			{/if}
		</section>
	{/if}

	{#if step !== 'ready'}
		<div class="mt-6 flex justify-center">
			<button
				class="text-sm font-semibold text-muted underline decoration-line underline-offset-4 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-50"
				type="button"
				onclick={dismiss}
				disabled={dismissing}
			>
				{dismissing ? 'Leaving setup…' : 'Set up later'}
			</button>
		</div>
	{/if}
</div>
