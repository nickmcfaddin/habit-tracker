export const defaultHabits = [
  {
    name: 'Sleep',
    habit_type: 'number',
    unit: 'hours',
    partial_threshold: 6,
    full_threshold: 7,
    is_required: true,
  },
  {
    name: 'Waters',
    habit_type: 'number',
    partial_threshold: 10,
    full_threshold: 12,
    is_required: true,
  },
  { name: 'Journal', habit_type: 'boolean', is_required: true },
  { name: 'Stretch', habit_type: 'boolean', is_required: true },
  { name: 'Workout', habit_type: 'boolean', is_required: true },
  { name: 'Read', habit_type: 'boolean', is_required: false, schedule_days: [] },
].map((habit, index) => ({
  ...habit,
  schedule_days: habit.schedule_days ?? [0, 1, 2, 3, 4, 5, 6],
  position: index,
  is_active: true,
}));