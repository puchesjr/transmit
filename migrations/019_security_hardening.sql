alter table billing_accounts
	add column pending_checkout_session_id text,
	add column pending_checkout_created_at timestamptz;

create table auth_attempts (
	id uuid primary key,
	action text not null check (action in ('signin', 'signup')),
	key_hash text not null,
	created_at timestamptz not null default now()
);

create index auth_attempts_lookup_idx
	on auth_attempts (action, key_hash, created_at desc);
