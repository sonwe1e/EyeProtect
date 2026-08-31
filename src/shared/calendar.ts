/**
 * Civil-time calendar arithmetic (USERPLAN 1.2 PR0, ADR-003).
 *
 * This module is the ONLY sanctioned source of calendar-day math in the app.
 * Raw millisecond arithmetic such as `day + 86_400_000` is forbidden (and
 * enforced by tests/calendar-guard.test.ts): on DST transition days 23 or 25
 * real hours pass between two local midnights, so adding 24h of milliseconds
 * silently shifts wall-clock time (a 09:00 plan renders as 10:00 after the
 * spring-forward boundary). Every function here performs civil (wall-clock)
 * math through Date component setters, which normalise DST transitions.
 *
 * Planner, Today, Upcoming and recurrence code must call these helpers —
 * never reimplement day math locally.
 */

/** Local midnight (00:00:00.000) of the calendar day containing `timestamp`. */
export const startOfLocalDate = (timestamp: number): number => {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
};

/** Local end of day (23:59:59.999) of the calendar day containing `timestamp`. */
export const endOfLocalDate = (timestamp: number): number => {
  const date = new Date(timestamp);
  date.setHours(23, 59, 59, 999);
  return date.getTime();
};

/**
 * Add `days` calendar days while keeping the local wall-clock time.
 * `addLocalDays(t, 1)` is "the same time tomorrow on the wall clock", NOT
 * `t + 24h` — across a DST boundary those differ by an hour.
 */
export const addLocalDays = (timestamp: number, days: number): number => {
  const date = new Date(timestamp);
  date.setDate(date.getDate() + days);
  return date.getTime();
};

/** True when both timestamps fall on the same local calendar day. */
export const sameLocalDate = (left: number, right: number): boolean => {
  const a = new Date(left);
  const b = new Date(right);
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
};

/**
 * The instant of wall-clock minute `minutesOfDay` (0–1439) on the local
 * calendar day containing `timestamp`. Safe replacement for
 * `startOfDay + minutes * 60_000`, which drifts when the DST jump happens
 * between midnight and the target wall-clock time.
 */
export const localDateAtMinutes = (timestamp: number, minutesOfDay: number): number => {
  const date = new Date(timestamp);
  date.setHours(Math.floor(minutesOfDay / 60), minutesOfDay % 60, 0, 0);
  return date.getTime();
};

/** Minutes elapsed since local midnight (wall clock), 0–1439. */
export const minutesOfLocalDay = (timestamp: number): number => {
  const date = new Date(timestamp);
  return date.getHours() * 60 + date.getMinutes();
};

/** Local calendar day rendered as an ISO-ish `YYYY-MM-DD` key. */
export const localDateKey = (timestamp: number): string => {
  const date = new Date(timestamp);
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};
