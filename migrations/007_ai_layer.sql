create table account_ai_settings (
  account_id uuid primary key references accounts (id) on delete cascade,
  enabled boolean not null default true,
  follow_up_enabled boolean not null default true,
  follow_up_after_days integer not null default 2
    check (follow_up_after_days between 1 and 30),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into account_ai_settings (account_id)
select id from accounts
on conflict (account_id) do nothing;

create unique index if not exists opportunities_account_id_id_uidx
  on opportunities (account_id, id);

create table ai_artifacts (
  id uuid primary key,
  account_id uuid not null references accounts (id) on delete cascade,
  location_id uuid not null,
  contact_id uuid not null,
  conversation_id uuid,
  opportunity_id uuid,
  kind text not null check (kind in ('reply', 'summary', 'follow_up')),
  status text not null default 'ready'
    check (status in ('ready', 'used', 'dismissed', 'stale')),
  content jsonb not null,
  source_last_message_id uuid,
  provider text not null,
  model text not null,
  selected_reply_index integer
    check (selected_reply_index is null or selected_reply_index between 0 and 2),
  created_by uuid references users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (account_id, location_id)
    references locations (account_id, id),
  foreign key (account_id, contact_id)
    references contacts (account_id, id) on delete cascade,
  foreign key (account_id, conversation_id)
    references conversations (account_id, id) on delete cascade,
  foreign key (account_id, opportunity_id)
    references opportunities (account_id, id) on delete cascade,
  foreign key (account_id, source_last_message_id)
    references messages (account_id, id)
);

create unique index ai_artifacts_account_id_id_uidx
  on ai_artifacts (account_id, id);
create index ai_artifacts_conversation_idx
  on ai_artifacts (account_id, conversation_id, kind, created_at desc);
create index ai_artifacts_contact_idx
  on ai_artifacts (account_id, contact_id, kind, created_at desc);
create index ai_artifacts_follow_up_queue_idx
  on ai_artifacts (account_id, status, created_at desc)
  where kind = 'follow_up';
