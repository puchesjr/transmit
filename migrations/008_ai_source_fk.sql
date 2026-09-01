alter table ai_artifacts
  drop constraint ai_artifacts_account_id_source_last_message_id_fkey;

alter table ai_artifacts
  add constraint ai_artifacts_account_id_source_last_message_id_fkey
  foreign key (account_id, source_last_message_id)
  references messages (account_id, id);
