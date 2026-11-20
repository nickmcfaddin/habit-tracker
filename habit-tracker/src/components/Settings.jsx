import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import {
  getRequiredHabitIdsForDay,
  saveScheduleSnapshot,
} from '../lib/scheduleSnapshots';

const weekdays = [
  { label: 'Sun', value: 0 },
  { label: 'Mon', value: 1 },
  { label: 'Tue', value: 2 },
  { label: 'Wed', value: 3 },
  { label: 'Thu', value: 4 },
  { label: 'Fri', value: 5 },
  { label: 'Sat', value: 6 },
];

function getLocalDate() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

function getDayOfWeek(dateString) {
  const [year, month, day] = dateString.split('-').map(Number);

  return new Date(year, month - 1, day).getDay();
}

function createNewHabitDraft() {
  return {
    name: '',
    habit_type: 'boolean',
    unit: '',
    partial_threshold: '',
    full_threshold: '',
    is_required: true,
    schedule_days: [0, 1, 2, 3, 4, 5, 6],
  };
}

function parseNumericThresholds(partial, full) {
  if (partial === '' || full === '') {
    throw new Error('Enter both numeric completion thresholds.');
  }

  const partialThreshold = Number(partial);
  const fullThreshold = Number(full);
  if (
    !Number.isFinite(partialThreshold) ||
    !Number.isFinite(fullThreshold) ||
    partialThreshold < 0 ||
    fullThreshold <= partialThreshold
  ) {
    throw new Error(
      'The full-point threshold must be greater than the 0.5-point threshold.'
    );
  }

  return {
    partial_threshold: partialThreshold,
    full_threshold: fullThreshold,
  };
}

