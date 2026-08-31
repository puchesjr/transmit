<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { api } from '$lib/client/api';
	import ErrorText from '$lib/client/ErrorText.svelte';

	let name = $state('');
	let workspaceName = $state('');
	let email = $state('');
	let password = $state('');
	let error = $state<unknown>(null);
	let pending = $state(false);

	async function onsubmit(event: SubmitEvent) {
		event.preventDefault();
		error = null;
		pending = true;
		try {
			await api.post('/api/v1/auth/signup', { name, workspaceName, email, password });
			await goto(resolve('/contacts'));
		} catch (err) {
			error = err;
		} finally {
			pending = false;
		}
	}
</script>

<div class="card p-6 shadow-sm">
	<h1 class="text-xl font-semibold tracking-tight">Create a workspace</h1>
	<p class="mt-1 text-sm text-muted">Sign up with an email. You become the owner.</p>

	<form class="mt-6 space-y-4" method="post" {onsubmit}>
		<div>
			<label class="label" for="name">Name</label>
			<input id="name" class="input" autocomplete="name" bind:value={name} required />
		</div>
		<div>
			<label class="label" for="workspace">Workspace</label>
			<input id="workspace" class="input" bind:value={workspaceName} required />
		</div>
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
				autocomplete="new-password"
				bind:value={password}
				minlength="8"
				required
			/>
		</div>
		<ErrorText {error} />
		<button class="btn w-full" type="submit" disabled={pending}>
			{pending ? 'Creating…' : 'Create workspace'}
		</button>
	</form>

	<p class="mt-4 text-center text-sm text-muted">
		Already have an account?
		<a class="text-accent hover:underline" href={resolve('/signin')}>Sign in</a>
	</p>
</div>
