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
			await queryClient.invalidateQueries({ queryKey: ['contacts'] });
		} catch (err) {
			error = err;
		} finally {
			pending = false;
		}
	}
</script>

<div class="mx-auto max-w-4xl space-y-6">
	<div>
		<h1 class="text-2xl font-semibold tracking-tight">Contacts</h1>
		<p class="text-sm text-muted">People you sell to. Open a contact for the timeline.</p>
	</div>

	<form class="card grid gap-3 p-4 md:grid-cols-5 md:items-end" {onsubmit}>
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
			<input id="contact-email" class="input" type="email" bind:value={email} />
		</div>
		<div>
			<label class="label" for="contact-phone">Phone</label>
			<input id="contact-phone" class="input" bind:value={phone} />
		</div>
		<button class="btn" type="submit" disabled={pending}>{pending ? 'Adding…' : 'Add contact'}</button>
		<div class="md:col-span-5">
			<ErrorText {error} />
		</div>
	</form>

	{#if contactsQuery.isPending}
		<p class="text-sm text-muted">Loading contacts…</p>
	{:else if contactsQuery.isError}
		<ErrorText error={contactsQuery.error} />
	{:else if (contactsQuery.data?.contacts.length ?? 0) === 0}
		<div class="card p-8 text-sm text-muted">No contacts yet. Add someone above.</div>
	{:else}
		<ul class="card divide-y divide-line">
			{#each contactsQuery.data?.contacts ?? [] as contact (contact.id)}
				<li>
					<a
						class="flex items-center justify-between gap-4 px-4 py-3 hover:bg-canvas"
						href={resolve(`/contacts/${contact.id}`)}
					>
						<span class="font-medium">{contactName(contact)}</span>
						<span class="text-sm text-muted">{contact.email ?? contact.phone ?? ''}</span>
					</a>
				</li>
			{/each}
		</ul>
	{/if}
</div>
