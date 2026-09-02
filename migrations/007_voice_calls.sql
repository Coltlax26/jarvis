-- Outbound calls Jarvis places on a user's behalf (Tier-2 place_call action).
-- The counterparty is not a Jarvis user, so each call carries its own context:
-- who it represents, what it is trying to accomplish, and the running transcript.
create table voice_calls (
  id text primary key,
  call_sid text,
  owner_id text not null references users(id),
  counterparty text not null,
  purpose text not null,
  status text not null default 'queued',
  transcript jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index voice_calls_owner_idx on voice_calls (owner_id, created_at desc);
create index voice_calls_sid_idx on voice_calls (call_sid);
