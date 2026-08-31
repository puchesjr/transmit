<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { api } from '$lib/client/api';

	let { data, children } = $props();
	let signingOut = $state(false);

	function navClass(path: string) {
		const active = page.url.pathname === path || page.url.pathname.startsWith(`${path}/`);
		return active
			? 'block rounded px-3 py-1.5 text-sm bg-white/10 text-cream'
			: 'block rounded px-3 py-1.5 text-sm text-cream/70 hover:bg-white/5 hover:text-cream';
	}

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

<div class="min-h-screen bg-canvas text-ink md:flex">
	<aside class="flex flex-col bg-sidebar text-cream md:w-56 md:min-h-screen">
		<div class="px-5 py-5">
			<p class="text-[11px] font-semibold tracking-[0.28em] uppercase text-cream/60">Transmit</p>
			<p class="mt-2 text-sm font-medium leading-snug">{data.account.name}</p>
			<p class="text-xs text-cream/50">{data.location.name}</p>
		</div>
		<nav class="flex gap-1 px-3 pb-3 md:flex-col md:flex-1">
			<a class={navClass('/contacts')} href={resolve('/contacts')}>Contacts</a>
			<a class={navClass('/companies')} href={resolve('/companies')}>Companies</a>
			<a class={navClass('/opportunities')} href={resolve('/opportunities')}>Pipeline</a>
		</nav>
		<div class="mt-auto flex items-center justify-between gap-2 border-t border-white/10 px-4 py-3">
			<p class="truncate text-xs text-cream/70">{data.user.name}</p>
			<button class="btn-ghost text-xs" type="button" onclick={signOut} disabled={signingOut}>
				Sign out
			</button>
		</div>
	</aside>
	<main class="flex-1 p-4 md:p-8">
		{@render children()}
	</main>
</div>
