<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { api } from '$lib/client/api';
	import ErrorText from '$lib/client/ErrorText.svelte';

	const token = $derived(page.url.searchParams.get('token') ?? '');
	let password = $state('');
	let confirm = $state('');
	let error = $state<unknown>(null);
	let pending = $state(false);
	let done = $state(false);

	async function onsubmit(event: SubmitEvent) {
		event.preventDefault();
		error = null;
		if (password !== confirm) {
			error = new Error('The two passwords do not match');
			return;
		}
		pending = true;
		try {
			await api.post('/api/v1/auth/password-reset/confirm', { token, password });
			done = true;
		} catch (err) {
			error = err;
		} finally {
			pending = false;
		}
	}
</script>

<svelte:head>
	<title>Choose a new password · Kiso CRM</title>
</svelte:head>

<div>
	<p class="mb-3 text-xs font-bold tracking-[0.12em] text-accent uppercase">Password reset</p>
	<h1 class="text-3xl font-bold tracking-[-0.045em]">Choose a new password</h1>

	{#if done}
		<p class="mt-4 text-sm leading-6 text-muted" role="status">
			Your password is updated and every other session has been signed out.
		</p>
		<a class="btn mt-8 flex min-h-12 w-full items-center justify-center" href={resolve('/signin')}>Sign in</a>
	{:else if !token}
		<p class="mt-4 text-sm leading-6 text-muted">
			This link is missing its token. Request a new one and open the link from the email.
		</p>
		<a class="btn mt-8 flex min-h-12 w-full items-center justify-center" href={resolve('/forgot-password')}>Request a new link</a>
	{:else}
		<p class="mt-2 text-sm leading-6 text-muted">At least 8 characters. You'll be signed out everywhere else.</p>
		<form class="mt-8 space-y-5" method="post" {onsubmit}>
			<div>
				<label class="label" for="password">New password</label>
				<input id="password" class="input min-h-12" type="password" autocomplete="new-password" minlength="8" bind:value={password} required />
			</div>
			<div>
				<label class="label" for="confirm">Confirm new password</label>
				<input id="confirm" class="input min-h-12" type="password" autocomplete="new-password" minlength="8" bind:value={confirm} required />
			</div>
			<ErrorText {error} />
			<button class="btn min-h-12 w-full" type="submit" disabled={pending}>
				{pending ? 'Saving…' : 'Set new password'}
			</button>
		</form>
	{/if}
</div>
