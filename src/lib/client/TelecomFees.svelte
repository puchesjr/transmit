<script lang="ts">
	import { createQuery, useQueryClient } from '@tanstack/svelte-query';
	import { TELECOM_PRICE } from '$lib/pricing';
	import { api } from './api';
	import ErrorText from './ErrorText.svelte';

	type Summary = {
		acceptedVersion: string | null;
		charges: {
			id: string;
			description: string;
			amountCents: number;
			status: string;
			invoiceUrl: string | null;
		}[];
	};

	const client = useQueryClient();
	const query = createQuery(() => ({
		queryKey: ['telecom-fees'],
		queryFn: () => api.get<Summary>('/api/v1/billing/telecom'),
		refetchInterval: 5000
	}));
	let checked = $state(false);
	let busy = $state(false);
	let error = $state<unknown>(null);

	async function accept() {
		if (!checked) return;
		busy = true;
		error = null;
		try {
			await api.post('/api/v1/billing/telecom', { version: TELECOM_PRICE.version });
			await client.invalidateQueries({ queryKey: ['telecom-fees'] });
		} catch (e) {
			error = e;
		} finally {
			busy = false;
		}
	}

	async function refresh(id: string) {
		busy = true;
		error = null;
		try {
			await api.put('/api/v1/billing/telecom', { chargeId: id });
			await client.invalidateQueries({ queryKey: ['telecom-fees'] });
		} catch (e) {
			error = e;
		} finally {
			busy = false;
		}
	}
</script>

<section class="card my-4 min-w-0 p-4 sm:p-5" aria-label="Carrier fees">
	<h2 class="panel-title">The phone company still charges</h2>
	<p class="mt-2 text-sm leading-6 text-muted">
		The 14-day trial is for Kiso. It is not for AT&amp;T, Verizon, or T-Mobile. If you want to text from a local number, they require every business to register. They call that 10DLC. We bill you what they bill us. We do not take a cut.
	</p>
	<ul class="mt-3 space-y-1.5 text-sm leading-6 text-muted">
		<li>$24 to file. That covers naming the business, the review, and the first three months.</li>
		<li>Then $1.50 a month for the registration, and $1.10 a month for the number.</li>
		<li>Calls are billed at cost. Texts after your included amount are $0.02 each, both ways.</li>
	</ul>
	<p class="mt-3 text-sm leading-6 text-muted">
		You need a business EIN. If you don't have one, talk to us first. If they reject the filing, the $24 does not come back. A new review is another $15, and you approve it separately.
	</p>
	{#if query.data?.acceptedVersion !== TELECOM_PRICE.version}
		<label class="mt-4 flex items-start gap-3 text-sm">
			<input class="mt-1" type="checkbox" bind:checked={checked} disabled={query.isPending || busy} />
			<span>I understand. The 14-day trial is for Kiso. Carrier fees still apply.</span>
		</label>
		<button class="btn-secondary mt-3" type="button" onclick={accept} disabled={busy || !checked}>
			{busy ? 'Saving…' : 'Accept carrier fees'}
		</button>
	{:else}
		<p class="mt-3 text-sm font-semibold">Carrier fees accepted.</p>
	{/if}
	<ErrorText error={error ?? query.error} />
	{#each query.data?.charges ?? [] as charge (charge.id)}
		<div class="mt-3 border-t border-line pt-3 text-sm">
			<p class="break-words">
				{charge.description} · ${(charge.amountCents / 100).toFixed(2)} · {charge.status === 'review'
					? 'Needs a person to look at it'
					: charge.status}
			</p>
			{#if charge.status === 'pending'}
				{#if charge.invoiceUrl}
					<a
						class="mt-2 inline-block font-semibold text-accent underline"
						href={charge.invoiceUrl}
						target="_blank"
						rel="noreferrer noopener"
						aria-label={`Pay invoice: ${charge.description}`}
					>
						Pay this invoice
					</a>
				{/if}
				<button
					class="btn-secondary mt-2 ml-2"
					type="button"
					onclick={() => refresh(charge.id)}
					disabled={busy}
					aria-label={`Check payment for ${charge.description}`}
				>
					Check payment
				</button>
			{/if}
		</div>
	{/each}
</section>
