create table voice_costs (
 id uuid primary key,
 account_id uuid not null references accounts(id),
 location_id uuid not null,
 call_id uuid not null,
 provider_leg_id text not null,
 cost_usd numeric(18,6) not null check(cost_usd >= 0),
 billed_seconds integer not null check(billed_seconds >= 0),
 cost_parts jsonb not null,
 occurred_at timestamptz not null,
 charge_id uuid references telecom_charges(id),
 needs_review boolean not null default false,
 unique(account_id,provider_leg_id),
 foreign key(account_id,location_id) references locations(account_id,id),
 foreign key(account_id,call_id) references calls(account_id,id)
);
