export function getHabitCompletionScore(habit, value) {
  if (habit.habit_type === 'boolean') {
    return value === true ? 1 : 0;
  }

  if (value === undefined || value === null || value === '') return 0;

  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return 0;

  if (habit.name === 'Waters') {
    if (numericValue >= 12) return 1;
    return numericValue >= 10 ? 0.5 : 0;
  }

  if (habit.name === 'Sleep') {
    if (numericValue >= 7) return 1;
    return numericValue >= 6 ? 0.5 : 0;
  }

  return 1;
}

export function formatCompletionScore(score) {
  return Number.isInteger(score) ? String(score) : score.toFixed(1);
}
