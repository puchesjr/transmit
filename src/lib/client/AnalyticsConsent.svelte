<script lang="ts">
	import { resolve } from '$app/paths';
	import { onMount } from 'svelte';

	let {
		scriptUrl = null,
		siteId = null
	}: { scriptUrl?: string | null; siteId?: string | null } = $props();

	let choice = $state<'unknown' | 'accepted' | 'declined'>('accepted');

	function loadAnalytics() {
		if (!scriptUrl || !siteId || document.querySelector('script[data-kisocrm-analytics]')) return;
		const script = document.createElement('script');
		script.async = true;
		script.src = scriptUrl;
		script.dataset.site = siteId;
		script.dataset.kisocrmAnalytics = 'true';
		document.head.appendChild(script);
	}

	function save(next: 'accepted' | 'declined') {
		choice = next;
		localStorage.setItem('kisocrm-analytics-consent', next);
		if (next === 'accepted') loadAnalytics();
	}

	onMount(() => {
		const saved = localStorage.getItem('kisocrm-analytics-consent');
		choice = saved === 'accepted' || saved === 'declined' ? saved : 'unknown';
		if (choice === 'accepted') loadAnalytics();
	});
</script>

{#if choice === 'unknown'}
	<aside class="fixed inset-x-3 bottom-3 z-50 mx-auto max-w-2xl rounded-2xl border border-line bg-paper/95 p-4 shadow-[0_24px_70px_rgba(15,23,42,0.22)] backdrop-blur-xl sm:bottom-5 sm:flex sm:items-center sm:gap-5 sm:p-5" aria-label="Analytics preferences">
		<div class="flex-1">
			<p class="text-sm font-semibold">Help us improve Kiso CRM</p>
			<p class="mt-1 text-xs leading-5 text-muted">
				We use optional, privacy-conscious analytics only after you allow it. Essential preferences still work if you decline. <a class="font-semibold text-ink underline underline-offset-2" href={resolve('/privacy')}>Learn more</a>
			</p>
		</div>
		<div class="mt-4 flex gap-2 sm:mt-0 sm:shrink-0">
			<button class="btn-secondary min-h-9 flex-1 px-3 py-2 text-xs sm:flex-none" type="button" onclick={() => save('declined')}>Decline</button>
			<button class="btn min-h-9 flex-1 px-3 py-2 text-xs sm:flex-none" type="button" onclick={() => save('accepted')}>Allow analytics</button>
		</div>
	</aside>
{/if}
