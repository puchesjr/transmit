<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { api } from '$lib/client/api';
	import ErrorText from '$lib/client/ErrorText.svelte';

	let email = $state('');
	let password = $state('');
	let error = $state<unknown>(null);
	let pending = $state(false);

	async function onsubmit(event: SubmitEvent) {
		event.preventDefault();
		error = null;
		pending = true;
		try {
			await api.post('/api/v1/auth/signin', { email, password });
			await goto(resolve('/contacts'));
		} catch (err) {
			error = err;
		} finally {
			pending = false;
		}
	}
</script>

<div class="card p-6 shadow-sm">
	<h1 class="text-xl font-semibold tracking-tight">Sign in</h1>
	<p class="mt-1 text-sm text-muted">Email and password for this workspace.</p>

	<form class="mt-6 space-y-4" method="post" {onsubmit}>
		<div>
			<label class="label" for="email">Email</label>
			<input id="email" class="input" type="email" autocomplete="email" bind:value={email} required />
		</div>
		<div>
			<label class="label" for="password">Password</label>
			<input
				id="password"
				class="input"
				type="password"
				autocomplete="current-password"
				bind:value={password}
				required
			/>
		</div>
		<ErrorText {error} />
		<button class="btn w-full" type="submit" disabled={pending}>
			{pending ? 'Signing in…' : 'Sign in'}
		</button>
	</form>

	<p class="mt-4 text-center text-sm text-muted">
		New here?
		<a class="text-accent hover:underline" href={resolve('/signup')}>Create a workspace</a>
	</p>
</div>
