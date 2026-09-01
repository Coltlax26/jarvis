-- A running log of what Jarvis does, for the web console's activity feed.
create table activity (
  id          text primary key,
  user_id     text not null references users(id),
  kind        text not null,   -- 'message_in' | 'reply' | 'action_run' | 'action_held' | 'action_approved' | 'action_rejected' | 'reminder_sent' | 'error'
  summary     text not null,
  detail      jsonb,
  created_at  timestamptz not null default now()
);
create index activity_user_created_idx on activity (user_id, created_at desc);
