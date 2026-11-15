import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { saveScheduleSnapshot } from '../lib/scheduleSnapshots';

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

export default function Settings({ user, onBack }) {
  const [habits, setHabits] = useState([]);
  const [savedScheduleDays, setSavedScheduleDays] = useState({});
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
        const loadedHabits = data || [];
        setHabits(loadedHabits);
        setSavedScheduleDays(
          Object.fromEntries(
            loadedHabits.map((habit) => [
              habit.id,
              habit.schedule_days || [],
            ])
          )
        );
      }

      setLoading(false);
    }

    loadHabits();
  }, [user.id]);

  function toggleDay(habitId, day) {
    setHabits((current) =>
      current.map((habit) => {
        if (habit.id !== habitId) return habit;

        const currentDays = habit.schedule_days || [];
        const updatedDays = currentDays.includes(day)
          ? currentDays.filter((value) => value !== day)
          : [...currentDays, day];

        return {
          ...habit,
          schedule_days: updatedDays.sort((a, b) => a - b),
        };
      })
    );

    setMessage('');
  }

  async function saveSchedule(habit) {
    setError('');
    setMessage('');

    setSaving((current) => ({ ...current, [habit.id]: true }));

    try {
      const { error } = await supabase
        .from('habits')
        .update({ schedule_days: habit.schedule_days })
        .eq('id', habit.id)
        .eq('user_id', user.id);

      if (error) throw error;

      const updatedScheduleDays = {
        ...savedScheduleDays,
        [habit.id]: habit.schedule_days,
      };
      setSavedScheduleDays(updatedScheduleDays);

      const today = getLocalDate();
      const todayDay = getDayOfWeek(today);
      const requiredHabitIds = habits
        .filter((item) =>
          (updatedScheduleDays[item.id] || item.schedule_days || []).includes(
            todayDay
          )
        )
        .map((item) => item.id);

      try {
        await saveScheduleSnapshot(user.id, today, requiredHabitIds);
      } catch (snapshotError) {
        throw new Error(
          `Schedule saved, but today's snapshot could not be updated: ${snapshotError.message}`
        );
      }

      setMessage(`${habit.name} schedule saved.`);
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setSaving((current) => ({ ...current, [habit.id]: false }));
    }
  }

  function resetSchedule(habit) {
    setHabits((current) =>
      current.map((item) =>
        item.id === habit.id
          ? { ...item, schedule_days: [0, 1, 2, 3, 4, 5, 6] }
          : item
      )
    );
    setMessage('');
  }

  const scheduledHabits = habits.filter((habit) =>
    ['Upper', 'Lower', 'Other', 'TLDR'].includes(habit.name)
  );

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
          Choose which days your scheduled habits are required.
        </p>

        {error && <p className="feedback error">{error}</p>}
        {message && <p className="feedback success">{message}</p>}

        {loading ? (
          <p className="loading-text">Loading your settings...</p>
        ) : (
          <section className="settings-list">
            {scheduledHabits.map((habit) => (
              <article className="settings-card" key={habit.id}>
                <div className="settings-card-heading">
                  <div>
                    <h2>{habit.name}</h2>
                    <p>
                      {habit.name === 'TLDR'
                        ? 'Required on weekdays'
                        : 'Choose your workout days'}
                    </p>
                  </div>

                  <button
                    className="save-schedule-button"
                    onClick={() => saveSchedule(habit)}
                    disabled={saving[habit.id]}
                  >
                    {saving[habit.id] ? 'Saving...' : 'Save'}
                  </button>
                </div>

                <div className="weekday-picker">
                  {weekdays.map((day) => {
                    const selected = (
                      habit.schedule_days || []
                    ).includes(day.value);

                    return (
                      <button
                        key={day.value}
                        className={`weekday-button ${
                          selected ? 'selected' : ''
                        }`}
                        onClick={() => toggleDay(habit.id, day.value)}
                        aria-pressed={selected}
                      >
                        {day.label}
                      </button>
                    );
                  })}
                </div>

                <div className="settings-card-footer">
                  <span>
                    {(habit.schedule_days || []).length} of 7 days selected
                  </span>

                  <button onClick={() => resetSchedule(habit)}>
                    Every day
                  </button>
                </div>
              </article>
            ))}
          </section>
        )}

        <section className="settings-info">
          <h2>Daily habits</h2>
          <p>
            All other active habits are required every day. Their schedules
            aren't changed here.
          </p>
        </section>
      </div>
    </main>
  );
}