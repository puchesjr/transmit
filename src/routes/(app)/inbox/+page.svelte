<script lang="ts">
	import { resolve } from '$app/paths';
	import { createQuery, useQueryClient } from '@tanstack/svelte-query';
	import { api } from '$lib/client/api';
	import ErrorText from '$lib/client/ErrorText.svelte';
	import { contactName, formatWhen } from '$lib/format';
	import type {
		AiArtifact,
		AiFollowUpContent,
		AiReplyContent,
		Contact,
		Conversation,
		Message
	} from '$lib/types';

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
			api.get<{ conversation: Conversation; contact: Contact; messages: Message[] }>(
				`/api/v1/conversations/${selectedId}`
			),
		enabled: Boolean(selectedId),
		refetchInterval: 5000
	}));

	const replySuggestionsQuery = createQuery(() => ({
		queryKey: ['ai-replies', selectedId],
		queryFn: () =>
			api.get<{ artifact: AiArtifact | null }>(
				`/api/v1/ai/conversations/${selectedId}/replies`
			),
		enabled: Boolean(selectedId)
	}));

	const followUpsQuery = createQuery(() => ({
		queryKey: ['ai-follow-ups'],
		queryFn: () => api.get<{ artifacts: AiArtifact[] }>('/api/v1/ai/follow-ups'),
		refetchInterval: 30_000
	}));

	let conversations = $derived(conversationsQuery.data?.conversations ?? []);
	let selected = $derived(conversations.find((item) => item.id === selectedId) ?? null);
	let totalUnread = $derived(conversations.reduce((sum, item) => sum + item.unread, 0));
	let replyArtifact = $derived(replySuggestionsQuery.data?.artifact ?? null);
	let replyContent = $derived(
		replyArtifact?.kind === 'reply' ? (replyArtifact.content as AiReplyContent) : null
	);
	let latestThreadMessageId = $derived(threadQuery.data?.messages.at(-1)?.id ?? null);
	let replyIsCurrent = $derived(
		replyArtifact?.status === 'ready' &&
		replyArtifact.sourceLastMessageId === latestThreadMessageId
	);
	let selectedFollowUp = $derived(
		(followUpsQuery.data?.artifacts ?? []).find(
			(artifact) => artifact.conversationId === selectedId && artifact.status === 'ready'
		) ?? null
	);

	let smsBody = $state('');
	let smsError = $state<unknown>(null);
	let sending = $state(false);
	let generatingReplies = $state(false);
	let selectingDraft = $state(false);
	let aiError = $state<unknown>(null);
	let aiPanelOpen = $state(false);
	let scroller = $state<HTMLDivElement | null>(null);

	$effect(() => {
		void threadQuery.data?.messages.length;
		if (scroller) scroller.scrollTop = scroller.scrollHeight;
	});

	function formatConversationWhen(value: string): string {
		const date = new Date(value);
		const now = new Date();
		const sameDay = date.toDateString() === now.toDateString();
		if (sameDay) {
			return new Intl.DateTimeFormat(undefined, {
				hour: 'numeric',
				minute: '2-digit'
			}).format(date);
		}
		return new Intl.DateTimeFormat(undefined, {
			month: 'short',
			day: 'numeric',
			...(date.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' })
		}).format(date);
	}

	function select(conversationId: string) {
		selectedId = conversationId;
		smsError = null;
		aiError = null;
		aiPanelOpen = false;
		void api
			.post(`/api/v1/conversations/${conversationId}/read`)
			.then(() => queryClient.invalidateQueries({ queryKey: ['conversations'] }))
			.catch(() => {});
	}

	function waitingLabel(conversation: Conversation): string | null {
		if (conversation.lastDirection !== 'inbound') return null;
		const minutes = Math.max(0, Math.floor((Date.now() - new Date(conversation.lastAt).getTime()) / 60_000));
		if (minutes < 1) return 'Waiting now';
		if (minutes < 60) return `Waiting ${minutes}m`;
		const hours = Math.floor(minutes / 60);
		if (hours < 24) return `Waiting ${hours}h`;
		return `Waiting ${Math.floor(hours / 24)}d`;
	}

	async function generateReplies() {
		if (!selectedId) return;
		generatingReplies = true;
		aiError = null;
		try {
			await api.post(`/api/v1/ai/conversations/${selectedId}/replies`);
			await Promise.all([
				queryClient.invalidateQueries({ queryKey: ['ai-replies', selectedId] }),
				queryClient.invalidateQueries({ queryKey: ['contact-activities'] })
			]);
		} catch (error) {
			aiError = error;
		} finally {
			generatingReplies = false;
		}
	}

	async function useDraft(artifact: AiArtifact, choiceIndex: number | null) {
		selectingDraft = true;
		aiError = null;
		try {
			const result = await api.post<{ artifact: AiArtifact; body: string }>(
				`/api/v1/ai/artifacts/${artifact.id}/use`,
				{ choiceIndex }
			);
			smsBody = result.body;
			await Promise.all([
				queryClient.invalidateQueries({ queryKey: ['ai-replies', selectedId] }),
				queryClient.invalidateQueries({ queryKey: ['ai-follow-ups'] })
			]);
		} catch (error) {
			aiError = error;
		} finally {
			selectingDraft = false;
		}
	}

	async function send(event: SubmitEvent) {
		event.preventDefault();
		if (!selectedId) return;
		smsError = null;
		sending = true;
		try {
			await api.post(`/api/v1/conversations/${selectedId}`, { body: smsBody });
			smsBody = '';
			await Promise.all([
				queryClient.invalidateQueries({ queryKey: ['thread', selectedId] }),
				queryClient.invalidateQueries({ queryKey: ['conversations'] }),
				queryClient.invalidateQueries({ queryKey: ['ai-replies', selectedId] })
			]);
		} catch (err) {
			smsError = err;
		} finally {
			sending = false;
		}
	}
</script>

<div
	class={`grid h-full min-h-0 overflow-hidden bg-paper md:grid-cols-[340px_minmax(0,1fr)] ${
		selectedId ? 'xl:grid-cols-[340px_minmax(0,1fr)_300px]' : ''
	}`}
>
	<!-- Conversation list -->
	<div
		class={`min-h-0 flex-col border-line bg-paper md:flex md:border-r ${selectedId ? 'hidden' : 'flex'}`}
	>
		<header class="flex min-h-[76px] items-center justify-between border-b border-line/80 px-5 py-4">
			<div>
				<p class="text-[10px] font-bold tracking-[0.12em] text-accent uppercase">Conversations</p>
				<h1 class="mt-0.5 text-xl font-bold tracking-[-0.035em]">Inbox</h1>
			</div>
			{#if totalUnread > 0}
				<span
					class="flex h-6 min-w-6 items-center justify-center rounded-full bg-action px-2 text-[10px] font-bold text-white shadow-sm shadow-accent/20"
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
				<div class="flex min-h-80 flex-col items-center justify-center p-8 text-center">
					<span class="mb-4 flex size-12 items-center justify-center rounded-2xl bg-accent/10 text-accent"><svg class="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg></span>
					<p class="text-sm font-semibold text-ink">No conversations yet</p>
					<p class="mt-1 max-w-xs text-sm leading-6 text-muted">
						Text a customer from their page, or
						<a class="font-semibold text-accent hover:underline" href={resolve('/settings/messaging')}>
							set up messaging
						</a>
						if you haven't yet.
					</p>
				</div>
			{:else}
				<ul class="divide-y divide-line/70 p-2">
					{#each conversations as conversation (conversation.id)}
						<li>
							<button
							class={`flex w-full items-start gap-3 rounded-xl px-3 py-3 text-left text-ink outline-none transition focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset ${
									conversation.id === selectedId ? 'bg-accent/8' : 'hover:bg-canvas'
								}`}
								onclick={() => select(conversation.id)}
							>
								<span
									class="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-sm font-bold text-accent ring-1 ring-accent/10"
								>
									{(contactName(conversation).charAt(0) || '#').toUpperCase()}
								</span>
								<span class="min-w-0 flex-1">
									<span class="flex items-baseline justify-between gap-2">
										<span class="truncate text-sm font-semibold">{contactName(conversation)}</span>
										<span class="shrink-0 text-[11px] text-muted">
											{formatConversationWhen(conversation.lastAt)}
										</span>
									</span>
								<span class="mt-0.5 flex items-center justify-between gap-2">
										<span class={`truncate text-xs leading-5 ${conversation.unread > 0 ? 'font-medium text-ink/70' : 'text-muted'}`}>
											{conversation.lastDirection === 'outbound' ? 'You: ' : ''}{conversation.lastBody}
										</span>
										{#if conversation.unread > 0}
											<span
										class="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-action px-1.5 text-[11px] font-semibold text-white"
											>
												{conversation.unread}
											</span>
										{/if}
									</span>
									{#if waitingLabel(conversation)}
										<span class="mt-1 inline-flex items-center gap-1 text-[10px] font-bold text-action-strong dark:text-accent">
											<span class="size-1.5 rounded-full bg-action-strong dark:bg-accent"></span>
											{waitingLabel(conversation)}
										</span>
									{/if}
								</span>
								<span class="mt-1.5 hidden items-center gap-1.5 text-[10px] font-semibold text-muted">
									<span class={`size-1.5 rounded-full ${conversation.assigneeUserId ? 'bg-emerald-500' : 'bg-amber-500'}`}></span>
									{conversation.assigneeName ?? 'Unassigned'}
								</span>
							</button>
						</li>
					{/each}
				</ul>
			{/if}
		</div>
	</div>

	<!-- Thread -->
	<div class={`min-h-0 flex-col bg-canvas/65 md:flex ${selectedId ? 'flex' : 'hidden'}`}>
			{#if !selectedId}
				<div class="flex flex-1 items-center justify-center p-8 text-center">
					<div class="max-w-xs">
						<span class="mx-auto mb-5 flex size-14 items-center justify-center rounded-2xl border border-line bg-paper text-muted shadow-sm"><svg class="size-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg></span>
						<p class="font-semibold">Pick a conversation</p>
						<p class="mt-1 text-sm leading-6 text-muted">
							Select a thread on the left to read and reply without leaving the inbox.
						</p>
					</div>
				</div>
			{:else}
				<header class="flex min-h-[76px] items-center gap-3 border-b border-line/80 bg-paper/85 px-4 py-3 backdrop-blur-xl sm:px-5">
					<button
					class="-ml-1 inline-flex size-9 items-center justify-center rounded-xl text-muted transition hover:bg-ink/[0.06] hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent md:hidden"
						onclick={() => (selectedId = null)}
						aria-label="Back to conversations"
					>
						←
					</button>
					<span class="hidden sm:block"><span class="avatar">{((selected ? contactName(selected) : threadQuery.data ? contactName(threadQuery.data.contact) : '#').charAt(0) || '#').toUpperCase()}</span></span>
					<div class="min-w-0 flex-1">
						<p class="truncate text-sm font-bold">
							{selected ? contactName(selected) : threadQuery.data ? contactName(threadQuery.data.contact) : ''}
						</p>
						<p class="truncate text-xs text-muted">
							{selected?.phone ?? threadQuery.data?.contact.phone ?? ''}
						</p>
					</div>
					<a class="btn-secondary min-h-9 shrink-0 px-3 py-2 text-xs xl:!hidden" href={resolve(`/contacts/${selected?.contactId ?? threadQuery.data?.contact.id ?? ''}`)}>
						<span class="hidden sm:inline">View customer</span><span class="sm:hidden">Profile</span>
					</a>
				</header>

				<div bind:this={scroller} class="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
					{#if threadQuery.isPending}
						<p class="text-sm text-muted">Loading messages…</p>
					{:else if threadQuery.isError}
						<ErrorText error={threadQuery.error} />
					{:else}
						<ol class="mx-auto flex w-full max-w-3xl flex-col gap-2.5">
							{#each threadQuery.data?.messages ?? [] as message (message.id)}
								<li
									class={message.direction === 'outbound'
										? 'message-out'
										: 'message-in'}
								>
									<p class="break-words whitespace-pre-wrap">{message.body}</p>
									<p
										class={message.direction === 'outbound'
										? 'mt-1 text-right text-[10px] text-white/55'
										: 'mt-1 text-[10px] text-muted'}
									>
										{formatWhen(message.createdAt)}
										{#if message.direction === 'outbound'}· {message.status}{/if}
									</p>
								</li>
							{/each}
						</ol>
					{/if}
					</div>

					{#if threadQuery.data && threadQuery.data.contact.messagingConsent !== 'opted_out'}
						<section class="max-h-[42vh] overflow-y-auto border-t border-line/80 bg-paper px-3 py-2.5 sm:px-4 sm:py-3" aria-label="AI reply assistance">
							<div class="mx-auto max-w-3xl rounded-2xl border border-accent/20 bg-accent/[0.045] p-3.5 dark:bg-accent/[0.07]">
								<div class="flex flex-wrap items-center justify-between gap-3">
									<div class="flex items-center gap-2.5">
										<span class="flex size-8 items-center justify-center rounded-xl bg-accent text-sm font-bold text-white" aria-hidden="true">✦</span>
										<div>
											<h2 class="text-sm font-bold">AI response coach</h2>
											<p class="text-[11px] text-muted">Fast, clear options. You review and send.</p>
										</div>
									</div>
									<span class="sm:hidden">
										<button
											class="btn-secondary min-h-10 px-3 py-2 text-xs"
											type="button"
											onclick={() => (aiPanelOpen = !aiPanelOpen)}
											aria-expanded={aiPanelOpen}
										>
											{aiPanelOpen ? 'Hide coach' : 'Open coach'}
										</button>
									</span>
									<span class="hidden sm:block">
										<button class="btn-secondary min-h-9 px-3 py-2 text-xs" type="button" onclick={generateReplies} disabled={generatingReplies}>
											{generatingReplies ? 'Drafting…' : replyIsCurrent ? 'Refresh choices' : 'Draft replies'}
										</button>
									</span>
								</div>
								<div class={`${aiPanelOpen ? 'block' : 'hidden'} sm:block`}>
									<div class="mt-3 sm:hidden">
										<button class="btn-secondary w-full text-xs" type="button" onclick={generateReplies} disabled={generatingReplies}>
											{generatingReplies ? 'Drafting…' : replyIsCurrent ? 'Refresh choices' : 'Draft replies'}
										</button>
									</div>

								{#if selectedFollowUp}
									{@const followUp = selectedFollowUp.content as AiFollowUpContent}
									<div class="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-amber-950 dark:border-amber-800/70 dark:bg-amber-950/35 dark:text-amber-100">
										<div class="flex flex-wrap items-start justify-between gap-3">
											<div class="min-w-0 flex-1">
												<p class="text-[10px] font-bold tracking-[0.1em] uppercase">Idle-lead follow-up ready</p>
												<p class="mt-1 text-sm leading-5">{followUp.body}</p>
												<p class="mt-1 text-[11px] opacity-75">{followUp.rationale}</p>
											</div>
											<button class="btn-secondary min-h-9 shrink-0 px-3 py-2 text-xs" type="button" onclick={() => useDraft(selectedFollowUp, null)} disabled={selectingDraft}>
												Review in composer
											</button>
										</div>
									</div>
								{/if}

								{#if replyIsCurrent && replyContent && replyArtifact}
									<div class="mt-3 flex flex-wrap items-center gap-2 text-[11px]">
										<span class={`badge ${replyContent.urgency === 'high' ? 'bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-200' : 'bg-ink/[0.06]'}`}>{replyContent.urgency} urgency</span>
										<span class="font-semibold text-ink">{replyContent.intent}</span>
										<span class="text-muted">Next: {replyContent.nextAction}</span>
									</div>
									<div class="mt-3 grid gap-2 md:grid-cols-3">
										{#each replyContent.choices as choice, index (choice.label)}
											<div class="flex flex-col rounded-xl border border-line bg-paper p-3 shadow-sm">
												<p class="text-[10px] font-bold tracking-[0.1em] text-accent uppercase">{choice.label}</p>
												<p class="mt-1.5 flex-1 text-xs leading-5 text-ink">{choice.body}</p>
												<button class="btn-secondary mt-3 min-h-8 px-2.5 py-1.5 text-xs" type="button" onclick={() => useDraft(replyArtifact, index)} disabled={selectingDraft}>
													Use {choice.label.toLowerCase()} draft
												</button>
												<p class="mt-2 text-[10px] leading-4 text-muted">{choice.rationale}</p>
											</div>
										{/each}
									</div>
								{:else if replyArtifact && replyArtifact.status === 'ready' && !replyIsCurrent}
									<p class="mt-3 rounded-xl bg-canvas px-3 py-2 text-xs font-medium text-muted">A new message made the previous suggestions stale. Draft fresh replies before responding.</p>
								{/if}
								{#if aiError}<div class="mt-3"><ErrorText error={aiError} /></div>{/if}
								</div>
							</div>
						</section>
					{/if}

					{#if threadQuery.data?.contact.messagingConsent === 'opted_out'}
					<p class="border-t border-red-100 bg-red-50/90 px-5 py-3 text-sm font-medium text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
						This customer opted out of SMS. Sending is disabled.
					</p>
				{:else}
					<form class="border-t border-line/80 bg-paper p-3 sm:p-4" onsubmit={send}>
						<div class="mx-auto flex max-w-3xl gap-2 rounded-2xl border border-line bg-canvas/70 p-1.5 shadow-inner">
							<input
									class="min-w-0 flex-1 bg-transparent px-3 py-2 text-sm text-ink outline-none placeholder:text-muted"
								placeholder="Reply…"
								bind:value={smsBody}
								disabled={!threadQuery.data?.contact.phone}
							/>
							<button
								class="btn min-h-9 shrink-0 rounded-xl px-4 py-2"
								type="submit"
								disabled={sending || !smsBody.trim() || !threadQuery.data?.contact.phone}
							>
								Send
							</button>
						</div>
					</form>
					{#if smsError}
						<div class="px-4 pb-3"><ErrorText error={smsError} /></div>
					{/if}
				{/if}
			{/if}
		</div>

	{#if selectedId}
		<aside class="hidden min-h-0 flex-col border-l border-line bg-paper xl:flex">
			<header class="flex min-h-[76px] items-center border-b border-line/80 px-5">
				<div>
					<p class="text-[10px] font-bold tracking-[0.12em] text-accent uppercase">Customer context</p>
					<p class="mt-0.5 text-sm font-semibold">Conversation details</p>
				</div>
			</header>
			<div class="min-h-0 flex-1 overflow-y-auto p-5">
				{#if threadQuery.isPending}
					<p class="text-sm text-muted">Loading context…</p>
				{:else if threadQuery.data}
					<div class="flex items-center gap-3">
						<span class="avatar size-11">{(contactName(threadQuery.data.contact).charAt(0) || '#').toUpperCase()}</span>
						<div class="min-w-0">
							<p class="truncate text-sm font-bold">{contactName(threadQuery.data.contact)}</p>
							<p class="truncate text-xs text-muted">{threadQuery.data.contact.phone ?? 'No phone number'}</p>
						</div>
					</div>

					<dl class="mt-6 space-y-4 border-y border-line/80 py-5 text-sm">
						<div class="flex items-center justify-between gap-3">
							<dt class="text-xs text-muted">Status</dt>
							<dd class="badge capitalize">{threadQuery.data.conversation.status}</dd>
						</div>
						<div class="flex items-center justify-between gap-3">
							<dt class="text-xs text-muted">Owner</dt>
							<dd class="truncate text-right text-xs font-semibold">
								{threadQuery.data.conversation.assigneeName ?? 'Unassigned'}
							</dd>
						</div>
						<div class="flex items-center justify-between gap-3">
							<dt class="text-xs text-muted">SMS consent</dt>
							<dd class={`text-xs font-semibold ${threadQuery.data.contact.messagingConsent === 'opted_out' ? 'text-red-600 dark:text-red-300' : 'text-emerald-700 dark:text-emerald-300'}`}>
								{threadQuery.data.contact.messagingConsent === 'opted_out' ? 'Opted out' : 'Enabled'}
							</dd>
						</div>
						<div class="flex items-center justify-between gap-3">
							<dt class="text-xs text-muted">Messages</dt>
							<dd class="text-xs font-semibold">{threadQuery.data.messages.length}</dd>
						</div>
					</dl>

					<a class="btn-secondary mt-5 w-full" href={resolve(`/contacts/${threadQuery.data.contact.id}`)}>
						View customer profile
					</a>
				{/if}
			</div>
		</aside>
	{/if}
</div>
