alter table locations add column voice_forwarding_number text;
alter table locations add column missed_call_textback_enabled boolean not null default true;
alter table locations add column missed_call_template text not null
  default 'Sorry we missed your call — how can we help? Reply STOP to opt out.';
alter table locations add column business_hours jsonb not null default
  '{"mon":{"enabled":true,"opensAt":"08:00","closesAt":"17:00"},"tue":{"enabled":true,"opensAt":"08:00","closesAt":"17:00"},"wed":{"enabled":true,"opensAt":"08:00","closesAt":"17:00"},"thu":{"enabled":true,"opensAt":"08:00","closesAt":"17:00"},"fri":{"enabled":true,"opensAt":"08:00","closesAt":"17:00"},"sat":{"enabled":false,"opensAt":"08:00","closesAt":"17:00"},"sun":{"enabled":false,"opensAt":"08:00","closesAt":"17:00"}}'::jsonb;

create unique index if not exists locations_account_id_id_uidx
  on locations (account_id, id);
create unique index if not exists contacts_account_id_id_uidx
  on contacts (account_id, id);
create unique index if not exists phone_numbers_account_id_id_uidx
  on phone_numbers (account_id, id);
create unique index if not exists messages_account_id_id_uidx
  on messages (account_id, id);

create table calls (
  id uuid primary key,
  account_id uuid not null references accounts (id) on delete cascade,
  location_id uuid not null,
  contact_id uuid not null,
  phone_number_id uuid not null,
  provider_call_session_id text not null,
  provider_call_control_id text not null,
  direction text not null check (direction in ('inbound', 'outbound')),
  status text not null check (
    status in ('ringing', 'forwarding', 'answered', 'missed', 'completed', 'failed')
  ),
  from_e164 text not null,
  to_e164 text not null,
  started_at timestamptz not null,
  answered_at timestamptz,
  ended_at timestamptz,
  duration_seconds integer check (duration_seconds is null or duration_seconds >= 0),
  hangup_cause text,
  after_hours boolean not null default false,
  textback_message_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (account_id, location_id)
    references locations (account_id, id),
  foreign key (account_id, contact_id)
    references contacts (account_id, id) on delete cascade,
  foreign key (account_id, phone_number_id)
    references phone_numbers (account_id, id),
  foreign key (account_id, textback_message_id)
    references messages (account_id, id) on delete set null,
  unique (account_id, provider_call_session_id)
);

create unique index calls_account_id_id_uidx on calls (account_id, id);
create index calls_account_created_idx on calls (account_id, started_at desc);
create index calls_location_created_idx on calls (account_id, location_id, started_at desc);
create index calls_contact_timeline_idx on calls (account_id, contact_id, started_at desc);
