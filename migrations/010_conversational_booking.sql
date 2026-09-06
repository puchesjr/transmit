alter table messages add column channel text not null default 'sms'
  check (channel in ('sms', 'web'));

create table booking_settings (
  account_id uuid not null references accounts (id) on delete cascade,
  location_id uuid not null,
  enabled boolean not null default false,
  provider_location_id text,
  minimum_notice_minutes integer not null default 120
    check (minimum_notice_minutes between 0 and 10080),
  booking_window_days integer not null default 14
    check (booking_window_days between 1 and 90),
  session_timeout_minutes integer not null default 30
    check (session_timeout_minutes between 5 and 120),
  confirmation_template text not null default
    'Your appointment with {{location_name}} is booked for {{appointment_time}}. Reply STOP to opt out.',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (account_id, location_id),
  foreign key (account_id, location_id)
    references locations (account_id, id) on delete cascade
);

create table booking_services (
  id uuid primary key,
  account_id uuid not null references accounts (id) on delete cascade,
  location_id uuid not null,
  name text not null,
  duration_minutes integer not null
    check (duration_minutes between 15 and 480),
  provider_service_id text,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (account_id, location_id)
    references locations (account_id, id) on delete cascade,
  unique (account_id, id),
  unique (account_id, location_id, name)
);

create index booking_services_location_idx
  on booking_services (account_id, location_id, enabled, name);

create table booking_sessions (
  id uuid primary key,
  account_id uuid not null references accounts (id) on delete cascade,
  location_id uuid not null,
  form_id uuid not null,
  capture_id uuid not null,
  contact_id uuid not null,
  conversation_id uuid not null,
  opportunity_id uuid not null,
  service_id uuid not null,
  public_token_hash text not null unique,
  submission_key text not null,
  status text not null default 'qualifying'
    check (status in ('qualifying', 'offering', 'held', 'booked', 'handoff', 'expired', 'cancelled')),
  qualification jsonb not null default '{}'::jsonb,
  offered_slots jsonb not null default '[]'::jsonb,
  scheduler_hold_id text,
  selected_slot_id text,
  held_start timestamptz,
  held_end timestamptz,
  held_timezone text,
  hold_expires_at timestamptz,
  ai_provider text,
  ai_model text,
  handoff_reason text,
  taken_over_by uuid references users (id) on delete set null,
  ip_hash text,
  last_activity_at timestamptz not null default now(),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (account_id, location_id)
    references locations (account_id, id),
  foreign key (account_id, form_id)
    references lead_forms (account_id, id),
  foreign key (account_id, capture_id)
    references lead_captures (account_id, id),
  foreign key (account_id, contact_id)
    references contacts (account_id, id),
  foreign key (account_id, conversation_id)
    references conversations (account_id, id),
  foreign key (account_id, opportunity_id)
    references opportunities (account_id, id),
  foreign key (account_id, service_id)
    references booking_services (account_id, id),
  unique (account_id, id),
  unique (form_id, submission_key)
);

create index booking_sessions_account_status_idx
  on booking_sessions (account_id, status, updated_at desc);
create index booking_sessions_conversation_idx
  on booking_sessions (account_id, conversation_id, updated_at desc);
create index booking_sessions_expiry_idx
  on booking_sessions (expires_at)
  where status in ('qualifying', 'offering', 'held');

create table appointments (
  id uuid primary key,
  account_id uuid not null references accounts (id) on delete cascade,
  location_id uuid not null,
  booking_session_id uuid not null,
  contact_id uuid not null,
  opportunity_id uuid not null,
  service_id uuid not null,
  provider text not null,
  provider_booking_id text not null,
  idempotency_key text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  timezone text not null,
  status text not null default 'booked'
    check (status in ('booked', 'cancelled')),
  cancellation_reason text,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (account_id, location_id)
    references locations (account_id, id),
  foreign key (account_id, booking_session_id)
    references booking_sessions (account_id, id),
  foreign key (account_id, contact_id)
    references contacts (account_id, id),
  foreign key (account_id, opportunity_id)
    references opportunities (account_id, id),
  foreign key (account_id, service_id)
    references booking_services (account_id, id),
  unique (account_id, id),
  unique (account_id, booking_session_id),
  unique (provider, provider_booking_id),
  unique (provider, idempotency_key),
  check (ends_at > starts_at)
);

create index appointments_location_time_idx
  on appointments (account_id, location_id, starts_at desc);
