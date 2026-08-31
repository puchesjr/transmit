<script lang="ts">
	let { error }: { error: unknown } = $props();

	let message = $derived(error instanceof Error ? error.message : error ? 'Something went wrong' : '');
</script>

{#if message}
	<p class="text-sm text-red-600">{message}</p>
{/if}
