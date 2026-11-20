import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { getHabitCompletionScore } from '../lib/habitScoring';

const rangeOptions = [
  { value: 'week', label: 'Last 7 days' },
  { value: 'month', label: 'Last 30 days' },
  { value: 'selectedMonth', label: 'Selected calendar month' },
  { value: 'year', label: 'This year' },
];

const pageSize = 1000;

function getLocalDate() {
  const now = new Date();
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('-');
}

function parseLocalDate(dateString) {
  const [year, month, day] = dateString.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function formatLocalDate(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

function addDays(dateString, days) {
  const date = parseLocalDate(dateString);
  date.setDate(date.getDate() + days);
  return formatLocalDate(date);
}

function getPeriodRange(range, today, calendarMonth) {
  const todayDate = parseLocalDate(today);

  if (range === 'week') {
    return { start: addDays(today, -6), end: today };
  }

  if (range === 'month') {
    return { start: addDays(today, -29), end: today };
  }

  if (range === 'selectedMonth') {
    return getMonthRange(calendarMonth, today);
  }

  return {
    start: `${todayDate.getFullYear()}-01-01`,
    end: today,
  };
}

function getMonthRange(monthString, today) {
  const monthStart = `${monthString.slice(0, 7)}-01`;
  const firstDay = parseLocalDate(monthStart);
  const lastDay = new Date(firstDay.getFullYear(), firstDay.getMonth() + 1, 0);
  const monthEnd = formatLocalDate(lastDay);

  return {
    start: monthStart,
    end: monthEnd > today ? today : monthEnd,
  };
}

function getDateRanges(ranges) {
  const sorted = [...ranges].sort((first, second) =>
    first.start.localeCompare(second.start)
  );
  const merged = [];

  sorted.forEach((range) => {
    const previous = merged[merged.length - 1];

    if (previous && range.start <= addDays(previous.end, 1)) {
      if (range.end > previous.end) previous.end = range.end;
    } else {
      merged.push({ ...range });
    }
  });

  return merged;
}

async function fetchRowsInRange(
  table,
  dateColumn,
  columns,
  userId,
  range,
  secondaryOrderColumn
) {
  const rows = [];
  let offset = 0;

  while (true) {
    let request = supabase
      .from(table)
      .select(columns)
      .eq('user_id', userId)
      .gte(dateColumn, range.start)
      .lte(dateColumn, range.end)
      .order(dateColumn);

    if (secondaryOrderColumn) {
      request = request.order(secondaryOrderColumn);
    }

    const { data, error } = await request.range(
      offset,
      offset + pageSize - 1
    );

    if (error) throw error;

    rows.push(...data);
    if (data.length < pageSize) return rows;
    offset += data.length;
  }
}

async function fetchHistoryData(userId, ranges) {
  const [habitResult, results] = await Promise.all([
    supabase
      .from('habits')
      .select(
        'id,name,habit_type,unit,position,partial_threshold,full_threshold'
      )
      .eq('user_id', userId)
      .order('position'),
    Promise.all(
      getDateRanges(ranges).map(async (range) => {
        const [snapshots, entries] = await Promise.all([
          fetchRowsInRange(
            'habit_schedule_snapshots',
            'snapshot_date',
            'snapshot_date,required_habit_ids',
            userId,
            range
          ),
          fetchRowsInRange(
            'habit_entries',
            'entry_date',
            'entry_date,habit_id,boolean_value,number_value',
            userId,
            range,
            'habit_id'
          ),
        ]);

        return { snapshots, entries };
      })
    ),
  ]);

  if (habitResult.error) throw habitResult.error;

  const history = results.reduce(
    (history, result) => ({
      snapshots: [...history.snapshots, ...result.snapshots],
      entries: [...history.entries, ...result.entries],
    }),
    { snapshots: [], entries: [] }
  );

  if (
    history.snapshots.some(
      (snapshot) => !Array.isArray(snapshot.required_habit_ids)
    )
  ) {
    throw new Error('A saved schedule snapshot has an invalid format.');
  }

  return { ...history, habits: habitResult.data };
}

function getDailyRecords(start, end, snapshots, entries, habits) {
  const records = [];

  for (let date = start; date <= end; date = addDays(date, 1)) {
    const snapshot = snapshots.get(date);

    if (!snapshot) {
      records.push({
        date,
        completionPercent: null,
        fullyCompleted: false,
        hasSnapshot: false,
      });
      continue;
    }

    const requiredHabitIds = snapshot.required_habit_ids;
    if (requiredHabitIds.length === 0) {
      records.push({
        date,
        completionPercent: null,
        fullyCompleted: false,
        hasSnapshot: true,
      });
      continue;
    }

    const completionScore = requiredHabitIds.reduce((total, habitId) => {
      const entry = entries.get(`${date}:${habitId}`);
      const habit =
        habits.get(habitId) || {
          name: '',
          habit_type:
            entry && entry.boolean_value === null ? 'number' : 'boolean',
        };
      const value = entry
        ? entry.boolean_value !== null
          ? entry.boolean_value
          : entry.number_value
        : undefined;

      return (
        total + getHabitCompletionScore(habit, value)
      );
    }, 0);

    records.push({
      date,
      completionPercent: Math.round(
        (completionScore / requiredHabitIds.length) * 100
      ),
      fullyCompleted: completionScore === requiredHabitIds.length,
      hasSnapshot: true,
    });
  }

  return records;
}

function getHabitStatistics(start, end, snapshots, entries, habits) {
  const statistics = new Map();

  for (let date = start; date <= end; date = addDays(date, 1)) {
    const snapshot = snapshots.get(date);
    if (!snapshot) continue;

    snapshot.required_habit_ids.forEach((habitId) => {
      const habit = habits.get(habitId);
      if (!habit) return;

      const entry = entries.get(`${date}:${habitId}`);
      const value = entry
        ? entry.boolean_value !== null
          ? entry.boolean_value
          : entry.number_value
        : undefined;
      const score = getHabitCompletionScore(habit, value);
      let stat = statistics.get(habitId);

      if (!stat) {
        stat = {
          habit,
          requiredDays: 0,
          scoreTotal: 0,
          fullyCompletedDays: 0,
          partialCreditDays: 0,
          numericValueTotal: 0,
          numericValueDays: 0,
        };
        statistics.set(habitId, stat);
      }

      stat.requiredDays += 1;
      stat.scoreTotal += score;
      if (score === 1) stat.fullyCompletedDays += 1;
      if (score === 0.5) stat.partialCreditDays += 1;

      if (
        habit.habit_type === 'number' &&
        entry?.number_value !== null &&
        entry?.number_value !== undefined
      ) {
        stat.numericValueTotal += Number(entry.number_value);
        stat.numericValueDays += 1;
      }
    });
  }

  return [...statistics.values()]
    .map((stat) => ({
      ...stat,
      completionPercent: Math.round(
        (stat.scoreTotal / stat.requiredDays) * 100
      ),
      averageNumericValue: stat.numericValueDays
        ? stat.numericValueTotal / stat.numericValueDays
        : null,
    }))
    .sort(
      (first, second) =>
        (first.habit.position ?? 0) - (second.habit.position ?? 0)
    );
}

function formatDate(dateString, options) {
  return parseLocalDate(dateString).toLocaleDateString('en-US', options);
}

function getMonthCells(monthString) {
  const firstDay = parseLocalDate(`${monthString.slice(0, 7)}-01`);
  const daysInMonth = new Date(
    firstDay.getFullYear(),
    firstDay.getMonth() + 1,
    0
  ).getDate();
  const cellCount = Math.ceil((firstDay.getDay() + daysInMonth) / 7) * 7;

  return Array.from({ length: cellCount }, (_, index) => {
    const day = index - firstDay.getDay() + 1;
    return day > 0 && day <= daysInMonth ? day : null;
  });
}

function getCompletionLevel(percentage) {
  if (percentage === 0) return 0;
  if (percentage <= 25) return 1;
  if (percentage <= 50) return 2;
  if (percentage <= 75) return 3;
  return 4;
}

function buildChartSegments(records) {
  const width = 760;
  const height = 240;
  const padding = { top: 16, right: 12, bottom: 36, left: 42 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const segments = [];
  let currentSegment = [];

  records.forEach((record, index) => {
    if (record.completionPercent === null) {
      if (currentSegment.length) segments.push(currentSegment);
      currentSegment = [];
      return;
    }

    const x =
      padding.left +
      (records.length > 1 ? (index / (records.length - 1)) * plotWidth : 0);
    const y =
      padding.top + (1 - record.completionPercent / 100) * plotHeight;
    currentSegment.push({ x, y, record });
  });

  if (currentSegment.length) segments.push(currentSegment);

  return {
    width,
    height,
    padding,
    plotWidth,
    plotHeight,
    segments,
  };
}

export default function History({
  user,
  onBack,
  onOpenSettings,
  onSignOut,
}) {
  const today = getLocalDate();
  const [range, setRange] = useState('week');
  const [calendarMonth, setCalendarMonth] = useState(`${today.slice(0, 7)}-01`);
  const [snapshots, setSnapshots] = useState([]);
  const [entries, setEntries] = useState([]);
  const [habits, setHabits] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const { start: periodStart, end: periodEnd } = getPeriodRange(
    range,
    today,
    calendarMonth
  );
  const {
    start: calendarStart,
    end: calendarEnd,
  } = getMonthRange(calendarMonth, today);

  useEffect(() => {
    let active = true;

    async function loadHistory() {
      setLoading(true);
      setError('');
      setSnapshots([]);
      setEntries([]);
      setHabits([]);

      try {
        const history = await fetchHistoryData(user.id, [
          { start: periodStart, end: periodEnd },
          { start: calendarStart, end: calendarEnd },
        ]);
        if (active) {
          setSnapshots(history.snapshots);
          setEntries(history.entries);
          setHabits(history.habits);
        }
      } catch (loadError) {
        if (active) setError(loadError.message);
      } finally {
        if (active) setLoading(false);
      }
    }

    loadHistory();

    return () => {
      active = false;
    };
  }, [user.id, range, periodStart, periodEnd, calendarStart, calendarEnd]);

  const snapshotMap = useMemo(
    () => new Map(snapshots.map((snapshot) => [snapshot.snapshot_date, snapshot])),
    [snapshots]
  );
  const entryMap = useMemo(
    () =>
      new Map(
        entries.map((entry) => [
          `${entry.entry_date}:${entry.habit_id}`,
          entry,
        ])
      ),
    [entries]
  );
  const habitMap = useMemo(
    () => new Map(habits.map((habit) => [habit.id, habit])),
    [habits]
  );
  const periodRecords = useMemo(
    () => getDailyRecords(periodStart, periodEnd, snapshotMap, entryMap, habitMap),
    [periodStart, periodEnd, snapshotMap, entryMap, habitMap]
  );
  const calendarRecords = useMemo(
    () =>
      getDailyRecords(
        calendarStart,
        calendarEnd,
        snapshotMap,
        entryMap,
        habitMap
      ),
    [calendarStart, calendarEnd, snapshotMap, entryMap, habitMap]
  );
  const habitStatistics = useMemo(
    () =>
      getHabitStatistics(
        periodStart,
        periodEnd,
        snapshotMap,
        entryMap,
        habitMap
      ),
    [periodStart, periodEnd, snapshotMap, entryMap, habitMap]
  );
  const calendarRecordMap = useMemo(
    () => new Map(calendarRecords.map((record) => [record.date, record])),
    [calendarRecords]
  );
  const recordedDays = periodRecords.filter(
    (record) => record.completionPercent !== null
  );
  const snapshotDays = periodRecords.filter((record) => record.hasSnapshot);
  const averageCompletion = recordedDays.length
    ? Math.round(
        recordedDays.reduce(
          (total, record) => total + record.completionPercent,
          0
        ) / recordedDays.length
      )
    : null;
  const completedDays = recordedDays.filter(
    (record) => record.fullyCompleted
  ).length;
  const perfectDayRate = recordedDays.length
    ? Math.round((completedDays / recordedDays.length) * 100)
    : null;
  const chart = useMemo(
    () => buildChartSegments(periodRecords),
    [periodRecords]
  );
  const monthLabel = formatDate(calendarMonth, {
    month: 'long',
    year: 'numeric',
  });
  const monthCells = getMonthCells(calendarMonth);
  const currentMonth = `${today.slice(0, 7)}-01`;

  function changeCalendarMonth(amount) {
    const current = parseLocalDate(calendarMonth);
    current.setMonth(current.getMonth() + amount);
    setCalendarMonth(`${formatLocalDate(current).slice(0, 7)}-01`);
  }

  return (
    <main className="dashboard-shell">
      <header className="dashboard-header">
        <div className="dashboard-brand">
          <div className="brand-mark small-mark">H</div>
          <span>HABIT TRACKER</span>
        </div>

        <div className="header-actions">
          <button className="sign-out-button" onClick={onBack}>
            Dashboard
          </button>
          <button className="sign-out-button" onClick={onOpenSettings}>
            Settings
          </button>
          <button className="sign-out-button" onClick={onSignOut}>
            Sign out
          </button>
        </div>
      </header>

      <div className="dashboard-content history-content">
        <p className="eyebrow">YOUR CONSISTENCY</p>
        <h1>History</h1>
        <p className="dashboard-subtitle">
          Track daily completion against the schedule saved for each date.
        </p>

        {error && <p className="feedback error">{error}</p>}

        <section className="history-panel">
          <div className="history-panel-heading">
            <div>
              <p className="eyebrow">MONTH VIEW</p>
              <h2>{monthLabel}</h2>
            </div>
            <div className="history-month-navigation">
              <button
                className="sign-out-button"
                onClick={() => changeCalendarMonth(-1)}
                aria-label="Previous month"
              >
                ‹
              </button>
              <button
                className="sign-out-button"
                onClick={() => changeCalendarMonth(1)}
                disabled={calendarMonth >= currentMonth}
                aria-label="Next month"
              >
                ›
              </button>
            </div>
          </div>

          {loading ? (
            <p className="loading-text">Loading calendar...</p>
          ) : (
            <div className="history-calendar">
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
                <span className="history-weekday" key={day}>
                  {day}
                </span>
              ))}
              {monthCells.map((day, index) => {
                if (!day) {
                  return <span className="history-calendar-blank" key={`blank-${index}`} />;
                }

                const date = `${calendarMonth.slice(0, 7)}-${String(day).padStart(2, '0')}`;
                const record = calendarRecordMap.get(date);
                const isFuture = date > today;
                const percentage = record?.completionPercent ?? null;
                const level =
                  percentage === null ? 'unknown' : `level-${getCompletionLevel(percentage)}`;
                const label =
                  percentage === null
                    ? record
                      ? 'No required habits'
                      : isFuture
                        ? 'Future date'
                        : 'No schedule snapshot'
                    : `${percentage}% complete`;

                return (
                  <div
                    key={date}
                    className={`history-calendar-day ${level} ${
                      date === today ? 'today' : ''
                    }`}
                    title={`${formatDate(date, {
                      month: 'long',
                      day: 'numeric',
                      year: 'numeric',
                    })}: ${label}`}
                    aria-label={`${date}: ${label}`}
                    role="img"
                  >
                    <span>{day}</span>
                    <strong>
                      {percentage === null ? (isFuture ? '' : '—') : `${percentage}%`}
                    </strong>
                  </div>
                );
              })}
            </div>
          )}

          <div className="history-legend">
            <span>
              <i className="history-legend-unknown" /> No snapshot
            </span>
            <span>
              <i className="history-legend-level level-0" /> 0%
            </span>
            <span>
              <i className="history-legend-level level-1" /> 1–25%
            </span>
            <span>
              <i className="history-legend-level level-2" /> 26–50%
            </span>
            <span>
              <i className="history-legend-level level-3" /> 51–75%
            </span>
            <span>
              <i className="history-legend-level level-4" /> 76–100%
            </span>
          </div>
          <p className="history-footnote">
            Only dates with a saved schedule snapshot and at least one required
            habit are included in the trend and averages. Other dates are left
            unscored.
          </p>
        </section>

        <section className="history-panel">
          <div className="history-panel-heading">
            <div>
              <p className="eyebrow">DAY BY DAY</p>
              <h2>Completion trend</h2>
            </div>
            <span>Daily completion</span>
          </div>

          {loading ? (
            <p className="loading-text">Loading your history...</p>
          ) : recordedDays.length === 0 ? (
            <p className="history-empty">
              {snapshotDays.length === 0
                ? 'No saved schedule snapshots in this range yet.'
                : 'No required habits were scheduled on the saved dates in this range.'}
            </p>
          ) : (
            <div className="history-chart-wrap">
              <svg
                className="history-chart"
                viewBox={`0 0 ${chart.width} ${chart.height}`}
                role="img"
                aria-label="Daily habit completion percentage"
              >
                {[0, 25, 50, 75, 100].map((value) => {
                  const y =
                    chart.padding.top +
                    (1 - value / 100) * chart.plotHeight;
                  return (
                    <g key={value}>
                      <line
                        x1={chart.padding.left}
                        x2={chart.width - chart.padding.right}
                        y1={y}
                        y2={y}
                        className="history-chart-grid"
                      />
                      <text
                        x={chart.padding.left - 9}
                        y={y + 4}
                        textAnchor="end"
                        className="history-chart-label"
                      >
                        {value}%
                      </text>
                    </g>
                  );
                })}
                {chart.segments.map((segment, index) => (
                  <polyline
                    key={`segment-${index}`}
                    points={segment.map(({ x, y }) => `${x},${y}`).join(' ')}
                    className="history-chart-line"
                  />
                ))}
                {chart.segments.flat().map(({ x, y, record }) => (
                  <circle
                    key={record.date}
                    cx={x}
                    cy={y}
                    r="3.5"
                    className="history-chart-point"
                  >
                    <title>
                      {formatDate(record.date, {
                        month: 'short',
                        day: 'numeric',
                      })}
                      : {record.completionPercent}%
                    </title>
                  </circle>
                ))}
                {[0, Math.floor((periodRecords.length - 1) / 2), periodRecords.length - 1]
                  .filter((index, position, indexes) => indexes.indexOf(index) === position)
                  .map((index) => {
                    const record = periodRecords[index];
                    if (!record) return null;
                    const x =
                      chart.padding.left +
                      (periodRecords.length > 1
                        ? (index / (periodRecords.length - 1)) * chart.plotWidth
                        : 0);
                    return (
                      <text
                        key={record.date}
                        x={x}
                        y={chart.height - 8}
                        textAnchor="middle"
                        className="history-chart-label"
                      >
                        {formatDate(record.date, {
                          month: 'short',
                          day: 'numeric',
                        })}
                      </text>
                    );
                  })}
              </svg>
            </div>
          )}
        </section>

        <details className="history-more">
          <summary>
            <span className="history-more-closed">View more</span>
            <span className="history-more-open">View less</span>
          </summary>
          <div className="history-more-content">
            <section className="history-range-card">
              <div>
                <label htmlFor="history-range">Showing</label>
                <select
                  id="history-range"
                  className="history-range-select"
                  value={range}
                  onChange={(event) => setRange(event.target.value)}
                >
                  {rangeOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <span className="history-range-dates">
                {formatDate(periodStart, {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                })}
                {' – '}
                {formatDate(periodEnd, {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                })}
              </span>
            </section>

            <section className="history-stats" aria-label="Completion summary">
              <article className="history-stat-card">
                <span>Average daily completion</span>
                <strong>
                  {averageCompletion === null ? '—' : `${averageCompletion}%`}
                </strong>
              </article>
              <article className="history-stat-card">
                <span>Fully completed days</span>
                <strong>
                  {recordedDays.length
                    ? `${completedDays} / ${recordedDays.length}`
                    : '—'}
                  {perfectDayRate !== null && (
                    <small>{perfectDayRate}%</small>
                  )}
                </strong>
              </article>
              <article className="history-stat-card">
                <span>Days with a schedule snapshot</span>
                <strong>{snapshotDays.length}</strong>
              </article>
            </section>

            <section className="history-panel">
              <div className="history-panel-heading">
                <div>
                  <p className="eyebrow">INDIVIDUAL HABITS</p>
                  <h2>Habit breakdown</h2>
                </div>
                <span>Selected date range</span>
              </div>

              {loading ? (
                <p className="loading-text">Loading habit statistics...</p>
              ) : habitStatistics.length === 0 ? (
                <p className="history-empty">
                  No required habit snapshots in this range yet.
                </p>
              ) : (
                <div className="habit-stat-list">
                  {habitStatistics.map((stat) => (
                    <article className="habit-stat-card" key={stat.habit.id}>
                      <div className="habit-stat-heading">
                        <div>
                          <h3>{stat.habit.name}</h3>
                          <span>
                            {stat.fullyCompletedDays} of {stat.requiredDays} days
                            fully complete
                            {stat.partialCreditDays > 0 &&
                              ` · ${stat.partialCreditDays} partial`}
                          </span>
                        </div>
                        <strong>{stat.completionPercent}%</strong>
                      </div>

                      <div className="progress-track">
                        <div
                          className="progress-fill"
                          style={{ width: `${stat.completionPercent}%` }}
                        />
                      </div>

                      {stat.averageNumericValue !== null && (
                        <p className="habit-stat-average">
                          Average logged:{' '}
                          <strong>
                            {stat.averageNumericValue.toFixed(1)}
                            {stat.habit.unit ? ` ${stat.habit.unit}` : ''}
                          </strong>
                        </p>
                      )}

                      {stat.habit.habit_type === 'number' &&
                        stat.habit.partial_threshold !== null &&
                        stat.habit.partial_threshold !== undefined &&
                        stat.habit.full_threshold !== null &&
                        stat.habit.full_threshold !== undefined && (
                          <p className="habit-stat-rule">
                            0 below {stat.habit.partial_threshold} · 0.5 at{' '}
                            {stat.habit.partial_threshold}+ · 1 at{' '}
                            {stat.habit.full_threshold}+
                          </p>
                        )}
                    </article>
                  ))}
                </div>
              )}
            </section>
          </div>
        </details>
      </div>
    </main>
  );
}
