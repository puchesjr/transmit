alter table phone_numbers
  add column campaign_assigned_at timestamptz;

alter table messaging_registrations
  add column contact_phone text,
  add column city text,
  add column region text,
  add column postal_code text;
