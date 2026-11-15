# habit-tracker

## Database schedules

The app expects the per-user `habit_schedule_snapshots` table to be set up in
Supabase. Dates without snapshots are initialized when opened; earlier
schedules cannot be reconstructed for dates that were never snapshotted.

To update existing accounts' Creatine and Electrolytes schedules, run
[`habit-tracker/supabase/manual_updates/20261115_update_creatine_electrolytes_schedules.sql`](./habit-tracker/supabase/manual_updates/20261115_update_creatine_electrolytes_schedules.sql)
once in the Supabase SQL Editor. New accounts receive these schedules from
`defaultHabits.js`.