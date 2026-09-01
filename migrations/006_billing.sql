create table billing_accounts (
  id uuid primary key,
  account_id uuid not null unique references accounts (id) on delete cascade,
  status text not null default 'unconfigured'
    check (status in ('unconfigured', 'trialing', 'active', 'past_due', 'canceled')),
  provider_customer_id text unique,
  provider_subscription_id text unique,
  card_on_file boolean not null default false,
  trial_ends_at timestamptz,
  current_period_start timestamptz,
  current_period_end timestamptz,
  grace_ends_at timestamptz,
  sending_disabled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into billing_accounts (id, account_id)
select id, id from accounts
on conflict (account_id) do nothing;

create table usage_events (
  id uuid primary key,
  account_id uuid not null references accounts (id) on delete cascade,
  location_id uuid not null,
  metric text not null
    check (metric in ('message_outbound', 'message_inbound', 'call_second')),
  quantity bigint not null check (quantity > 0),
  source_type text not null,
  source_id text not null,
  occurred_at timestamptz not null,
  provider_reported_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (account_id, location_id)
    references locations (account_id, id),
  unique (account_id, metric, source_type, source_id)
);

create unique index billing_accounts_account_id_id_uidx
  on billing_accounts (account_id, id);
create index usage_events_account_period_idx
  on usage_events (account_id, occurred_at desc);
create index usage_events_location_period_idx
  on usage_events (account_id, location_id, occurred_at desc);
create index usage_events_unreported_idx
  on usage_events (account_id, created_at)
  where provider_reported_at is null and metric in ('message_outbound', 'message_inbound');
