-- Existing billed messages stay unchanged; NULL identifies legacy estimates.
alter table messages add column sms_segments integer check (sms_segments > 0);
alter table messages add column sms_encoding text check (sms_encoding in ('GSM-7', 'UTF-16'));
alter table messages add column provider_segments integer check (provider_segments > 0);
alter table messages add column provider_cost_usd numeric(18,6) check (provider_cost_usd >= 0);

create table telecom_terms (
 account_id uuid primary key references accounts(id),
 version text not null,
 accepted_by uuid not null references users(id),
 accepted_at timestamptz not null default now()
);
create table telecom_charges (
 id uuid primary key,
 account_id uuid not null references accounts(id),
 location_id uuid not null,
 charge_key text not null,
 description text not null,
 amount_cents integer not null check (amount_cents > 0),
 terms_version text not null,
 status text not null default 'pending' check (status in ('pending','paid','review')),
 provider_invoice_id text,
 invoice_url text,
 operation_started_at timestamptz,
 created_at timestamptz not null default now(),
 paid_at timestamptz,
 unique(account_id, charge_key),
 foreign key(account_id, location_id) references locations(account_id,id)
);
create table telecom_resources (
 id uuid primary key,
 account_id uuid not null references accounts(id),
 location_id uuid not null,
 kind text not null check (kind in ('campaign','number')),
 resource_id uuid not null,
 monthly_cents integer not null check (monthly_cents > 0),
 terms_version text not null,
 billed_until timestamptz not null,
 created_at timestamptz not null default now(),
 unique(account_id, kind, resource_id),
 foreign key(account_id, location_id) references locations(account_id,id)
);
