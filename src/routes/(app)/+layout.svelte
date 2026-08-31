<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { createQuery } from '@tanstack/svelte-query';
	import logo from '$lib/assets/logo.svg';
	import { api } from '$lib/client/api';
	import CommandPalette from '$lib/client/CommandPalette.svelte';
	import type { Conversation } from '$lib/types';

	let { data, children } = $props();
	let signingOut = $state(false);
	let paletteOpen = $state(false);

	const conversationsQuery = createQuery(() => ({
		queryKey: ['conversations'],
		queryFn: () => api.get<{ conversations: Conversation[] }>('/api/v1/conversations'),
		refetchInterval: 15_000
	}));
	let unreadTotal = $derived(
		(conversationsQuery.data?.conversations ?? []).reduce((sum, item) => sum + item.unread, 0)
	);

	const ICONS: Record<string, string[]> = {
		inbox: [
			'M22 12h-6l-2 3h-4l-2-3H2',
			'M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z'
		],
		contacts: ['M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2', 'M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z'],
		companies: ['M3 21h18', 'M5 21V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16', 'M9 8h1', 'M14 8h1', 'M9 12h1', 'M14 12h1', 'M9 16h1', 'M14 16h1'],
		pipeline: ['M5 4v13', 'M12 4v8', 'M19 4v16', 'M3 4h4', 'M10 4h4', 'M17 4h4'],
		messaging: ['M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z']
	};

	const NAV = [
		{ path: '/inbox', label: 'Inbox', icon: 'inbox' },
		{ path: '/contacts', label: 'Contacts', icon: 'contacts' },
		{ path: '/companies', label: 'Companies', icon: 'companies' },
		{ path: '/opportunities', label: 'Pipeline', icon: 'pipeline' },
		{ path: '/settings/messaging', label: 'Messaging', icon: 'messaging' }
	] as const;

	function isActive(path: string): boolean {
		return page.url.pathname === path || page.url.pathname.startsWith(`${path}/`);
	}

	function onGlobalKeydown(event: KeyboardEvent) {
		if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
			event.preventDefault();
			paletteOpen = !paletteOpen;
		}
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

<svelte:window onkeydown={onGlobalKeydown} />

<div class="flex h-dvh flex-col bg-canvas text-ink md:flex-row">
	<aside class="flex shrink-0 flex-col border-r border-line bg-sidebar md:w-60">
		<div class="flex items-center gap-2.5 px-5 pt-5 pb-4">
			<img src={logo} alt="" class="size-8 rounded-lg" />
			<div class="min-w-0">
				<p class="text-[15px] leading-tight font-semibold tracking-tight">Transmit</p>
				<p class="truncate text-xs text-muted">{data.account.name} · {data.location.name}</p>
			</div>
		</div>

		<div class="px-3 pb-2">
			<button
				class="flex w-full items-center gap-2.5 rounded-lg border border-line bg-canvas px-3 py-2 text-sm text-muted transition-colors hover:border-accent/40 hover:text-ink"
				onclick={() => (paletteOpen = true)}
			>
				<svg class="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
					<circle cx="11" cy="11" r="7" />
					<path d="M21 21l-4.3-4.3" />
				</svg>
				<span class="flex-1 text-left">Search</span>
				<span class="kbd">⌘K</span>
			</button>
		</div>

		<nav class="flex flex-wrap gap-1 px-3 pb-3 md:flex-1 md:flex-col md:flex-nowrap">
			{#each NAV as item (item.path)}
				<a
					class={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
						isActive(item.path)
							? 'bg-accent/10 text-accent'
							: 'text-muted hover:bg-ink/5 hover:text-ink'
					}`}
					href={resolve(item.path)}
				>
					<svg
						class="size-[18px] shrink-0"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="1.75"
						stroke-linecap="round"
						stroke-linejoin="round"
					>
						{#each ICONS[item.icon] as d (d)}
							<path {d} />
						{/each}
					</svg>
					<span>{item.label}</span>
					{#if item.path === '/inbox' && unreadTotal > 0}
						<span
							class="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1.5 text-[11px] font-semibold text-white"
						>
							{unreadTotal}
						</span>
					{/if}
				</a>
			{/each}
		</nav>

		<div class="mt-auto flex items-center justify-between gap-2 border-t border-line px-4 py-3">
			<div class="flex min-w-0 items-center gap-2">
				<span
					class="flex size-7 shrink-0 items-center justify-center rounded-full bg-accent/10 text-xs font-semibold text-accent"
				>
					{data.user.name.trim().charAt(0).toUpperCase() || '?'}
				</span>
				<p class="truncate text-xs text-muted">{data.user.name}</p>
			</div>
			<button class="btn-ghost text-xs" type="button" onclick={signOut} disabled={signingOut}>
				Sign out
			</button>
		</div>
	</aside>

	<main
		class={`min-w-0 flex-1 overflow-y-auto ${
			page.url.pathname.startsWith('/inbox') ? '' : 'p-4 md:p-8'
		}`}
	>
		{@render children()}
	</main>
</div>

<CommandPalette bind:open={paletteOpen} />
