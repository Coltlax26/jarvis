-- Optional per-user persona / specialty, appended to Jarvis's system prompt for
-- that user (e.g. "You are a high-ticket construction sales specialist").
alter table users add column persona text not null default '';
