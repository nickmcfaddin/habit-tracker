export function getHabitCompletionScore(habit, value) {
  if (habit.habit_type === 'boolean') {
    return value === true ? 1 : 0;
  }

  if (value === undefined || value === null || value === '') return 0;

  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return 0;

  if (
    habit.partial_threshold !== null &&
    habit.partial_threshold !== undefined &&
    habit.full_threshold !== null &&
    habit.full_threshold !== undefined
  ) {
    const partialThreshold = Number(habit.partial_threshold);
    const fullThreshold = Number(habit.full_threshold);
    if (
      Number.isFinite(partialThreshold) &&
      Number.isFinite(fullThreshold)
    ) {
      if (numericValue >= fullThreshold) return 1;
      return numericValue >= partialThreshold ? 0.5 : 0;
    }
  }

  return 1;
}

export function formatCompletionScore(score) {
  return Number.isInteger(score) ? String(score) : score.toFixed(1);
}
