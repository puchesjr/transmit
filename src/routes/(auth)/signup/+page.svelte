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
			await goto(resolve('/inbox'));
		} catch (err) {
			error = err;
		} finally {
			pending = false;
		}
	}
</script>

<div>
	<p class="mb-3 text-xs font-bold tracking-[0.12em] text-accent uppercase">Start your workspace</p>
	<h1 class="text-3xl font-bold tracking-[-0.045em]">Create a workspace</h1>
	<p class="mt-2 text-sm leading-6 text-muted">A focused home for your team’s contacts, pipeline, and conversations.</p>

	<form class="mt-8 grid gap-5 sm:grid-cols-2" method="post" {onsubmit}>
		<div>
			<label class="label" for="name">Name</label>
			<input id="name" class="input min-h-12" autocomplete="name" placeholder="Your name" bind:value={name} required />
		</div>
		<div>
			<label class="label" for="workspace">Workspace</label>
			<input id="workspace" class="input min-h-12" placeholder="Business name" bind:value={workspaceName} required />
		</div>
		<div class="sm:col-span-2">
			<label class="label" for="email">Email</label>
			<input id="email" class="input min-h-12" type="email" autocomplete="email" placeholder="you@company.com" bind:value={email} required />
		</div>
		<div class="sm:col-span-2">
			<label class="label" for="password">Password</label>
			<input
				id="password"
				class="input min-h-12"
				type="password"
				autocomplete="new-password"
				bind:value={password}
				minlength="8"
				required
			/>
			<p class="mt-1.5 text-xs text-muted">Use at least 8 characters.</p>
		</div>
		<div class="sm:col-span-2"><ErrorText {error} /></div>
		<button class="btn min-h-12 w-full sm:col-span-2" type="submit" disabled={pending}>
			{pending ? 'Creating…' : 'Create workspace'}
		</button>
	</form>

	<p class="mt-7 text-center text-sm text-muted">
		Already have an account?
		<a class="font-semibold text-ink underline decoration-line underline-offset-4 hover:text-accent" href={resolve('/signin')}>Sign in</a>
	</p>
</div>
