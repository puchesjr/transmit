<script lang="ts">
	import { resolve } from '$app/paths';
	import { createQuery, useQueryClient } from '@tanstack/svelte-query';
	import { api } from '$lib/client/api';
	import ErrorText from '$lib/client/ErrorText.svelte';
	import { contactName, formatWhen } from '$lib/format';
	import type { Contact, Conversation, Message } from '$lib/types';

	const queryClient = useQueryClient();
	let selectedId = $state<string | null>(null);

	const conversationsQuery = createQuery(() => ({
		queryKey: ['conversations'],
		queryFn: () => api.get<{ conversations: Conversation[] }>('/api/v1/conversations'),
		refetchInterval: 10_000
	}));

	const threadQuery = createQuery(() => ({
		queryKey: ['thread', selectedId],
		queryFn: () =>
			api.get<{ contact: Contact; messages: Message[] }>(`/api/v1/contacts/${selectedId}/messages`),
		enabled: Boolean(selectedId),
		refetchInterval: 5000
	}));

	let conversations = $derived(conversationsQuery.data?.conversations ?? []);
	let selected = $derived(conversations.find((item) => item.contactId === selectedId) ?? null);
	let totalUnread = $derived(conversations.reduce((sum, item) => sum + item.unread, 0));

	let smsBody = $state('');
	let smsError = $state<unknown>(null);
	let sending = $state(false);
	let scroller = $state<HTMLDivElement | null>(null);

	$effect(() => {
		void threadQuery.data?.messages.length;
		if (scroller) scroller.scrollTop = scroller.scrollHeight;
	});

	function select(contactId: string) {
		selectedId = contactId;
		smsError = null;
		void api
			.post(`/api/v1/contacts/${contactId}/messages/read`)
			.then(() => queryClient.invalidateQueries({ queryKey: ['conversations'] }))
			.catch(() => {});
	}

	async function send(event: SubmitEvent) {
		event.preventDefault();
		if (!selectedId) return;
		smsError = null;
		sending = true;
		try {
			await api.post(`/api/v1/contacts/${selectedId}/messages`, { body: smsBody });
			smsBody = '';
			await Promise.all([
				queryClient.invalidateQueries({ queryKey: ['thread', selectedId] }),
				queryClient.invalidateQueries({ queryKey: ['conversations'] })
			]);
		} catch (err) {
			smsError = err;
		} finally {
			sending = false;
		}
	}
</script>

