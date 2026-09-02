-- Sales pipeline: businesses Colt is prospecting for website work (or any deal).
-- Jarvis fills this from lead-gen runs; Colt works it in the console Prospects tab.
create table prospects (
  id text primary key,
  user_id text not null references users(id),
  name text not null,
  business_type text,
  town text,
  phone text,
  website text,
  status text not null default 'new'
    check (status in ('new','contacted','interested','quoted','won','lost')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index prospects_user_idx on prospects (user_id, status, updated_at desc);
