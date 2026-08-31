<script lang="ts">
	import { resolve } from '$app/paths';
	import { createQuery } from '@tanstack/svelte-query';
	import { api } from '$lib/client/api';
	import ErrorText from '$lib/client/ErrorText.svelte';
	import { contactName, formatWhen } from '$lib/format';
	import type { Conversation } from '$lib/types';

	const conversationsQuery = createQuery(() => ({
		queryKey: ['conversations'],
		queryFn: () => api.get<{ conversations: Conversation[] }>('/api/v1/conversations'),
		refetchInterval: 10_000
	}));
</script>

<div class="mx-auto max-w-3xl space-y-6">
	<div>
		<h1 class="text-2xl font-semibold tracking-tight">Inbox</h1>
		<p class="text-sm text-muted">Every SMS conversation, newest first.</p>
	</div>

	{#if conversationsQuery.isPending}
		<p class="text-sm text-muted">Loading conversations…</p>
	{:else if conversationsQuery.isError}
		<ErrorText error={conversationsQuery.error} />
	{:else if (conversationsQuery.data?.conversations.length ?? 0) === 0}
		<div class="card p-8 text-sm text-muted">
			No conversations yet. Send an SMS from a contact page to start one.
		</div>
	{:else}
		<ul class="card divide-y divide-line">
			{#each conversationsQuery.data?.conversations ?? [] as conversation (conversation.contactId)}
				<li>
					<a
						class="flex items-center gap-3 px-4 py-3 hover:bg-canvas"
						href={resolve(`/contacts/${conversation.contactId}`)}
					>
						<div class="min-w-0 flex-1">
							<div class="flex items-center gap-2">
								<span class="truncate font-medium">
									{contactName(conversation)}
								</span>
								{#if conversation.unread > 0}
									<span
										class="flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1.5 text-[11px] font-semibold text-white"
									>
										{conversation.unread}
									</span>
								{/if}
							</div>
							<p class="truncate text-sm text-muted">
								{conversation.lastDirection === 'outbound' ? 'You: ' : ''}{conversation.lastBody}
							</p>
						</div>
						<span class="shrink-0 text-xs text-muted">{formatWhen(conversation.lastAt)}</span>
					</a>
				</li>
			{/each}
		</ul>
	{/if}
</div>
