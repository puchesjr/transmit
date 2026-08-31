<script lang="ts">
	import { browser } from '$app/environment';
	import { QueryClient, QueryClientProvider } from '@tanstack/svelte-query';
	import type { Snippet } from 'svelte';

	let { children }: { children: Snippet } = $props();

	function makeClient() {
		return new QueryClient({
			defaultOptions: {
				queries: {
					staleTime: 0,
					refetchOnMount: 'always',
					retry: 1
				}
			}
		});
	}

	let browserClient: QueryClient | undefined;

	function getClient() {
		if (!browser) return makeClient();
		browserClient ??= makeClient();
		return browserClient;
	}

	const client = getClient();
</script>

<QueryClientProvider {client}>
	{@render children()}
</QueryClientProvider>
