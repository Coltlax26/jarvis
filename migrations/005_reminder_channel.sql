-- Which surface a scheduled message goes out on: 'web' (the console), 'sms', or
-- 'voice' (Jarvis calls and reads it aloud).
alter table scheduled_messages add column channel text not null default 'web';