export default function Settings({ user, onBack }) {
  const [habits, setHabits] = useState([]);
  const [savedSettings, setSavedSettings] = useState({});
  const [newHabit, setNewHabit] = useState(createNewHabitDraft);
  const [editingHabitId, setEditingHabitId] = useState(null);
  const [editDraft, setEditDraft] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState({});
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    async function loadHabits() {
      const { data, error } = await supabase
        .from('habits')
        .select('*')
        .eq('user_id', user.id)
        .eq('is_active', true)
        .order('position');

      if (error) {
        setError(error.message);
      } else {
        const loadedHabits = (data || []).map((habit) => ({
          ...habit,
          schedule_days: habit.schedule_days || [],
          is_required: habit.is_required !== false,
        }));
        setHabits(loadedHabits);
        setSavedSettings(
          Object.fromEntries(
            loadedHabits.map((habit) => [
              habit.id,
              {
                schedule_days: habit.schedule_days,
                is_required: habit.is_required,
              },
            ])
          )
        );
      }

      setLoading(false);
    }

    loadHabits();
  }, [user.id]);

  function getSavedHabits() {
    return habits.map((habit) => ({
      ...habit,
      ...(savedSettings[habit.id] || {}),
    }));
  }

  async function saveTodaySchedule(currentHabits) {
    const today = getLocalDate();
    await saveScheduleSnapshot(
      user.id,
      today,
      getRequiredHabitIdsForDay(currentHabits, getDayOfWeek(today))
    );
  }

  function startEditing(habit) {
    setError('');
    setMessage('');
    setEditingHabitId(habit.id);
    setEditDraft({
      name: habit.name,
      unit: habit.unit || '',
      partial_threshold:
        habit.partial_threshold === null ||
        habit.partial_threshold === undefined
          ? ''
          : String(habit.partial_threshold),
      full_threshold:
        habit.full_threshold === null || habit.full_threshold === undefined
          ? ''
          : String(habit.full_threshold),
      is_required: habit.is_required,
      schedule_days: [...(habit.schedule_days || [])],
    });
  }

  async function saveHabitEdit(habit) {
    setError('');
    setMessage('');

    const name = editDraft.name.trim();
    if (!name) {
      setError('Enter a habit name.');
      return;
    }

    if (
      habits.some(
        (item) =>
          item.id !== habit.id &&
          item.name.toLowerCase() === name.toLowerCase()
      )
    ) {
      setError('A habit with that name already exists.');
      return;
    }

    if (editDraft.is_required && editDraft.schedule_days.length === 0) {
      setError('Select at least one required day or make this habit optional.');
      return;
    }

    let thresholds = {
      partial_threshold: null,
      full_threshold: null,
    };
    if (habit.habit_type === 'number') {
      try {
        thresholds = parseNumericThresholds(
          editDraft.partial_threshold,
          editDraft.full_threshold
        );
      } catch (thresholdError) {
        setError(thresholdError.message);
        return;
      }
    }

    const updatedHabit = {
      ...habit,
      name,
      unit:
        habit.habit_type === 'number' && editDraft.unit.trim()
          ? editDraft.unit.trim()
          : null,
      ...thresholds,
      is_required: editDraft.is_required,
      schedule_days: editDraft.schedule_days,
    };
    setSaving((current) => ({ ...current, [habit.id]: true }));

    try {
      const { error } = await supabase
        .from('habits')
        .update({
          name: updatedHabit.name,
          unit: updatedHabit.unit,
          partial_threshold: updatedHabit.partial_threshold,
          full_threshold: updatedHabit.full_threshold,
          schedule_days: updatedHabit.schedule_days,
          is_required: updatedHabit.is_required,
        })
        .eq('id', habit.id)
        .eq('user_id', user.id);

      if (error) throw error;

      const updatedHabits = habits.map((item) =>
        item.id === habit.id ? updatedHabit : item
      );
      setHabits(updatedHabits);
      const updatedSettings = {
        ...savedSettings,
        [habit.id]: {
          schedule_days: updatedHabit.schedule_days,
          is_required: updatedHabit.is_required,
        },
      };
      setSavedSettings(updatedSettings);
      setEditingHabitId(null);
      setEditDraft(null);

      try {
        await saveTodaySchedule(
          updatedHabits.map((item) => ({
            ...item,
            ...(updatedSettings[item.id] || {}),
          }))
        );
      } catch (snapshotError) {
        throw new Error(
          `Habit saved, but today's schedule snapshot could not be updated: ${snapshotError.message}`
        );
      }

      setMessage(`${updatedHabit.name} updated.`);
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setSaving((current) => ({ ...current, [habit.id]: false }));
    }
  }

  async function addHabit(event) {
    event.preventDefault();
    setError('');
    setMessage('');

    const name = newHabit.name.trim();
    if (!name) {
      setError('Enter a habit name.');
      return;
    }

    if (habits.some((habit) => habit.name.toLowerCase() === name.toLowerCase())) {
      setError('A habit with that name already exists.');
      return;
    }

    if (newHabit.is_required && newHabit.schedule_days.length === 0) {
      setError('Select at least one required day or make this habit optional.');
      return;
    }

    let thresholds = {
      partial_threshold: null,
      full_threshold: null,
    };
    if (newHabit.habit_type === 'number') {
      try {
        thresholds = parseNumericThresholds(
          newHabit.partial_threshold,
          newHabit.full_threshold
        );
      } catch (thresholdError) {
        setError(thresholdError.message);
        return;
      }
    }

    setSaving((current) => ({ ...current, new: true }));

    try {
      const position = Math.max(
        -1,
        ...habits.map((habit) => habit.position ?? -1)
      ) + 1;
      const { data: createdHabit, error: insertError } = await supabase
        .from('habits')
        .insert({
          user_id: user.id,
          name,
          habit_type: newHabit.habit_type,
          unit:
            newHabit.habit_type === 'number' && newHabit.unit.trim()
              ? newHabit.unit.trim()
              : null,
          ...thresholds,
          is_required: newHabit.is_required,
          schedule_days: newHabit.schedule_days,
          position,
          is_active: true,
        })
        .select('*')
        .single();

      if (insertError) throw insertError;
      if (!createdHabit) {
        throw new Error('The habit was created but could not be loaded.');
      }

      const normalizedHabit = {
        ...createdHabit,
        schedule_days: createdHabit.schedule_days || [],
        is_required: createdHabit.is_required !== false,
      };
      setHabits((current) =>
        [...current, normalizedHabit].sort(
          (first, second) => first.position - second.position
        )
      );
      setSavedSettings((current) => ({
        ...current,
        [normalizedHabit.id]: {
          schedule_days: normalizedHabit.schedule_days,
          is_required: normalizedHabit.is_required,
        },
      }));
      setNewHabit(createNewHabitDraft());

      try {
        await saveTodaySchedule([
          ...getSavedHabits(),
          normalizedHabit,
        ]);
      } catch (snapshotError) {
        throw new Error(
          `Habit added, but today's schedule snapshot could not be updated: ${snapshotError.message}`
        );
      }

      setMessage(`${name} added.`);
    } catch (addError) {
      setError(addError.message);
    } finally {
      setSaving((current) => ({ ...current, new: false }));
    }
  }

  async function archiveHabit(habit) {
    if (
      !window.confirm(
        `Remove ${habit.name} from your active habits? Past entries and history will be preserved.`
      )
    ) {
      return;
    }

    setError('');
    setMessage('');
    setSaving((current) => ({ ...current, [habit.id]: true }));

    try {
      const { error: archiveError } = await supabase
        .from('habits')
        .update({ is_active: false })
        .eq('id', habit.id)
        .eq('user_id', user.id);

      if (archiveError) throw archiveError;

      const remainingHabits = habits.filter((item) => item.id !== habit.id);
      setHabits(remainingHabits);
      if (editingHabitId === habit.id) {
        setEditingHabitId(null);
        setEditDraft(null);
      }

      const remainingSavedSettings = { ...savedSettings };
      delete remainingSavedSettings[habit.id];
      setSavedSettings(remainingSavedSettings);

      try {
        await saveTodaySchedule(
          remainingHabits.map((item) => ({
            ...item,
            ...(remainingSavedSettings[item.id] || {}),
          }))
        );
      } catch (snapshotError) {
        throw new Error(
          `Habit removed, but today's schedule snapshot could not be updated: ${snapshotError.message}`
        );
      }

      setMessage(
        `${habit.name} removed from your active routine. Past history is preserved.`
      );
    } catch (archiveError) {
      setError(archiveError.message);
    } finally {
      setSaving((current) => ({ ...current, [habit.id]: false }));
    }
  }

  function toggleNewHabitDay(day) {
    setNewHabit((current) => {
      const schedule_days = current.schedule_days.includes(day)
        ? current.schedule_days.filter((value) => value !== day)
        : [...current.schedule_days, day].sort((first, second) => first - second);

      return { ...current, schedule_days };
    });
  }

  return (
    <main className="dashboard-shell">
      <header className="dashboard-header">
        <div className="dashboard-brand">
          <div className="brand-mark small-mark">H</div>
          <span>HABIT TRACKER</span>
        </div>

        <button className="sign-out-button" onClick={onBack}>
          ← Dashboard
        </button>
      </header>

      <div className="dashboard-content">
        <p className="eyebrow">PERSONALIZE YOUR ROUTINE</p>
        <h1>Settings</h1>
        <p className="dashboard-subtitle">
          Add, remove, and schedule the habits in your routine.
        </p>

        {error && <p className="feedback error">{error}</p>}
        {message && <p className="feedback success">{message}</p>}

        {loading ? (
          <p className="loading-text">Loading your settings...</p>
        ) : (
          <>
            <section className="settings-card habit-create-card">
              <div className="settings-card-heading">
                <div>
                  <h2>Add a habit</h2>
                  <p>Set its entry type, schedule, and requirement.</p>
                </div>
              </div>

              <form className="habit-create-form" onSubmit={addHabit}>
                <div className="habit-create-fields">
                  <label>
                    Habit name
                    <input
                      className="settings-input"
                      value={newHabit.name}
                      onChange={(event) =>
                        setNewHabit((current) => ({
                          ...current,
                          name: event.target.value,
                        }))
                      }
                      maxLength={60}
                      required
                    />
                  </label>

                  <label>
                    Entry type
                    <select
                      className="settings-input"
                      value={newHabit.habit_type}
                      onChange={(event) =>
                        setNewHabit((current) => ({
                          ...current,
                          habit_type: event.target.value,
                          unit:
                            event.target.value === 'number' ? current.unit : '',
                        }))
                      }
                    >
                      <option value="boolean">Yes / no</option>
                      <option value="number">Numeric value</option>
                    </select>
                  </label>

                  {newHabit.habit_type === 'number' && (
                    <>
                      <label>
                        Unit (optional)
                        <input
                          className="settings-input"
                          value={newHabit.unit}
                          onChange={(event) =>
                            setNewHabit((current) => ({
                              ...current,
                              unit: event.target.value,
                            }))
                          }
                          maxLength={20}
                        />
                      </label>
                      <label>
                        Value for 0.5 points
                        <input
                          className="settings-input"
                          type="number"
                          min="0"
                          step="any"
                          value={newHabit.partial_threshold}
                          onChange={(event) =>
                            setNewHabit((current) => ({
                              ...current,
                              partial_threshold: event.target.value,
                            }))
                          }
                          required
                        />
                      </label>
                      <label>
                        Value for 1 point
                        <input
                          className="settings-input"
                          type="number"
                          min="0"
                          step="any"
                          value={newHabit.full_threshold}
                          onChange={(event) =>
                            setNewHabit((current) => ({
                              ...current,
                              full_threshold: event.target.value,
                            }))
                          }
                          required
                        />
                      </label>
                    </>
                  )}
                </div>

                <label className="habit-requirement-control">
                  <input
                    type="checkbox"
                    checked={newHabit.is_required}
                    onChange={(event) =>
                      setNewHabit((current) => ({
                        ...current,
                        is_required: event.target.checked,
                      }))
                    }
                  />
                  Count toward completion on scheduled days
                </label>

                <div
                  className="weekday-picker"
                  role="group"
                  aria-label="Habit schedule"
                >
                  {weekdays.map((day) => {
                    const selected = newHabit.schedule_days.includes(day.value);

                    return (
                      <button
                        type="button"
                        key={day.value}
                        className={`weekday-button ${
                          selected ? 'selected' : ''
                        }`}
                        onClick={() => toggleNewHabitDay(day.value)}
                        aria-pressed={selected}
                        aria-label={`${day.label}${selected ? ', scheduled' : ', not scheduled'}`}
                      >
                        {day.label}
                      </button>
                    );
                  })}
                </div>

                <div className="settings-card-footer">
                  <span>{newHabit.schedule_days.length} of 7 days scheduled</span>
                  <button
                    type="button"
                    onClick={() =>
                      setNewHabit((current) => ({
                        ...current,
                        schedule_days: [],
                      }))
                    }
                  >
                    Clear schedule
                  </button>
                </div>

                <button
                  className="save-schedule-button habit-add-button"
                  type="submit"
                  disabled={saving.new}
                >
                  {saving.new ? 'Adding...' : 'Add habit'}
                </button>
              </form>
            </section>

            <section className="settings-list">
              {habits.map((habit) => {
                const scheduleDays = habit.schedule_days || [];
                const hasThresholds =
                  habit.partial_threshold !== null &&
                  habit.partial_threshold !== undefined &&
                  habit.full_threshold !== null &&
                  habit.full_threshold !== undefined;

                return (
                  <article className="settings-card" key={habit.id}>
                    <div className="settings-card-heading">
                      <div>
                        <h2>{habit.name}</h2>
                        <p>{`${
                          habit.is_required
                            ? 'Required on schedule'
                            : scheduleDays.length
                              ? 'Optional on schedule'
                              : 'Optional every day'
                        } · ${
                          habit.habit_type === 'number'
                            ? habit.unit || 'Numeric'
                            : 'Yes / no'
                        }`}</p>
                      </div>

                      <div className="settings-card-actions">
                        <button
                          className="edit-habit-button"
                          type="button"
                          onClick={() => startEditing(habit)}
                          disabled={
                            saving[habit.id] ||
                            (editingHabitId !== null &&
                              editingHabitId !== habit.id)
                          }
                        >
                          Edit
                        </button>
                        <button
                          className="remove-habit-button"
                          type="button"
                          onClick={() => archiveHabit(habit)}
                          disabled={saving[habit.id]}
                        >
                          Remove
                        </button>
                      </div>
                    </div>

                    {editingHabitId === habit.id && editDraft ? (
                      <form
                        className="habit-edit-form"
                        onSubmit={(event) => {
                          event.preventDefault();
                          saveHabitEdit(habit);
                        }}
                      >
                        <div className="habit-edit-fields">
                          <label>
                            Habit name
                            <input
                              className="settings-input"
                              value={editDraft.name}
                              onChange={(event) =>
                                setEditDraft((current) => ({
                                  ...current,
                                  name: event.target.value,
                                }))
                              }
                              maxLength={60}
                              required
                            />
                          </label>
                          {habit.habit_type === 'number' && (
                            <>
                              <label>
                                Unit (optional)
                                <input
                                  className="settings-input"
                                  value={editDraft.unit}
                                  onChange={(event) =>
                                    setEditDraft((current) => ({
                                      ...current,
                                      unit: event.target.value,
                                    }))
                                  }
                                  maxLength={20}
                                />
                              </label>
                              <label>
                                Value for 0.5 points
                                <input
                                  className="settings-input"
                                  type="number"
                                  min="0"
                                  step="any"
                                  value={editDraft.partial_threshold}
                                  onChange={(event) =>
                                    setEditDraft((current) => ({
                                      ...current,
                                      partial_threshold: event.target.value,
                                    }))
                                  }
                                  required
                                />
                              </label>
                              <label>
                                Value for 1 point
                                <input
                                  className="settings-input"
                                  type="number"
                                  min="0"
                                  step="any"
                                  value={editDraft.full_threshold}
                                  onChange={(event) =>
                                    setEditDraft((current) => ({
                                      ...current,
                                      full_threshold: event.target.value,
                                    }))
                                  }
                                  required
                                />
                              </label>
                            </>
                          )}
                        </div>

                        <label className="habit-requirement-control">
                          <input
                            type="checkbox"
                            checked={editDraft.is_required}
                            onChange={(event) =>
                              setEditDraft((current) => ({
                                ...current,
                                is_required: event.target.checked,
                              }))
                            }
                          />
                          Count toward completion on scheduled days
                        </label>

                        <div
                          className="weekday-picker"
                          role="group"
                          aria-label={`${habit.name} schedule`}
                        >
                          {weekdays.map((day) => {
                            const selected =
                              editDraft.schedule_days.includes(day.value);

                            return (
                              <button
                                type="button"
                                key={day.value}
                                className={`weekday-button ${
                                  selected ? 'selected' : ''
                                }`}
                                onClick={() =>
                                  setEditDraft((current) => ({
                                    ...current,
                                    schedule_days: current.schedule_days.includes(
                                      day.value
                                    )
                                      ? current.schedule_days.filter(
                                          (value) => value !== day.value
                                        )
                                      : [
                                          ...current.schedule_days,
                                          day.value,
                                        ].sort((first, second) => first - second),
                                  }))
                                }
                                aria-pressed={selected}
                              >
                                {day.label}
                              </button>
                            );
                          })}
                        </div>

                        <div className="settings-card-footer">
                          <span>
                            {editDraft.schedule_days.length} of 7 days scheduled
                          </span>
                          <div>
                            <button
                              type="button"
                              onClick={() =>
                                setEditDraft((current) => ({
                                  ...current,
                                  schedule_days: [],
                                }))
                              }
                            >
                              Clear schedule
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                setEditDraft((current) => ({
                                  ...current,
                                  schedule_days: [0, 1, 2, 3, 4, 5, 6],
                                }))
                              }
                            >
                              Every day
                            </button>
                          </div>
                        </div>

                        <div className="settings-form-actions">
                          <button
                            className="edit-habit-button"
                            type="button"
                            onClick={() => {
                              setEditingHabitId(null);
                              setEditDraft(null);
                              setError('');
                            }}
                          >
                            Cancel
                          </button>
                          <button
                            className="save-schedule-button"
                            type="submit"
                            disabled={saving[habit.id]}
                          >
                            {saving[habit.id] ? 'Saving...' : 'Save changes'}
                          </button>
                        </div>
                      </form>
                    ) : (
                      <div className="habit-settings-summary">
                        <span>{scheduleDays.length} of 7 days scheduled</span>
                        {habit.habit_type === 'number' &&
                          (hasThresholds ? (
                            <span>
                              0.5 points at {habit.partial_threshold} · 1 point at{' '}
                              {habit.full_threshold}
                            </span>
                          ) : (
                            <span className="habit-threshold-warning">
                              Numeric thresholds need to be set in Edit.
                            </span>
                          ))}
                      </div>
                    )}
                  </article>
                );
              })}
            </section>
          </>
        )}

        <section className="settings-info">
          <h2>Habit settings</h2>
          <p>
            Habits are shown every day. Selected weekdays mark their schedule;
            only required habits count toward completion on those days. Removing
            a habit archives it and preserves its past entries and history.
            Numeric values at or above the 0.5 threshold earn half a point;
            values at or above the full threshold earn one point.
          </p>
        </section>
      </div>
    </main>
  );
}