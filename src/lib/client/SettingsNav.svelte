<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';

	const tabs = [
		{ href: '/settings/messaging', label: 'Communications', mobileLabel: 'Messaging' },
		{ href: '/settings/ai', label: 'AI assistance', mobileLabel: 'AI' },
		{ href: '/settings/billing', label: 'Billing & usage', mobileLabel: 'Billing' },
		{ href: '/settings/capture', label: 'Lead capture', mobileLabel: 'Capture' }
	] as const;
</script>

<nav class="mb-5 grid w-full grid-cols-4 gap-1 rounded-xl border border-line bg-paper p-1 shadow-sm sm:mb-6 sm:flex sm:w-fit" aria-label="Settings sections">
	{#each tabs as tab (tab.href)}
		<a
			href={resolve(tab.href)}
			class={`flex min-h-10 items-center justify-center rounded-lg px-1 py-2 text-center text-[11px] leading-5 font-semibold transition sm:px-3.5 sm:text-sm ${
				page.url.pathname === tab.href
					? 'bg-sidebar text-white shadow-sm'
					: 'text-muted hover:bg-canvas hover:text-ink'
			}`}
		>
			<span class="sm:hidden">{tab.mobileLabel}</span><span class="hidden sm:inline">{tab.label}</span>
		</a>
	{/each}
</nav>
