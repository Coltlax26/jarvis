#!/bin/sh
# Start Jarvis on this Mac. Keeps the Mac awake while it runs (caffeinate -s).
# Leave this Terminal window open. Press Ctrl-C to stop.
cd "$(dirname "$0")"
echo "Starting Jarvis — web console at http://localhost:3000"
exec caffeinate -s npm run dev
