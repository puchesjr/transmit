alter table calls
  add column forwarding_call_control_id text;

create index calls_forwarding_cc_idx
  on calls (account_id, forwarding_call_control_id)
  where forwarding_call_control_id is not null;

alter table locations
  alter column missed_call_template set default
    'Sorry we missed your call. How can we help? Reply STOP to opt out.';

update locations
set missed_call_template = 'Sorry we missed your call. How can we help? Reply STOP to opt out.',
    updated_at = now()
where missed_call_template = 'Sorry we missed your call — how can we help? Reply STOP to opt out.';
