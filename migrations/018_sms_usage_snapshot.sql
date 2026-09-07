-- Freeze the chargeable segment quantity when recording usage, so a delayed
-- outbox report cannot reapply a later billing period's included allowance.
alter table usage_events add column billable_quantity integer check (billable_quantity >= 0);
alter table messages add column dispatch_started_at timestamptz;
