<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import logo from '$lib/assets/logo.svg';
	import { api } from '$lib/client/api';
	import ThemeToggle from '$lib/client/ThemeToggle.svelte';

	let { data, children } = $props();
	let signingOut = $state(false);

	async function signOut() {
		signingOut = true;
		try {
			await api.post('/api/v1/auth/signout');
			await goto(resolve('/signin'));
		} finally {
			signingOut = false;
		}
	}
</script>

<a class="skip-link" href="#main-content">Skip to main content</a>
<div class="flex min-h-dvh flex-col bg-canvas text-ink">
	<header class="flex h-16 shrink-0 items-center justify-between border-b border-line/80 bg-paper/90 px-4 backdrop-blur-xl sm:px-6">
		<div class="flex min-w-0 items-center gap-3">
			<img src={logo} alt="" class="size-8 rounded-lg sm:size-9 sm:rounded-xl" />
			<div class="min-w-0">
				<p class="text-[15px] leading-none font-bold tracking-[-0.03em]">Kiso CRM</p>
				<p class="mt-1 truncate text-[11px] text-muted">{data.account.name}</p>
			</div>
		</div>
		<div class="flex items-center gap-1 sm:gap-2">
			<ThemeToggle />
			<button
				class="rounded-lg px-2.5 py-2 text-sm font-semibold text-muted transition hover:bg-ink/[0.06] hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-50"
				type="button"
				onclick={signOut}
				disabled={signingOut}
			>
				{signingOut ? 'Signing out…' : 'Sign out'}
			</button>
		</div>
	</header>
	<main id="main-content" class="skip-target mx-auto flex w-full max-w-2xl flex-1 flex-col px-4 py-6 sm:px-6 sm:py-10" tabindex="-1">
		{@render children()}
	</main>
</div>
