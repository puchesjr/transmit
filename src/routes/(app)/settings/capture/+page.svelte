<script lang="ts">
	import { onMount } from 'svelte';
	import { createQuery, useQueryClient } from '@tanstack/svelte-query';
	import { api } from '$lib/client/api';
	import ErrorText from '$lib/client/ErrorText.svelte';
	import SettingsNav from '$lib/client/SettingsNav.svelte';
	import type {
		ContactImportResult,
		LeadForm,
		WebhookDelivery,
		WebhookEndpoint,
		WebhookEventType
	} from '$lib/types';

	type CaptureSettings = {
		forms: LeadForm[];
		capturesLast30Days: number;
		ready: boolean;
		readinessMessage: string;
	};
	type WebhookSettings = { endpoints: WebhookEndpoint[]; deliveries: WebhookDelivery[] };
	type FormDraft = { enabled: boolean; replyTemplate: string };

	const queryClient = useQueryClient();
	const captureQuery = createQuery(() => ({
		queryKey: ['lead-capture-settings'],
		queryFn: () => api.get<CaptureSettings>('/api/v1/lead-capture/forms')
	}));
	const webhooksQuery = createQuery(() => ({
		queryKey: ['webhook-settings'],
		queryFn: () => api.get<WebhookSettings>('/api/v1/integrations/webhooks')
	}));

	let origin = $state('');
	let drafts = $state<Record<string, FormDraft>>({});
	let draftsInitialized = $state(false);
	let savingFormId = $state('');
	let formError = $state<unknown>(null);
	let copiedLabel = $state('');
	let endpointUrl = $state('');
	let eventContact = $state(true);
	let eventMessage = $state(true);
	let eventOpportunity = $state(true);
	let creatingEndpoint = $state(false);
	let webhookError = $state<unknown>(null);
	let revealedSecret = $state('');
	let disablingEndpointId = $state('');
	let csvText = $state('');
	let csvFileName = $state('');
	let importing = $state(false);
	let importError = $state<unknown>(null);
	let importResult = $state<ContactImportResult | null>(null);

	$effect(() => {
		if (!draftsInitialized && captureQuery.data?.forms) {
			drafts = Object.fromEntries(
				captureQuery.data.forms.map((form) => [
					form.id,
					{ enabled: form.enabled, replyTemplate: form.replyTemplate }
				])
			);
			draftsInitialized = true;
		}
	});

	onMount(() => {
		origin = window.location.origin;
	});

	function formLabel(kind: LeadForm['kind']): string {
		return {
			service: 'Service request',
			quote: 'Quote request',
			appointment: 'Appointment request',
			question: 'Text us'
		}[kind];
	}

	function formDescription(kind: LeadForm['kind']): string {
		return {
			service: 'Captures the requested service and details.',
			quote: 'Starts a quote conversation with service context.',
			appointment: 'Captures a preferred time for human confirmation.',
			question: 'A simple question-to-text path for your website.'
		}[kind];
	}

	function publicUrl(form: LeadForm): string {
		return `${origin}/capture/${form.publicKey}`;
	}

	function iframeSnippet(form: LeadForm): string {
		return `<iframe src="${publicUrl(form)}" title="${form.title}" width="100%" height="760" style="border:0;border-radius:20px" loading="lazy"></iframe>`;
	}

	let launcherSnippet = $derived.by(() => {
		const forms = captureQuery.data?.forms ?? [];
		const text = forms.find((form) => form.kind === 'question');
		const appointment = forms.find((form) => form.kind === 'appointment');
		const quote = forms.find((form) => form.kind === 'quote');
		if (!origin || !text || !appointment || !quote) return '';
		return `<script defer src="${origin}/embed/kiso.js" data-text-key="${text.publicKey}" data-appointment-key="${appointment.publicKey}" data-quote-key="${quote.publicKey}"><\/script>`;
	});

	async function copyText(value: string, label: string) {
		await navigator.clipboard.writeText(value);
		copiedLabel = label;
		window.setTimeout(() => {
			if (copiedLabel === label) copiedLabel = '';
		}, 1600);
	}

	async function saveForm(form: LeadForm) {
		const draft = drafts[form.id];
		if (!draft) return;
		savingFormId = form.id;
		formError = null;
		try {
			await api.put(`/api/v1/lead-capture/forms/${form.id}`, draft);
			await queryClient.invalidateQueries({ queryKey: ['lead-capture-settings'] });
		} catch (error) {
			formError = error;
		} finally {
			savingFormId = '';
		}
	}

	async function createEndpoint(event: SubmitEvent) {
		event.preventDefault();
		const events: WebhookEventType[] = [];
		if (eventContact) events.push('contact.created');
		if (eventMessage) events.push('message.received');
		if (eventOpportunity) events.push('opportunity.stage_changed');
		creatingEndpoint = true;
		webhookError = null;
		revealedSecret = '';
		try {
			const result = await api.post<{ endpoint: WebhookEndpoint; signingSecret: string }>(
				'/api/v1/integrations/webhooks',
				{ url: endpointUrl, events }
			);
			revealedSecret = result.signingSecret;
			endpointUrl = '';
			await queryClient.invalidateQueries({ queryKey: ['webhook-settings'] });
		} catch (error) {
			webhookError = error;
		} finally {
			creatingEndpoint = false;
		}
	}

	async function disableEndpoint(id: string) {
		disablingEndpointId = id;
		webhookError = null;
		try {
			await api.del(`/api/v1/integrations/webhooks/${id}`);
			await queryClient.invalidateQueries({ queryKey: ['webhook-settings'] });
		} catch (error) {
			webhookError = error;
		} finally {
			disablingEndpointId = '';
		}
	}

	async function selectCsv(event: Event) {
		const file = (event.currentTarget as HTMLInputElement).files?.[0];
		csvText = '';
		csvFileName = '';
		importResult = null;
		importError = null;
		if (!file) return;
		if (file.size > 1_000_000) {
			importError = new Error('Choose a CSV file smaller than 1 MB.');
			return;
		}
		csvFileName = file.name;
		csvText = await file.text();
	}

	async function importCsv() {
		if (!csvText) return;
		importing = true;
		importError = null;
		importResult = null;
		try {
			const response = await api.post<{ result: ContactImportResult }>(
				'/api/v1/imports/contacts',
				{ csv: csvText }
			);
			importResult = response.result;
			await queryClient.invalidateQueries({ queryKey: ['contacts'] });
		} catch (error) {
			importError = error;
		} finally {
			importing = false;
		}
	}
