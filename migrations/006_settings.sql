-- Per-user settings, editable live from the console (voice, greeting, etc.).
-- Anything not present here falls back to the environment-variable default.
create table settings (
  user_id    text not null references users(id),
  key        text not null,
  value      text not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, key)
);
