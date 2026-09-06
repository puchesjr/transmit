-- Do not infer ownership of historical web messages from timestamps: sessions overlap.
alter table messages add column booking_session_id uuid;
alter table messages add constraint messages_booking_session_fk
  foreign key (account_id, booking_session_id) references booking_sessions (account_id, id);
alter table messages add constraint messages_booking_channel_check
  check (booking_session_id is null or channel = 'web');
create index messages_booking_session_idx
  on messages (account_id, booking_session_id, created_at, id)
  where booking_session_id is not null;

-- Legacy sessions have no verified visitor snapshot and must hand off before scheduling.
alter table booking_sessions add column customer_input jsonb;
