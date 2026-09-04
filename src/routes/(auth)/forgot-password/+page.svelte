<script lang="ts">
	import { resolve } from '$app/paths';
	import { api } from '$lib/client/api';
	import ErrorText from '$lib/client/ErrorText.svelte';

	let email = $state('');
	let error = $state<unknown>(null);
	let pending = $state(false);
	let submitted = $state(false);

	async function onsubmit(event: SubmitEvent) {
		event.preventDefault();
		error = null;
		pending = true;
		try {
			await api.post('/api/v1/auth/password-reset/request', { email });
			submitted = true;
		} catch (err) {
			error = err;
		} finally {
			pending = false;
		}
	}
</script>

<svelte:head>
	<title>Reset your password · Kiso CRM</title>
</svelte:head>

<div>
	<p class="mb-3 text-xs font-bold tracking-[0.12em] text-accent uppercase">Password reset</p>
	<h1 class="text-3xl font-bold tracking-[-0.045em]">Forgot your password?</h1>

	{#if submitted}
		<p class="mt-4 text-sm leading-6 text-muted" role="status">
			If an account exists for <span class="font-semibold text-ink">{email}</span>, a reset link is on its way. It works for one hour.
		</p>
	{:else}
		<p class="mt-2 text-sm leading-6 text-muted">Enter your email and we'll send you a link to choose a new one.</p>
		<form class="mt-8 space-y-5" method="post" {onsubmit}>
			<div>
				<label class="label" for="email">Email</label>
				<input id="email" class="input min-h-12" type="email" autocomplete="email" placeholder="you@company.com" bind:value={email} required />
			</div>
			<ErrorText {error} />
			<button class="btn min-h-12 w-full" type="submit" disabled={pending}>
				{pending ? 'Sending…' : 'Send reset link'}
			</button>
		</form>
	{/if}

	<p class="mt-7 text-center text-sm text-muted">
		Remembered it?
		<a class="font-semibold text-ink underline decoration-line underline-offset-4 hover:text-accent" href={resolve('/signin')}>Sign in</a>
	</p>
</div>
