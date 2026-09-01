<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { createQuery } from '@tanstack/svelte-query';
	import logo from '$lib/assets/logo.svg';
	import { api } from '$lib/client/api';
	import CommandPalette from '$lib/client/CommandPalette.svelte';
	import ThemeToggle from '$lib/client/ThemeToggle.svelte';
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
		pipeline: ['M5 4v13', 'M12 4v8', 'M19 4v16', 'M3 4h4', 'M10 4h4', 'M17 4h4'],
		settings: [
			'M4 21v-7',
			'M4 10V3',
			'M12 21v-9',
			'M12 8V3',
			'M20 21v-5',
			'M20 12V3',
			'M1 14h6',
			'M9 8h6',
			'M17 16h6'
		]
	};

	const NAV = [
		{ path: '/inbox', label: 'Inbox', icon: 'inbox' },
		{ path: '/opportunities', label: 'Leads', icon: 'pipeline' },
		{ path: '/contacts', label: 'Customers', icon: 'contacts' },
		{ path: '/settings/messaging', label: 'Settings', icon: 'settings' }
	] as const;

	function isActive(path: string): boolean {
		if (path === '/settings/messaging' && page.url.pathname.startsWith('/settings/')) return true;
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

<a class="skip-link" href="#main-content">Skip to main content</a>
<div class="flex h-dvh flex-col overflow-hidden bg-canvas text-ink md:grid md:grid-cols-[264px_minmax(0,1fr)]">
	<aside class="hidden min-h-0 flex-col border-r border-line bg-paper text-ink transition-colors md:flex dark:border-white/8 dark:bg-sidebar dark:text-white">
		<div class="px-5 pt-6 pb-5">
			<div class="flex items-center gap-3">
				<img src={logo} alt="" class="size-9 rounded-xl shadow-[0_8px_22px_rgba(249,115,22,0.28)]" />
				<div>
					<p class="text-[17px] leading-none font-bold tracking-[-0.03em]">Transmit</p>
					<p class="mt-1 text-[10px] font-semibold tracking-[0.12em] text-muted uppercase dark:text-white/65">Workspace</p>
				</div>
			</div>

			<div class="mt-5 rounded-2xl border border-line bg-canvas p-3.5 dark:border-white/8 dark:bg-white/[0.045]">
				<p class="truncate text-sm font-semibold text-ink dark:text-white/90">{data.account.name}</p>
				<p class="mt-0.5 flex items-center gap-1.5 truncate text-xs text-muted dark:text-white/65">
					<span class="size-1.5 rounded-full bg-emerald-400"></span>
					{data.location.name}
				</p>
			</div>
		</div>

		<div class="px-3 pb-4">
			<button
				class="flex w-full items-center gap-2.5 rounded-xl border border-line bg-canvas px-3 py-2.5 text-sm text-muted transition hover:border-accent/30 hover:bg-paper hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent dark:border-white/8 dark:bg-white/[0.045] dark:text-white/65 dark:hover:border-white/15 dark:hover:bg-white/[0.075] dark:hover:text-white/85"
				onclick={() => (paletteOpen = true)}
			>
				<svg class="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
					<circle cx="11" cy="11" r="7" />
					<path d="M21 21l-4.3-4.3" />
				</svg>
				<span class="flex-1 text-left">Quick search</span>
				<span class="kbd text-muted dark:text-white/70">⌘K</span>
			</button>
		</div>

		<nav class="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-3">
			<p class="px-3 pb-2 text-[10px] font-bold tracking-[0.14em] text-muted uppercase dark:text-white/65">Navigate</p>
			{#each NAV as item (item.path)}
				<a
					class={`group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition ${
						isActive(item.path)
							? 'bg-accent/10 text-accent-strong shadow-[0_1px_2px_rgba(15,23,42,0.06)] dark:bg-paper dark:text-ink dark:shadow-[0_6px_20px_rgba(0,0,0,0.2)]'
							: 'text-muted hover:bg-canvas hover:text-ink dark:text-white/65 dark:hover:bg-white/[0.06] dark:hover:text-white/90'
					}`}
					href={resolve(item.path)}
				>
					<span class={`flex size-8 items-center justify-center rounded-lg ${isActive(item.path) ? 'bg-accent/10 text-accent' : 'bg-ink/[0.04] dark:bg-white/[0.04]'}`}>
						<svg
							class="size-[17px] shrink-0"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="1.8"
							stroke-linecap="round"
							stroke-linejoin="round"
						>
							{#each ICONS[item.icon] as d (d)}
								<path {d} />
							{/each}
						</svg>
					</span>
					<span>{item.label}</span>
					{#if item.path === '/inbox' && unreadTotal > 0}
						<span class="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-action px-1.5 text-[10px] font-bold text-white">
							{unreadTotal}
						</span>
					{/if}
				</a>
			{/each}
		</nav>

		<div class="m-3 mt-5 flex items-center gap-3 rounded-2xl border border-line bg-canvas p-3 dark:border-white/8 dark:bg-white/[0.045]">
			<span class="flex size-9 shrink-0 items-center justify-center rounded-xl bg-action text-sm font-bold text-white shadow-lg shadow-accent/15">
				{data.user.name.trim().charAt(0).toUpperCase() || '?'}
			</span>
			<div class="min-w-0 flex-1">
				<p class="truncate text-sm font-semibold text-ink dark:text-white/85">{data.user.name}</p>
				<p class="text-[11px] text-muted dark:text-white/65">Signed in</p>
			</div>
			<ThemeToggle variant="sidebar" />
			<button
				class="rounded-lg p-2 text-muted transition hover:bg-ink/[0.06] hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent dark:text-white/65 dark:hover:bg-white/8 dark:hover:text-white"
				type="button"
				onclick={signOut}
				disabled={signingOut}
				aria-label="Sign out"
			>
				<svg class="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
					<path d="M10 17l5-5-5-5" />
					<path d="M15 12H3" />
					<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
				</svg>
			</button>
		</div>
	</aside>

	<header class="flex h-16 shrink-0 items-center justify-between border-b border-line/80 bg-paper/85 px-4 backdrop-blur-xl md:hidden">
		<div class="flex min-w-0 items-center gap-2.5">
			<img src={logo} alt="" class="size-8 rounded-lg" />
			<div class="min-w-0">
				<p class="text-[15px] leading-none font-bold tracking-[-0.025em]">Transmit</p>
				<p class="mt-1 truncate text-[11px] text-muted">{data.account.name} · {data.location.name}</p>
			</div>
		</div>
		<div class="flex items-center gap-1">
			<button
				class="flex size-9 shrink-0 items-center justify-center rounded-xl text-ink transition-colors hover:bg-ink/[0.06] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
				type="button"
				onclick={() => (paletteOpen = true)}
				aria-label="Search"
				title="Search"
			>
				<svg class="size-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
					<circle cx="11" cy="11" r="7" />
					<path d="M21 21l-4.3-4.3" />
				</svg>
			</button>
			<ThemeToggle />
			<button
				class="flex size-9 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-xs font-bold text-accent transition-colors hover:bg-accent/15 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:pointer-events-none disabled:opacity-50"
				type="button"
				onclick={signOut}
				disabled={signingOut}
				aria-label="Sign out"
				title="Sign out"
			>
				{data.user.name.trim().charAt(0).toUpperCase() || '?'}
			</button>
		</div>
	</header>

	<main
		id="main-content"
		tabindex="-1"
		class={`min-h-0 min-w-0 flex-1 overflow-y-auto ${
			page.url.pathname.startsWith('/inbox')
				? 'pb-[calc(78px+env(safe-area-inset-bottom))] md:pb-0'
				: 'px-4 pt-5 pb-[calc(7rem+env(safe-area-inset-bottom))] sm:px-6 md:px-8 md:py-8 xl:px-10 xl:py-9'
		}`}
	>
		{@render children()}
	</main>

	<nav class="fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-40 grid grid-cols-4 rounded-2xl border border-line bg-paper/95 p-1.5 text-ink shadow-[0_18px_50px_rgba(15,23,42,0.16)] backdrop-blur-xl transition-colors md:hidden dark:border-white/10 dark:bg-sidebar/95 dark:text-white dark:shadow-[0_18px_50px_rgba(0,0,0,0.4)]">
		{#each NAV as item (item.path)}
			<a
				class={`relative flex min-h-12 min-w-0 flex-col items-center justify-center gap-0.5 rounded-xl px-1 py-1.5 text-[10px] font-semibold transition ${
					isActive(item.path)
						? 'bg-accent/10 text-accent-strong shadow-sm dark:bg-paper dark:text-ink dark:shadow-md'
						: 'text-muted hover:bg-ink/[0.05] hover:text-ink dark:text-white/65 dark:hover:bg-white/[0.06] dark:hover:text-white/85'
				}`}
				href={resolve(item.path)}
			>
				<svg class={`size-[18px] ${isActive(item.path) ? 'text-accent' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
					{#each ICONS[item.icon] as d (d)}
						<path {d} />
					{/each}
				</svg>
				<span class="max-w-full truncate">{item.label}</span>
				{#if item.path === '/inbox' && unreadTotal > 0}
					<span class="absolute top-1 right-1 flex size-4 items-center justify-center rounded-full bg-action text-[8px] font-bold text-white">{unreadTotal}</span>
				{/if}
			</a>
		{/each}
	</nav>
</div>

<CommandPalette bind:open={paletteOpen} />
