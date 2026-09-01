<script lang="ts">
	let { error }: { error: unknown } = $props();

	let message = $derived(error instanceof Error ? error.message : error ? 'Something went wrong' : '');
</script>

{#if message}
	<p class="rounded-xl border border-red-100 bg-red-50 px-3.5 py-2.5 text-sm font-medium text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">{message}</p>
{/if}
