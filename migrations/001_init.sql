create table accounts (
  id uuid primary key,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table locations (
  id uuid primary key,
  account_id uuid not null references accounts (id) on delete cascade,
  name text not null,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index locations_account_id_idx on locations (account_id);
create unique index locations_default_account_idx on locations (account_id) where is_default;

create table users (
  id uuid primary key,
  email text not null,
  password_hash text not null,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index users_email_lower_idx on users (lower(email));

create table account_users (
  id uuid primary key,
  account_id uuid not null references accounts (id) on delete cascade,
  user_id uuid not null references users (id) on delete cascade,
  role text not null check (role in ('owner', 'member')),
  created_at timestamptz not null default now(),
  unique (account_id, user_id)
);

create index account_users_user_id_idx on account_users (user_id);

create table sessions (
  id uuid primary key,
  user_id uuid not null references users (id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index sessions_user_id_idx on sessions (user_id);
create index sessions_expires_at_idx on sessions (expires_at);

create table contacts (
  id uuid primary key,
  account_id uuid not null references accounts (id) on delete cascade,
  location_id uuid not null references locations (id),
  first_name text not null default '',
  last_name text not null default '',
  email text,
  phone text,
  created_by uuid references users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index contacts_account_id_idx on contacts (account_id);

create table companies (
  id uuid primary key,
  account_id uuid not null references accounts (id) on delete cascade,
  location_id uuid not null references locations (id),
  name text not null,
  domain text,
  created_by uuid references users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index companies_account_id_idx on companies (account_id);

create table company_contacts (
  id uuid primary key,
  account_id uuid not null references accounts (id) on delete cascade,
  company_id uuid not null references companies (id) on delete cascade,
  contact_id uuid not null references contacts (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (account_id, company_id, contact_id)
);

create index company_contacts_contact_idx on company_contacts (account_id, contact_id);

create table pipelines (
  id uuid primary key,
  account_id uuid not null references accounts (id) on delete cascade,
  name text not null,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index pipelines_account_id_idx on pipelines (account_id);
create unique index pipelines_default_account_idx on pipelines (account_id) where is_default;

create table pipeline_stages (
  id uuid primary key,
  account_id uuid not null references accounts (id) on delete cascade,
  pipeline_id uuid not null references pipelines (id) on delete cascade,
  name text not null,
  position integer not null,
  created_at timestamptz not null default now(),
  unique (pipeline_id, position)
);

create index pipeline_stages_account_id_idx on pipeline_stages (account_id);

create table opportunities (
  id uuid primary key,
  account_id uuid not null references accounts (id) on delete cascade,
  location_id uuid not null references locations (id),
  pipeline_id uuid not null references pipelines (id),
  stage_id uuid not null references pipeline_stages (id),
  contact_id uuid references contacts (id) on delete set null,
  company_id uuid references companies (id) on delete set null,
  name text not null,
  amount_cents integer,
  created_by uuid references users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index opportunities_account_id_idx on opportunities (account_id);
create index opportunities_contact_idx on opportunities (account_id, contact_id);
create index opportunities_stage_idx on opportunities (account_id, stage_id);

create table activities (
  id uuid primary key,
  account_id uuid not null references accounts (id) on delete cascade,
  contact_id uuid references contacts (id) on delete cascade,
  company_id uuid references companies (id) on delete set null,
  opportunity_id uuid references opportunities (id) on delete set null,
  type text not null,
  summary text not null,
  payload jsonb not null default '{}'::jsonb,
  created_by uuid references users (id),
  created_at timestamptz not null default now()
);

create index activities_contact_timeline_idx on activities (account_id, contact_id, created_at desc);
create index activities_account_id_idx on activities (account_id);
