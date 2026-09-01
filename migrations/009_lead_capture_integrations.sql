create table lead_forms (
  id uuid primary key,
  account_id uuid not null references accounts (id) on delete cascade,
  location_id uuid not null,
  kind text not null
    check (kind in ('service', 'quote', 'appointment', 'question')),
  public_key text not null unique,
  title text not null,
  intro text not null,
  reply_template text not null,
  consent_text text not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (account_id, location_id)
    references locations (account_id, id),
  unique (account_id, location_id, kind),
  unique (account_id, id)
);

create index lead_forms_account_location_idx
  on lead_forms (account_id, location_id, kind);

create table lead_captures (
  id uuid primary key,
  account_id uuid not null references accounts (id) on delete cascade,
  location_id uuid not null,
  form_id uuid not null,
  contact_id uuid not null,
  conversation_id uuid not null,
  opportunity_id uuid not null,
  submission_key text not null,
  source_page text,
  referrer text,
  campaign jsonb not null default '{}'::jsonb,
  requested_service text,
  preferred_time text,
  message text,
  consent_text text not null,
  consented_at timestamptz not null,
  ip_hash text,
  user_agent text,
  created_at timestamptz not null default now(),
  foreign key (account_id, location_id)
    references locations (account_id, id),
  foreign key (account_id, form_id)
    references lead_forms (account_id, id),
  foreign key (account_id, contact_id)
    references contacts (account_id, id),
  foreign key (account_id, conversation_id)
    references conversations (account_id, id),
  foreign key (account_id, opportunity_id)
    references opportunities (account_id, id),
  unique (form_id, submission_key),
  unique (account_id, id)
);

create index lead_captures_account_created_idx
  on lead_captures (account_id, created_at desc);
create index lead_captures_contact_idx
  on lead_captures (account_id, contact_id, created_at desc);

create table webhook_endpoints (
  id uuid primary key,
  account_id uuid not null references accounts (id) on delete cascade,
  url text not null,
  signing_secret text not null,
  secret_hint text not null,
  events text[] not null,
  enabled boolean not null default true,
  created_by uuid references users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (account_id, url),
  unique (account_id, id)
);

create index webhook_endpoints_account_idx
  on webhook_endpoints (account_id, enabled, created_at desc);

create table webhook_deliveries (
  id uuid primary key,
  event_id uuid not null,
  account_id uuid not null references accounts (id) on delete cascade,
  location_id uuid not null,
  endpoint_id uuid not null,
  event_type text not null
    check (event_type in ('contact.created', 'message.received', 'opportunity.stage_changed')),
  payload jsonb not null,
  status text not null default 'pending'
    check (status in ('pending', 'delivered', 'failed')),
  attempts integer not null default 0,
  response_status integer,
  last_error text,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (account_id, location_id)
    references locations (account_id, id),
  foreign key (account_id, endpoint_id)
    references webhook_endpoints (account_id, id) on delete cascade,
  unique (endpoint_id, event_id),
  unique (account_id, id)
);

create index webhook_deliveries_pending_idx
  on webhook_deliveries (account_id, status, created_at desc);
