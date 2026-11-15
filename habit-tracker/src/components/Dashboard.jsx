import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { getOrCreateScheduleSnapshot } from '../lib/scheduleSnapshots';

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

function formatDate(dateString) {
  const [year, month, day] = dateString.split('-').map(Number);

  return new Date(year, month - 1, day).toLocaleDateString('en-CA', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

export default function Dashboard({
  user,
  onSignOut,
  onOpenSettings,
  onOpenHistory,
}) {
  const [habits, setHabits] = useState([]);
  const [requiredHabitIds, setRequiredHabitIds] = useState([]);
  const [entries, setEntries] = useState({});
  const [selectedDate, setSelectedDate] = useState(getLocalDate());
  const [view, setView] = useState('full');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState({});
  const [error, setError] = useState('');

  // Load habits and entries whenever the selected date changes.
  useEffect(() => {
    async function loadDashboard() {
      setLoading(true);
      setError('');

      const { data: habitData, error: habitError } = await supabase
        .from('habits')
        .select('*')
        .eq('user_id', user.id)
        .eq('is_active', true)
        .order('position');

      if (habitError) {
        setError(habitError.message);
        setLoading(false);
        return;
      }

      const { data: entryData, error: entryError } = await supabase
        .from('habit_entries')
        .select('*')
        .eq('user_id', user.id)
        .eq('entry_date', selectedDate);

      if (entryError) {
        setError(entryError.message);
        setLoading(false);
        return;
      }

      let scheduleHabitIds;

      try {
        const selectedDay = getDayOfWeek(selectedDate);
        const scheduledHabitIds = habitData
          .filter((habit) => habit.schedule_days.includes(selectedDay))
          .map((habit) => habit.id);

        scheduleHabitIds = await getOrCreateScheduleSnapshot(
          user.id,
          selectedDate,
          scheduledHabitIds
        );
      } catch (snapshotError) {
        setError(snapshotError.message);
        setLoading(false);
        return;
      }

      const entryMap = {};

      entryData.forEach((entry) => {
        entryMap[entry.habit_id] =
          entry.boolean_value !== null
            ? entry.boolean_value
            : entry.number_value;
      });

      setHabits(habitData);
      setRequiredHabitIds(scheduleHabitIds);
      setEntries(entryMap);
      setLoading(false);
    }

    loadDashboard();
  }, [user.id, selectedDate]);

  const requiredHabitIdSet = useMemo(
    () => new Set(requiredHabitIds),
    [requiredHabitIds]
  );
  const requiredHabits = habits.filter((habit) =>
    requiredHabitIdSet.has(habit.id)
  );

  const optionalHabits = habits.filter(
    (habit) => !requiredHabitIdSet.has(habit.id)
  );

  const completedCount = requiredHabits.filter((habit) => {
  const value = entries[habit.id];

  if (habit.habit_type === 'boolean') {
    return value === true;
  }

  return value !== undefined && value !== null && value !== '';
  }).length;

  const progress = requiredHabits.length
    ? Math.round((completedCount / requiredHabits.length) * 100)
    : 0;

  async function saveEntry(habit, rawValue) {
    setError('');
    setSaving((current) => ({ ...current, [habit.id]: true }));

    try {
      // A blank numeric field means the habit is not logged.
      if (habit.habit_type === 'number' && rawValue === '') {
        const { error: deleteError } = await supabase
          .from('habit_entries')
          .delete()
          .eq('user_id', user.id)
          .eq('habit_id', habit.id)
          .eq('entry_date', selectedDate);

        if (deleteError) throw deleteError;

        setEntries((current) => {
          const updated = { ...current };
          delete updated[habit.id];
          return updated;
        });

        return;
      }

      const entry =
        habit.habit_type === 'boolean'
          ? {
              user_id: user.id,
              habit_id: habit.id,
              entry_date: selectedDate,
              boolean_value: rawValue,
              number_value: null,
            }
          : {
              user_id: user.id,
              habit_id: habit.id,
              entry_date: selectedDate,
              boolean_value: null,
              number_value: Number(rawValue),
            };

      if (
        habit.habit_type === 'number' &&
        !Number.isFinite(entry.number_value)
      ) {
        throw new Error('Please enter a valid number.');
      }

      const { error: saveError } = await supabase
        .from('habit_entries')
        .upsert(entry, { onConflict: 'habit_id,entry_date' });

      if (saveError) throw saveError;

      setEntries((current) => ({
        ...current,
        [habit.id]: rawValue,
      }));
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving((current) => ({ ...current, [habit.id]: false }));
    }
  }

  function changeDate(days) {
    const [year, month, day] = selectedDate.split('-').map(Number);
    const date = new Date(year, month - 1, day);
    date.setDate(date.getDate() + days);

    const nextDate = [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0'),
    ].join('-');

    setSelectedDate(nextDate);
  }

  return (
    <main className="dashboard-shell">
      <header className="dashboard-header">
        <div className="dashboard-brand">
          <div className="brand-mark small-mark">H</div>
          <span>HABIT TRACKER</span>
        </div>

        <div className="header-actions">
          <button className="sign-out-button" onClick={onOpenHistory}>
            History
          </button>

          <button className="sign-out-button" onClick={onOpenSettings}>
            Settings
          </button>

          <button className="sign-out-button" onClick={onSignOut}>
            Sign out
          </button>
        </div>
      </header>

      <div className="dashboard-content">

        <section className="date-navigation">
          <button onClick={() => changeDate(-1)} aria-label="Previous day">
            ‹
          </button>

          <div className="date-display">
            <strong>{formatDate(selectedDate)}</strong>
            {selectedDate === getLocalDate() && (
              <span className="today-label">TODAY</span>
            )}
          </div>

          <button
            onClick={() => changeDate(1)}
            disabled={selectedDate >= getLocalDate()}
            aria-label="Next day"
          >
            ›
          </button>

          <input
            className="date-input"
            type="date"
            value={selectedDate}
            max={getLocalDate()}
            onChange={(event) => setSelectedDate(event.target.value)}
            aria-label="Choose a date"
          />
        </section>

        <section className="progress-card">
          <div className="progress-top">
            <div>
              <p className="eyebrow">DAILY PROGRESS</p>
              <h2>
                {completedCount}
                <span> / {requiredHabits.length}</span>
              </h2>
            </div>

            <strong className="progress-percent">{progress}%</strong>
          </div>

          <div className="progress-track">
            <div
              className="progress-fill"
              style={{ width: `${progress}%` }}
            />
          </div>

          <p className="progress-caption">
            {completedCount === requiredHabits.length
              ? 'All required habits completed. Great work.'
              : `${requiredHabits.length - completedCount} required habits left`}
          </p>
        </section>

        <div className="habit-section-heading">
          <div>
            <p className="eyebrow">YOUR ROUTINE</p>
            <h2>Daily habits</h2>
          </div>

          <div className="view-switch">
            <button
              className={view === 'full' ? 'selected' : ''}
              onClick={() => setView('full')}
            >
              Full
            </button>
            <button
              className={view === 'quick' ? 'selected' : ''}
              onClick={() => setView('quick')}
            >
              Quick entry
            </button>
          </div>
        </div>

        {error && <p className="feedback error dashboard-error">{error}</p>}

        {loading ? (
          <p className="loading-text">Loading your habits...</p>
        ) : habits.length === 0 ? (
          <p className="empty-message">
            No active habits found. You can add habits in Settings later.
          </p>
        ) : (
          <section className={`habit-list ${view}`}>
            {[...requiredHabits, ...optionalHabits].map((habit) => {
            const isDueToday = requiredHabits.some(
              (requiredHabit) => requiredHabit.id === habit.id
            );
              const value = entries[habit.id];
              const isCompleted =
                habit.habit_type === 'boolean' && value === true;

              return (
                <article
                  className={`habit-row ${isCompleted ? 'completed' : ''} ${
                    !isDueToday ? 'optional-habit' : ''
                  }`}
                  key={habit.id}
                >
                  <div className="habit-information">
                    <span className="habit-name">{habit.name}</span>
                    <span className="schedule-status">
                      {isDueToday ? 'Required today' : 'Optional today'}
                    </span>
                    {view === 'full' && (
                      <span className="habit-type">
                        {habit.habit_type === 'number'
                          ? habit.unit || 'Numeric entry'
                          : 'Daily habit'}
                      </span>
                    )}
                  </div>

                  {habit.habit_type === 'boolean' ? (
                    <button
                      className={`habit-toggle ${isCompleted ? 'active' : ''}`}
                      onClick={() => saveEntry(habit, value === true ? false : true)}
                      disabled={saving[habit.id]}
                      aria-label={`Mark ${habit.name} ${
                        isCompleted ? 'incomplete' : 'complete'
                      }`}
                    >
                      {saving[habit.id]
                        ? '...'
                        : isCompleted
                          ? 'Done ✓'
                          : 'Mark done'}
                    </button>
                  ) : (
                    <div className="numeric-entry">
                      <input
                        type="number"
                        min="0"
                        step="0.1"
                        placeholder="—"
                        value={value ?? ''}
                        onChange={(event) =>
                          setEntries((current) => ({
                            ...current,
                            [habit.id]: event.target.value,
                          }))
                        }
                        onBlur={(event) =>
                          saveEntry(habit, event.target.value)
                        }
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            event.currentTarget.blur();
                          }
                        }}
                        aria-label={`${habit.name} value`}
                      />
                      {habit.unit && <span>{habit.unit}</span>}
                      {saving[habit.id] && (
                        <span className="saving-label">Saving</span>
                      )}
                    </div>
                  )}
                </article>
              );
            })}
          </section>
        )}

        <p className="dashboard-footnote">
          Your changes save automatically. Numeric entries save when you leave
          the field.
        </p>
      </div>
    </main>
  );
}