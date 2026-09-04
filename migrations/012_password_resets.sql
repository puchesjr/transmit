-- Password reset tokens. Only the hash is stored; the token itself lives in
-- the email link and nowhere else. One row per request, marked used on
-- success, so a link works exactly once.
create table password_resets (
  id uuid primary key,
  user_id uuid not null references users (id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index password_resets_user_created_idx
  on password_resets (user_id, created_at desc);
