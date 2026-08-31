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
			? 'flex items-center rounded-lg px-3 py-2 text-sm font-medium bg-white/10 text-white'
			: 'flex items-center rounded-lg px-3 py-2 text-sm font-medium text-white/60 transition-colors hover:bg-white/5 hover:text-white';
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
	<aside class="flex flex-col bg-sidebar text-white md:w-60 md:min-h-screen">
		<div class="flex items-center gap-2.5 px-5 pt-5 pb-4">
			<span
				class="flex size-8 items-center justify-center rounded-lg bg-accent text-sm font-bold text-white"
			>
				T
			</span>
			<span class="text-[15px] font-semibold tracking-tight">Transmit</span>
		</div>
		<div class="mx-3 mb-3 rounded-lg border border-white/10 bg-white/5 px-3 py-2.5">
			<p class="truncate text-sm font-medium leading-snug">{data.account.name}</p>
			<p class="truncate text-xs text-white/50">{data.location.name}</p>
		</div>
		<nav class="flex gap-1 px-3 pb-3 md:flex-col md:flex-1">
			<a class={navClass('/contacts')} href={resolve('/contacts')}>Contacts</a>
			<a class={navClass('/companies')} href={resolve('/companies')}>Companies</a>
			<a class={navClass('/opportunities')} href={resolve('/opportunities')}>Pipeline</a>
		</nav>
		<div class="mt-auto flex items-center justify-between gap-2 border-t border-white/10 px-4 py-3">
			<div class="flex min-w-0 items-center gap-2">
				<span
					class="flex size-7 shrink-0 items-center justify-center rounded-full bg-white/10 text-xs font-semibold text-white/80"
				>
					{data.user.name.trim().charAt(0).toUpperCase() || '?'}
				</span>
				<p class="truncate text-xs text-white/70">{data.user.name}</p>
			</div>
			<button class="btn-ghost text-xs" type="button" onclick={signOut} disabled={signingOut}>
				Sign out
			</button>
		</div>
	</aside>
	<main class="min-w-0 flex-1 p-4 md:p-8">
		{@render children()}
	</main>
</div>
