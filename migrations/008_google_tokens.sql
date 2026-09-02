-- Per-user Google OAuth tokens (Gmail + Calendar). One row per connected user.
-- Populated by the /auth/google callback; the refresh_token is the durable part.
create table google_tokens (
  user_id text primary key references users(id),
  access_token text,
  refresh_token text not null,
  scope text,
  token_type text,
  expiry_date bigint,
  updated_at timestamptz not null default now()
);
