<script lang="ts">
	import './layout.css';
	import favicon from '$lib/assets/favicon.svg';
	import QueryProvider from '$lib/client/QueryProvider.svelte';

	let { children } = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<title>Transmit</title>
</svelte:head>

<QueryProvider>
	{@render children()}
</QueryProvider>
