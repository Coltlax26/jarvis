create table users (
  id           text primary key,
  name         text not null,
  notes        text not null default '',
  created_at   timestamptz not null default now()
);

create table conversations (
  id           text primary key,
  user_id      text not null references users(id),
  created_at   timestamptz not null default now()
);

create table messages (
  id               text primary key,
  conversation_id  text not null references conversations(id),
  role             text not null check (role in ('user','assistant','system')),
  surface          text not null,
  content          text not null,
  created_at       timestamptz not null default now()
);
create index messages_conv_created_idx on messages (conversation_id, created_at);

create table memories (
  id           text primary key,
  user_id      text not null references users(id),
  content      text not null,
  source       text not null default 'assistant',
  keywords     text[] not null default '{}',
  created_at   timestamptz not null default now(),
  last_used_at timestamptz
);

create table pending_actions (
  id             text primary key,
  user_id        text not null references users(id),
  action_name    text not null,
  input          jsonb not null,
  tier           int not null check (tier in (1,2)),
  status         text not null check (status in
                   ('draft','awaiting_approval','approved','rejected','done','failed')),
  origin_surface text not null,
  summary        text not null default '',
  result         jsonb,
  created_at     timestamptz not null default now(),
  resolved_at    timestamptz
);
create index pending_actions_open_idx on pending_actions (user_id, status);

create table scheduled_messages (
  id           text primary key,
  user_id      text not null references users(id),
  deliver_at   timestamptz not null,
  body         text not null,
  source       text not null default 'reminder',
  status       text not null check (status in ('pending','sent','canceled')) default 'pending',
  created_at   timestamptz not null default now()
);
create index scheduled_messages_due_idx on scheduled_messages (status, deliver_at);
