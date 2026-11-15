# habit-tracker

## Database migration

Before using daily schedule snapshots, run
[`habit-tracker/supabase/migrations/20261115200700_create_habit_schedule_snapshots.sql`](./habit-tracker/supabase/migrations/20261115200700_create_habit_schedule_snapshots.sql)
in the Supabase SQL Editor. It creates a private per-user snapshot for each
date. A date without a snapshot is initialized the first time it is opened;
past schedules from before this migration cannot be reconstructed.