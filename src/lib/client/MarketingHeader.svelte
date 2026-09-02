<script lang="ts">
	import { resolve } from '$app/paths';
	import logo from '$lib/assets/logo.svg';
	import ThemeToggle from './ThemeToggle.svelte';

	let { signedIn = false, compact = false }: { signedIn?: boolean; compact?: boolean } = $props();
</script>

<header class={`relative z-40 w-full ${compact ? 'border-b border-line bg-paper/90' : ''}`}>
	<a class="skip-link" href="#main-content">Skip to main content</a>
	<div class="mx-auto flex h-18 w-full max-w-7xl items-center justify-between px-4 sm:h-20 sm:px-8">
		<a class="flex items-center gap-2.5 sm:gap-3" href={resolve('/')} aria-label="Kiso CRM home">
			<img src={logo} alt="" class="size-9 rounded-xl shadow-[0_8px_22px_rgba(178,58,31,0.22)]" />
			<span class="hidden text-lg font-bold tracking-[-0.035em] min-[350px]:inline">Kiso CRM</span>
		</a>

		{#if !compact}
			<nav class="hidden items-center gap-7 text-sm font-semibold text-ink lg:flex" aria-label="Marketing navigation">
				<a class="transition hover:text-ink" href="#product">Product</a>
				<a class="transition hover:text-ink" href="#workflow">How it works</a>
				<a class="transition hover:text-ink" href="#pricing">Pricing</a>
				<a class="transition hover:text-ink" href="#faq">FAQ</a>
			</nav>
		{/if}

		<div class="flex items-center gap-2">
			<ThemeToggle />
			<span class="hidden sm:inline">
				<a class="btn-ghost" href={resolve(signedIn ? '/inbox' : '/signin')}>
					{signedIn ? 'Open inbox' : 'Sign in'}
				</a>
			</span>
			<a class="btn min-h-10 px-3 text-xs sm:px-4 sm:text-sm" href={resolve(signedIn ? '/inbox' : '/signup')}>
				<span class="sm:hidden">{signedIn ? 'Open' : 'Start trial'}</span>
				<span class="hidden sm:inline">{signedIn ? 'Go to workspace' : 'Start free trial'}</span>
			</a>
		</div>
	</div>
</header>
