create table conversations (
  id uuid primary key,
  account_id uuid not null references accounts (id) on delete cascade,
  location_id uuid not null references locations (id),
  contact_id uuid not null references contacts (id) on delete cascade,
  phone_number_id uuid not null references phone_numbers (id),
  status text not null default 'open'
    check (status in ('open', 'waiting', 'snoozed', 'closed')),
  assignee_user_id uuid references users (id) on delete set null,
  last_message_at timestamptz not null default now(),
  snoozed_until timestamptz,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index conversations_sms_thread_uidx
  on conversations (account_id, contact_id, phone_number_id);
create unique index conversations_account_id_id_uidx
  on conversations (account_id, id);
create index conversations_queue_idx
  on conversations (account_id, status, last_message_at desc);
create index conversations_location_idx
  on conversations (account_id, location_id, last_message_at desc);

alter table messages add column conversation_id uuid;

insert into conversations (
  id, account_id, location_id, contact_id, phone_number_id, status, last_message_at,
  created_at, updated_at
)
select
  (array_agg(m.id order by m.created_at asc, m.id asc))[1],
  m.account_id,
  m.location_id,
  m.contact_id,
  m.phone_number_id,
  'open',
  max(m.created_at),
  min(m.created_at),
  max(m.updated_at)
from messages m
group by m.account_id, m.location_id, m.contact_id, m.phone_number_id;

update messages m
set conversation_id = c.id
from conversations c
where c.account_id = m.account_id
  and c.location_id = m.location_id
  and c.contact_id = m.contact_id
  and c.phone_number_id = m.phone_number_id;

alter table messages alter column conversation_id set not null;
alter table messages add constraint messages_conversation_tenant_fk
  foreign key (account_id, conversation_id)
  references conversations (account_id, id)
  on delete cascade;

create index messages_conversation_thread_idx
  on messages (account_id, conversation_id, created_at asc, id asc);
