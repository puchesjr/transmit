<script lang="ts">
	import { resolve } from '$app/paths';
	import { createQuery, useQueryClient } from '@tanstack/svelte-query';
	import { api } from '$lib/client/api';
	import ErrorText from '$lib/client/ErrorText.svelte';
	import { contactName } from '$lib/format';
	import type { Contact } from '$lib/types';

	const queryClient = useQueryClient();
	const contactsQuery = createQuery(() => ({
		queryKey: ['contacts'],
		queryFn: () => api.get<{ contacts: Contact[] }>('/api/v1/contacts')
	}));

	let firstName = $state('');
	let lastName = $state('');
	let email = $state('');
	let phone = $state('');
	let error = $state<unknown>(null);
	let pending = $state(false);
	let createOpen = $state(false);

	async function onsubmit(event: SubmitEvent) {
		event.preventDefault();
		error = null;
		pending = true;
		try {
			await api.post('/api/v1/contacts', { firstName, lastName, email, phone });
			firstName = '';
			lastName = '';
			email = '';
			phone = '';
			createOpen = false;
			await queryClient.invalidateQueries({ queryKey: ['contacts'] });
		} catch (err) {
			error = err;
		} finally {
			pending = false;
		}
	}
</script>

<div class="page-wrap">
	<header class="page-header">
		<div>
			<p class="mb-2 text-xs font-bold tracking-[0.12em] text-accent uppercase">Relationships</p>
			<h1 class="page-title">Customers</h1>
			<p class="page-subtitle">Every customer, conversation, and open lead in one place.</p>
		</div>
		<div class="flex items-center gap-2 self-start sm:self-auto">
			{#if contactsQuery.data}<span class="badge">{contactsQuery.data.contacts.length} total</span>{/if}
			<span class="lg:hidden">
				<button class="btn" type="button" onclick={() => (createOpen = !createOpen)}>
					{createOpen ? 'Close' : 'New customer'}
				</button>
			</span>
		</div>
	</header>

	<div class="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
		<section class="min-w-0">
			{#if contactsQuery.isPending}
				<div class="card p-6 text-sm text-muted">Loading customers…</div>
			{:else if contactsQuery.isError}
				<div class="card p-6"><ErrorText error={contactsQuery.error} /></div>
			{:else if (contactsQuery.data?.contacts.length ?? 0) === 0}
				<div class="empty-state">
					<span class="avatar mb-4 size-12">
						<svg class="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
							<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
							<circle cx="12" cy="7" r="4" />
						</svg>
					</span>
					<p class="font-semibold text-ink">No customers yet</p>
					<p class="mt-1 max-w-xs text-sm leading-6 text-muted">Add your first customer to start a timeline and conversation.</p>
				</div>
			{:else}
				<div class="card overflow-hidden">
					<div class="panel-heading">
						<h2 class="panel-title">All customers</h2>
						<span class="text-xs text-muted">Recently added</span>
					</div>
					<ul class="divide-y divide-line/70">
						{#each contactsQuery.data?.contacts ?? [] as contact (contact.id)}
							<li>
								<a class="list-row" href={resolve(`/contacts/${contact.id}`)}>
									<span class="avatar">{(contactName(contact).charAt(0) || '#').toUpperCase()}</span>
									<span class="min-w-0 flex-1">
										<span class="block truncate text-sm font-semibold text-ink">{contactName(contact)}</span>
										<span class="mt-0.5 block truncate text-xs text-muted">{contact.email ?? contact.phone ?? 'No contact details'}</span>
									</span>
									<svg class="size-4 shrink-0 text-muted/45" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="m9 18 6-6-6-6" /></svg>
								</a>
							</li>
						{/each}
					</ul>
				</div>
			{/if}
		</section>

		<form class={`card overflow-hidden lg:sticky lg:top-8 lg:block ${createOpen ? 'block' : 'hidden'}`} {onsubmit}>
			<div class="panel-heading">
				<div>
					<h2 class="panel-title">New customer</h2>
					<p class="mt-0.5 text-xs text-muted">Add someone to your customer list</p>
				</div>
				<span class="flex size-9 items-center justify-center rounded-xl bg-accent/10 text-accent">
					<svg class="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14" /></svg>
				</span>
			</div>
			<div class="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-1">
				<div>
					<label class="label" for="first-name">First name</label>
					<input id="first-name" class="input" bind:value={firstName} />
				</div>
				<div>
					<label class="label" for="last-name">Last name</label>
					<input id="last-name" class="input" bind:value={lastName} />
				</div>
				<div>
					<label class="label" for="contact-email">Email</label>
					<input id="contact-email" class="input" type="email" placeholder="name@company.com" bind:value={email} />
				</div>
				<div>
					<label class="label" for="contact-phone">Phone</label>
					<input id="contact-phone" class="input" placeholder="+1 512 555 0100" bind:value={phone} />
				</div>
				<ErrorText {error} />
				<button class="btn w-full" type="submit" disabled={pending}>{pending ? 'Adding…' : 'Add customer'}</button>
			</div>
		</form>
	</div>
</div>
