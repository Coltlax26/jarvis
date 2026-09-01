-- Session store for connect-pg-simple, so web logins survive server restarts.
-- Standard schema from https://github.com/voxpelli/node-connect-pg-simple
create table "session" (
  "sid"    varchar not null collate "default",
  "sess"   json not null,
  "expire" timestamp(6) not null
);
alter table "session" add constraint "session_pkey" primary key ("sid") not deferrable initially immediate;
create index "IDX_session_expire" on "session" ("expire");
