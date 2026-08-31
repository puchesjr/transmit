-- amount_cents must hold the validation max (10_000_000_000), which overflows int4.
alter table opportunities alter column amount_cents type bigint;
