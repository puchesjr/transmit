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
			await goto(resolve('/inbox'));
		} catch (err) {
			error = err;
		} finally {
			pending = false;
		}
	}
</script>

<div>
	<p class="mb-3 text-xs font-bold tracking-[0.12em] text-accent uppercase">Welcome back</p>
	<h1 class="text-3xl font-bold tracking-[-0.045em]">Sign in to Kiso CRM</h1>
	<p class="mt-2 text-sm leading-6 text-muted">Pick up your conversations right where you left them.</p>

	<form class="mt-8 space-y-5" method="post" {onsubmit}>
		<div>
			<label class="label" for="email">Email</label>
			<input id="email" class="input min-h-12" type="email" autocomplete="email" placeholder="you@company.com" bind:value={email} required />
		</div>
		<div>
			<label class="label" for="password">Password</label>
			<input
				id="password"
				class="input min-h-12"
				type="password"
				autocomplete="current-password"
				bind:value={password}
				required
			/>
		</div>
		<ErrorText {error} />
		<button class="btn min-h-12 w-full" type="submit" disabled={pending}>
			{pending ? 'Signing in…' : 'Sign in'}
		</button>
		<p class="text-center text-sm text-muted">
			<a class="font-semibold text-ink underline decoration-line underline-offset-4 hover:text-accent" href={resolve('/forgot-password')}>Forgot your password?</a>
		</p>
	</form>

	<p class="mt-7 text-center text-sm text-muted">
		New here?
		<a class="font-semibold text-ink underline decoration-line underline-offset-4 hover:text-accent" href={resolve('/signup')}>Create a workspace</a>
	</p>
</div>
