import { supabase } from './supabase';

async function readScheduleSnapshot(userId, date) {
  const { data, error } = await supabase
    .from('habit_schedule_snapshots')
    .select('required_habit_ids')
    .eq('user_id', userId)
    .eq('snapshot_date', date)
    .maybeSingle();

  if (error) throw error;

  return data;
}

export async function getOrCreateScheduleSnapshot(
  userId,
  date,
  requiredHabitIds
) {
  let snapshot = await readScheduleSnapshot(userId, date);

  if (!snapshot) {
    const { error } = await supabase
      .from('habit_schedule_snapshots')
      .upsert(
        {
          user_id: userId,
          snapshot_date: date,
          required_habit_ids: requiredHabitIds,
        },
        { onConflict: 'user_id,snapshot_date', ignoreDuplicates: true }
      );

    if (error) throw error;

    snapshot = await readScheduleSnapshot(userId, date);
  }

  if (!snapshot) {
    throw new Error('Unable to load the schedule snapshot for this date.');
  }

  return snapshot.required_habit_ids;
}

export async function saveScheduleSnapshot(userId, date, requiredHabitIds) {
  const { error } = await supabase
    .from('habit_schedule_snapshots')
    .upsert(
      {
        user_id: userId,
        snapshot_date: date,
        required_habit_ids: requiredHabitIds,
      },
      { onConflict: 'user_id,snapshot_date' }
    );

  if (error) throw error;
}
