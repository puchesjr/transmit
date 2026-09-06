alter table appointments
  drop constraint if exists appointments_provider_provider_booking_id_key;

alter table appointments
  drop constraint if exists appointments_provider_idempotency_key;

alter table appointments
  add constraint appointments_account_provider_booking_id_key
  unique (account_id, provider, provider_booking_id);

alter table appointments
  add constraint appointments_account_provider_idempotency_key
  unique (account_id, provider, idempotency_key);
