alter table locations add column timezone text not null default 'America/Chicago';
alter table locations add column quiet_start time;
alter table locations add column quiet_end time;

alter table contacts add column messaging_consent text not null default 'unknown'
  check (messaging_consent in ('unknown', 'opted_in', 'opted_out'));

create table phone_numbers (
  id uuid primary key,
  account_id uuid not null references accounts (id) on delete cascade,
  location_id uuid not null references locations (id),
  e164 text not null unique,
  provider_number_id text,
  status text not null check (status in ('active', 'released')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index phone_numbers_account_idx on phone_numbers (account_id);
create unique index phone_numbers_location_active_idx on phone_numbers (location_id)
  where status = 'active';

create table messaging_registrations (
  id uuid primary key,
  account_id uuid not null unique references accounts (id) on delete cascade,
  legal_name text not null,
  ein text,
  website text,
  address text not null,
  contact_email text not null,
  use_case text not null,
  sample_message text not null,
  status text not null check (status in ('submitted', 'approved', 'rejected')),
  provider_brand_id text,
  provider_campaign_id text,
  rejection_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table messages (
  id uuid primary key,
  account_id uuid not null references accounts (id) on delete cascade,
  location_id uuid not null references locations (id),
  contact_id uuid not null references contacts (id) on delete cascade,
  phone_number_id uuid not null references phone_numbers (id),
  direction text not null check (direction in ('outbound', 'inbound')),
  body text not null,
  status text not null check (status in ('queued', 'sent', 'delivered', 'failed', 'received')),
  provider_message_id text,
  error text,
  not_before timestamptz,
  read_at timestamptz,
  created_by uuid references users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index messages_thread_idx on messages (account_id, contact_id, created_at desc);
create index messages_account_idx on messages (account_id, created_at desc);
create unique index messages_provider_id_idx on messages (provider_message_id)
  where provider_message_id is not null;
create index messages_unread_idx on messages (account_id, contact_id)
  where direction = 'inbound' and read_at is null;

create table outbox (
  id uuid primary key,
  account_id uuid,
  kind text not null,
  payload jsonb not null,
  run_after timestamptz not null default now(),
  attempts integer not null default 0,
  locked_at timestamptz,
  processed_at timestamptz,
  last_error text,
  created_at timestamptz not null default now()
);

create index outbox_pending_idx on outbox (run_after) where processed_at is null;

create table provider_events (
  id text primary key,
  received_at timestamptz not null default now()
);