<div class="grid h-full min-h-0 bg-paper md:grid-cols-[320px_1fr]">
	<!-- Conversation list -->
	<div
		class={`min-h-0 flex-col border-line md:flex md:border-r ${selectedId ? 'hidden' : 'flex'}`}
	>
		<header class="flex items-center justify-between border-b border-line px-4 py-3">
			<h1 class="text-base font-semibold tracking-tight">Inbox</h1>
			{#if totalUnread > 0}
				<span
					class="flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1.5 text-[11px] font-semibold text-white"
				>
					{totalUnread}
				</span>
			{/if}
		</header>
		<div class="min-h-0 flex-1 overflow-y-auto">
			{#if conversationsQuery.isPending}
				<p class="p-4 text-sm text-muted">Loading conversations…</p>
			{:else if conversationsQuery.isError}
				<div class="p-4"><ErrorText error={conversationsQuery.error} /></div>
			{:else if conversations.length === 0}
				<div class="space-y-2 p-6 text-sm text-muted">
					<p>No conversations yet.</p>
					<p>
						Text a contact from their page, or
						<a class="text-accent hover:underline" href={resolve('/settings/messaging')}>
							set up messaging
						</a>
						if you haven't yet.
					</p>
				</div>
			{:else}
				<ul class="divide-y divide-line">
					{#each conversations as conversation (conversation.contactId)}
						<li>
							<button
								class={`flex w-full items-start gap-3 px-4 py-3 text-left transition-colors ${
									conversation.contactId === selectedId ? 'bg-accent/5' : 'hover:bg-canvas'
								}`}
								onclick={() => select(conversation.contactId)}
							>
								<span
									class="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full bg-accent/10 text-sm font-semibold text-accent"
								>
									{(contactName(conversation).charAt(0) || '#').toUpperCase()}
								</span>
								<span class="min-w-0 flex-1">
									<span class="flex items-baseline justify-between gap-2">
										<span class="truncate text-sm font-medium">{contactName(conversation)}</span>
										<span class="shrink-0 text-[11px] text-muted">
											{formatWhen(conversation.lastAt)}
										</span>
									</span>
									<span class="mt-0.5 flex items-center justify-between gap-2">
										<span class="truncate text-sm text-muted">
											{conversation.lastDirection === 'outbound' ? 'You: ' : ''}{conversation.lastBody}
										</span>
										{#if conversation.unread > 0}
											<span
												class="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-accent px-1.5 text-[11px] font-semibold text-white"
											>
												{conversation.unread}
											</span>
										{/if}
									</span>
								</span>
							</button>
						</li>
					{/each}
				</ul>
			{/if}
		</div>
	</div>

	<!-- Thread -->
	<div class={`min-h-0 flex-col md:flex ${selectedId ? 'flex' : 'hidden'}`}>
			{#if !selectedId}
				<div class="flex flex-1 items-center justify-center p-8 text-center">
					<div class="max-w-xs space-y-2">
						<p class="text-sm font-medium">Pick a conversation</p>
						<p class="text-sm text-muted">
							Select a thread on the left to read and reply without leaving the inbox.
						</p>
					</div>
				</div>
			{:else}
				<header class="flex items-center gap-3 border-b border-line px-4 py-3">
					<button
						class="btn-ghost -ml-1 px-2 md:hidden"
						onclick={() => (selectedId = null)}
						aria-label="Back to conversations"
					>
						←
					</button>
					<div class="min-w-0 flex-1">
						<p class="truncate text-sm font-semibold">
							{selected ? contactName(selected) : threadQuery.data ? contactName(threadQuery.data.contact) : ''}
						</p>
						<p class="truncate text-xs text-muted">
							{selected?.phone ?? threadQuery.data?.contact.phone ?? ''}
						</p>
					</div>
					<a class="btn-secondary shrink-0 text-xs" href={resolve(`/contacts/${selectedId}`)}>
						View contact
					</a>
				</header>

				<div bind:this={scroller} class="min-h-0 flex-1 overflow-y-auto p-4">
					{#if threadQuery.isPending}
						<p class="text-sm text-muted">Loading messages…</p>
					{:else if threadQuery.isError}
						<ErrorText error={threadQuery.error} />
					{:else}
						<ol class="flex flex-col gap-2">
							{#each threadQuery.data?.messages ?? [] as message (message.id)}
								<li
									class={message.direction === 'outbound'
										? 'max-w-[80%] self-end rounded-2xl rounded-br-sm bg-accent px-3.5 py-2 text-sm text-white'
										: 'max-w-[80%] self-start rounded-2xl rounded-bl-sm bg-canvas px-3.5 py-2 text-sm'}
								>
									<p class="break-words whitespace-pre-wrap">{message.body}</p>
									<p
										class={message.direction === 'outbound'
											? 'mt-0.5 text-right text-[10px] text-white/70'
											: 'mt-0.5 text-[10px] text-muted'}
									>
										{formatWhen(message.createdAt)}
										{#if message.direction === 'outbound'}· {message.status}{/if}
									</p>
								</li>
							{/each}
						</ol>
					{/if}
				</div>

				{#if threadQuery.data?.contact.messagingConsent === 'opted_out'}
					<p class="border-t border-line bg-red-50 px-4 py-3 text-sm text-red-700">
						This contact opted out of SMS. Sending is disabled.
					</p>
				{:else}
					<form class="flex gap-2 border-t border-line p-3" onsubmit={send}>
						<input
							class="input"
							placeholder="Reply…"
							bind:value={smsBody}
							disabled={!threadQuery.data?.contact.phone}
						/>
						<button
							class="btn shrink-0"
							type="submit"
							disabled={sending || !smsBody.trim() || !threadQuery.data?.contact.phone}
						>
							Send
						</button>
					</form>
					{#if smsError}
						<div class="px-4 pb-3"><ErrorText error={smsError} /></div>
					{/if}
				{/if}
			{/if}
	</div>
</div>