</script>

<svelte:head>
	<title>Lead capture · Kiso CRM</title>
</svelte:head>

<div class="page-wrap max-w-6xl">
	<SettingsNav />

	<header class="page-header">
		<div>
			<p class="mb-2 text-xs font-bold tracking-[0.12em] text-accent uppercase">Workspace settings</p>
			<h1 class="page-title">Lead capture</h1>
			<p class="page-subtitle">Turn website intent into a text conversation while the lead is still warm.</p>
		</div>
		{#if captureQuery.data}
			<span class={`badge self-start sm:self-auto ${captureQuery.data.ready ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200' : 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-100'}`}>
				<span class={`mr-1.5 size-1.5 rounded-full ${captureQuery.data.ready ? 'bg-emerald-500' : 'bg-amber-500'}`}></span>
				{captureQuery.data.ready ? 'Ready to publish' : 'Setup needed'}
			</span>
		{/if}
	</header>

	{#if captureQuery.isPending}
		<div class="card p-8 text-sm text-muted">Preparing lead capture…</div>
	{:else if captureQuery.isError}
		<div class="card p-6"><ErrorText error={captureQuery.error} /></div>
	{:else if captureQuery.data}
		<section class={`rounded-2xl border p-4 sm:p-5 ${captureQuery.data.ready ? 'border-emerald-300 bg-emerald-50 text-emerald-950 dark:border-emerald-900 dark:bg-emerald-950/45 dark:text-emerald-100' : 'border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-900 dark:bg-amber-950/45 dark:text-amber-100'}`}>
			<div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
				<div>
					<h2 class="text-sm font-bold">{captureQuery.data.ready ? 'Your instant-reply path is ready' : 'Finish messaging setup before publishing'}</h2>
					<p class="mt-1 text-sm leading-6 opacity-80">{captureQuery.data.readinessMessage}</p>
				</div>
				<p class="shrink-0 text-sm font-semibold">{captureQuery.data.capturesLast30Days} captured in 30 days</p>
			</div>
		</section>

		<section aria-labelledby="forms-heading">
			<div class="mb-4">
				<h2 id="forms-heading" class="text-xl font-bold tracking-[-0.025em]">Location forms</h2>
				<p class="mt-1 text-sm text-muted">Four focused flows, each routed to this location’s Inbox and lead pipeline.</p>
			</div>
			<div class="grid gap-4 lg:grid-cols-2">
				{#each captureQuery.data.forms as form (form.id)}
					{@const draft = drafts[form.id]}
					<article class="card overflow-hidden">
						<div class="panel-heading items-start">
							<div>
								<p class="text-[10px] font-bold tracking-[0.11em] text-accent uppercase">{formLabel(form.kind)}</p>
								<h3 class="mt-1 text-base font-bold">{form.title}</h3>
								<p class="mt-1 text-xs leading-5 text-muted">{formDescription(form.kind)}</p>
							</div>
							<span class={`badge ${draft?.enabled ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200' : ''}`}>{draft?.enabled ? 'Live' : 'Paused'}</span>
						</div>
						{#if draft}
							<div class="space-y-4 p-4 sm:p-5">
								<label class="flex cursor-pointer items-center justify-between gap-4 rounded-xl border border-line bg-canvas/55 p-3">
									<span class="text-sm font-semibold">Accept submissions</span>
									<input class="size-5 accent-accent" type="checkbox" bind:checked={draft.enabled} />
								</label>
								<label>
									<span class="label">Instant text reply</span>
									<textarea class="input min-h-28 resize-y" rows="4" maxlength="600" bind:value={draft.replyTemplate}></textarea>
									<span class="mt-1.5 block text-xs leading-5 text-muted">Supports &#123;&#123;first_name&#125;&#125;, &#123;&#123;location_name&#125;&#125;, and &#123;&#123;business_name&#125;&#125;. STOP language is required.</span>
								</label>
								<div class="grid gap-2 sm:grid-cols-3">
									<button class="btn sm:col-span-1" type="button" onclick={() => saveForm(form)} disabled={savingFormId === form.id}>{savingFormId === form.id ? 'Saving…' : 'Save'}</button>
									<button class="btn-secondary" type="button" onclick={() => copyText(publicUrl(form), `url-${form.id}`)} disabled={!origin}>{copiedLabel === `url-${form.id}` ? 'Copied' : 'Copy link'}</button>
									<button class="btn-secondary" type="button" onclick={() => copyText(iframeSnippet(form), `embed-${form.id}`)} disabled={!origin}>{copiedLabel === `embed-${form.id}` ? 'Copied' : 'Copy embed'}</button>
								</div>
								{#if origin}<a class="inline-flex text-sm font-semibold text-accent underline decoration-accent/35 underline-offset-4 hover:decoration-accent" href={publicUrl(form)} target="_blank" rel="noreferrer">Preview form <span class="sr-only">{form.title}</span> ↗</a>{/if}
							</div>
						{/if}
					</article>
				{/each}
			</div>
			<ErrorText error={formError} />
		</section>

		<section class="card overflow-hidden" aria-labelledby="launcher-heading">
			<div class="panel-heading">
				<div><h2 id="launcher-heading" class="panel-title">Website launcher</h2><p class="mt-1 text-xs text-muted">One small button with Text us, Request appointment, and Get a quote.</p></div>
				<span class="flex size-9 items-center justify-center rounded-xl bg-accent/10 font-bold text-accent" aria-hidden="true">✦</span>
			</div>
			<div class="grid gap-5 p-4 sm:p-6 lg:grid-cols-[1fr_auto] lg:items-center">
				<div class="min-w-0">
					<p class="label">Install once before the closing &lt;/body&gt; tag</p>
					<textarea class="block min-h-24 w-full resize-y overflow-auto rounded-xl border-0 bg-sidebar p-4 font-mono text-xs leading-6 text-white outline-none focus:ring-2 focus:ring-accent" readonly rows="3" wrap="off" spellcheck="false" aria-label="Website launcher install code" value={launcherSnippet || 'Preparing launcher code…'}></textarea>
				</div>
				<button class="btn-secondary w-full lg:w-auto" type="button" onclick={() => copyText(launcherSnippet, 'launcher')} disabled={!launcherSnippet}>{copiedLabel === 'launcher' ? 'Copied' : 'Copy launcher code'}</button>
			</div>
		</section>
	{/if}

	<section class="grid gap-5 xl:grid-cols-[1.1fr_0.9fr]" aria-labelledby="integrations-heading">
		<div class="card overflow-hidden">
			<div class="panel-heading">
				<div><h2 id="integrations-heading" class="panel-title">Outbound webhooks</h2><p class="mt-1 text-xs text-muted">Send signed events to Zapier-style consumers with automatic retries.</p></div>
			</div>
			<form class="space-y-4 p-4 sm:p-5" onsubmit={createEndpoint}>
				<label><span class="label">HTTPS endpoint</span><input class="input" type="url" bind:value={endpointUrl} required placeholder="https://hooks.example.com/kiso" autocomplete="url" /></label>
				<fieldset>
					<legend class="label">Events</legend>
					<div class="grid gap-2 sm:grid-cols-3">
						<label class="flex min-h-11 items-center gap-2 rounded-xl border border-line px-3 text-xs font-semibold"><input class="size-4 accent-accent" type="checkbox" bind:checked={eventContact} /> Contact created</label>
						<label class="flex min-h-11 items-center gap-2 rounded-xl border border-line px-3 text-xs font-semibold"><input class="size-4 accent-accent" type="checkbox" bind:checked={eventMessage} /> Message received</label>
						<label class="flex min-h-11 items-center gap-2 rounded-xl border border-line px-3 text-xs font-semibold"><input class="size-4 accent-accent" type="checkbox" bind:checked={eventOpportunity} /> Lead stage changed</label>
					</div>
				</fieldset>
				<button class="btn w-full sm:w-auto" type="submit" disabled={creatingEndpoint}>{creatingEndpoint ? 'Adding endpoint…' : 'Add endpoint'}</button>
				<ErrorText error={webhookError} />
			</form>

			{#if revealedSecret}
				<div class="mx-4 mb-4 rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-950 dark:border-amber-900 dark:bg-amber-950/45 dark:text-amber-100" role="status">
					<p class="text-sm font-bold">Copy this signing secret now</p>
					<p class="mt-1 text-xs leading-5 opacity-80">It is shown once. Signatures use HMAC-SHA256 over timestamp + period + raw request body.</p>
					<div class="mt-3 flex flex-col gap-2 sm:flex-row"><code class="min-w-0 flex-1 overflow-x-auto rounded-lg bg-white/70 px-3 py-2 text-xs dark:bg-black/20">{revealedSecret}</code><button class="btn-secondary" type="button" onclick={() => copyText(revealedSecret, 'secret')}>{copiedLabel === 'secret' ? 'Copied' : 'Copy secret'}</button></div>
				</div>
			{/if}

			{#if webhooksQuery.isPending}
				<p class="border-t border-line p-5 text-sm text-muted">Loading endpoints…</p>
			{:else if webhooksQuery.isError}
				<div class="border-t border-line p-5"><ErrorText error={webhooksQuery.error} /></div>
			{:else}
				<ul class="divide-y divide-line border-t border-line">
					{#each webhooksQuery.data?.endpoints ?? [] as endpoint (endpoint.id)}
						<li class="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
							<div class="min-w-0"><p class="truncate text-sm font-semibold">{endpoint.url}</p><p class="mt-1 text-xs text-muted">{endpoint.events.join(' · ')} · secret ••••••{endpoint.secretHint}</p></div>
							{#if endpoint.enabled}<button class="btn-ghost self-start text-red-700 dark:text-red-300" type="button" onclick={() => disableEndpoint(endpoint.id)} disabled={disablingEndpointId === endpoint.id}>{disablingEndpointId === endpoint.id ? 'Disabling…' : 'Disable'}</button>{:else}<span class="badge self-start">Disabled</span>{/if}
						</li>
					{:else}
						<li class="p-5 text-sm text-muted">No webhook endpoints yet.</li>
					{/each}
				</ul>
			{/if}
		</div>

		<div class="card overflow-hidden">
			<div class="panel-heading"><div><h2 class="panel-title">Contact CSV import</h2><p class="mt-1 text-xs text-muted">Bring existing customers into the current location.</p></div></div>
			<div class="space-y-4 p-4 sm:p-5">
				<div class="rounded-xl bg-canvas/70 p-3 text-xs leading-5 text-muted">Up to 500 rows. Supported headers: <code>name</code> or <code>first_name</code>/<code>last_name</code>, plus <code>email</code> and <code>phone</code>. Importing does not grant SMS consent.</div>
				<label class="block"><span class="label">CSV file</span><input class="block w-full text-sm text-muted file:mr-3 file:min-h-10 file:rounded-xl file:border-0 file:bg-sidebar file:px-4 file:text-sm file:font-semibold file:text-white hover:file:bg-ink" type="file" accept=".csv,text/csv" onchange={selectCsv} /></label>
				{#if csvFileName}<p class="text-sm font-semibold">Ready: {csvFileName}</p>{/if}
				<button class="btn w-full sm:w-auto" type="button" onclick={importCsv} disabled={!csvText || importing}>{importing ? 'Importing…' : 'Import contacts'}</button>
				<ErrorText error={importError} />
				{#if importResult}
					<div class="rounded-xl border border-emerald-300 bg-emerald-50 p-4 text-sm text-emerald-950 dark:border-emerald-900 dark:bg-emerald-950/45 dark:text-emerald-100" role="status">
						<p class="font-bold">Import complete</p>
						<p class="mt-1">{importResult.created} created · {importResult.matched} already matched · {importResult.skipped} skipped</p>
						{#if importResult.errors.length}<ul class="mt-2 list-disc space-y-1 pl-5 text-xs">{#each importResult.errors.slice(0, 5) as item}<li>Row {item.row}: {item.message}</li>{/each}</ul>{/if}
					</div>
				{/if}
			</div>
		</div>
	</section>

	{#if webhooksQuery.data && webhooksQuery.data.deliveries.length > 0}
		<section class="card overflow-hidden" aria-labelledby="deliveries-heading">
			<div class="panel-heading"><div><h2 id="deliveries-heading" class="panel-title">Recent webhook deliveries</h2><p class="mt-1 text-xs text-muted">The latest 50 attempts across your endpoints.</p></div></div>
			<ul class="divide-y divide-line">
				{#each webhooksQuery.data.deliveries.slice(0, 10) as delivery (delivery.id)}
					<li class="grid gap-2 px-4 py-3 text-sm sm:grid-cols-[1fr_auto_auto] sm:items-center sm:px-5">
						<span class="font-semibold">{delivery.eventType}</span>
						<span class="text-xs text-muted">{delivery.attempts} {delivery.attempts === 1 ? 'attempt' : 'attempts'}{delivery.responseStatus ? ` · HTTP ${delivery.responseStatus}` : ''}</span>
						<span class={`badge w-fit ${delivery.status === 'delivered' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200' : delivery.status === 'failed' ? 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200' : ''}`}>{delivery.status}</span>
					</li>
				{/each}
			</ul>
		</section>
	{/if}
</div>
