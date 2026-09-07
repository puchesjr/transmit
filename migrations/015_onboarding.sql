alter table accounts
  add column onboarding_completed_at timestamptz,
  add column onboarding_dismissed_at timestamptz;

-- Existing workspaces already skipped this path; do not trap them in setup.
update accounts
set onboarding_completed_at = created_at
where onboarding_completed_at is null;
