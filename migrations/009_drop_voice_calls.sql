-- Voice / phone calls were removed (Jarvis moved to run free on the owner's Mac,
-- which can't host the public webhooks Twilio needs). Drop the outbound-call
-- table. The `settings` table (006) is kept — the mechanism stays for future use.
drop table if exists voice_calls;
