<script lang="ts">
	import { onMount } from 'svelte';

	const { variant = 'surface' }: { variant?: 'surface' | 'sidebar' } = $props();
	let dark = $state(false);

	onMount(() => {
		function syncTheme() {
			dark = document.documentElement.classList.contains('dark');
		}

		syncTheme();
		window.addEventListener('kisocrm-theme-change', syncTheme);
		return () => window.removeEventListener('kisocrm-theme-change', syncTheme);
	});

	function toggleTheme() {
		dark = !dark;
		document.documentElement.classList.toggle('dark', dark);
		document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
		localStorage.setItem('kisocrm-theme', dark ? 'dark' : 'light');
		window.dispatchEvent(new Event('kisocrm-theme-change'));
	}
</script>

<button
	type="button"
	class={`flex size-9 shrink-0 items-center justify-center rounded-xl border transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
		variant === 'sidebar'
			? 'border-line bg-paper text-muted shadow-[0_1px_2px_rgba(15,23,42,0.04)] hover:border-ink/15 hover:bg-canvas hover:text-ink dark:border-white/8 dark:bg-white/[0.045] dark:text-white/65 dark:shadow-none dark:hover:border-white/15 dark:hover:bg-white/[0.08] dark:hover:text-white'
			: 'border-line bg-paper text-muted shadow-[0_1px_2px_rgba(15,23,42,0.04)] hover:border-ink/15 hover:bg-canvas hover:text-ink'
	}`}
	onclick={toggleTheme}
	aria-label={dark ? 'Use light mode' : 'Use dark mode'}
	title={dark ? 'Use light mode' : 'Use dark mode'}
>
	{#if dark}
		<svg class="size-[17px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
			<circle cx="12" cy="12" r="4" />
			<path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.42-1.41M17.66 6.34l1.41-1.41" />
		</svg>
	{:else}
		<svg class="size-[17px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
			<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
		</svg>
	{/if}
</button>
