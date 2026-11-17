/**
 * Time of day: the light in the scene and the theme of the whole interface (`:root[data-time]` in style.css).
 * Pure presentation. What bites is decided by the game, never by this.
 */
export type TimeOfDay = 'morning' | 'day' | 'evening' | 'night';
export type TimeSetting = 'auto' | TimeOfDay;

export const TIME_SETTINGS: { id: TimeSetting; label: string; hint: string }[] = [
  { id: 'auto', label: 'Auto', hint: 'Follow your clock' },
  { id: 'morning', label: 'Morning', hint: 'Misty morning' },
  { id: 'day', label: 'Day', hint: 'Clear day' },
  { id: 'evening', label: 'Evening', hint: 'Sunset' },
  { id: 'night', label: 'Night', hint: 'Moonlit night' },
];

const KEY = 'fishing.time';
const TIMES: readonly string[] = ['morning', 'day', 'evening', 'night'];

/** The time of day at an hour of the player's clock. */
export function timeAtHour(hour: number): TimeOfDay {
  return hour >= 5 && hour < 10 ? 'morning' : hour >= 10 && hour < 17 ? 'day' : hour >= 17 && hour < 21 ? 'evening' : 'night';
}

function stored(): TimeSetting {
  try {
    const v = localStorage.getItem(KEY);
    if (v && TIMES.includes(v)) return v as TimeOfDay;
  } catch {
    // storage may be unavailable (private window): fall back to auto
  }
  return 'auto';
}

let setting: TimeSetting = stored();
let current: TimeOfDay = 'night';
const listeners = new Set<() => void>();

function apply(): void {
  const next = setting === 'auto' ? timeAtHour(new Date().getHours()) : setting;
  const first = !document.documentElement.dataset.time;
  if (next === current && !first) return;
  current = next;
  document.documentElement.dataset.time = next;
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
  if (bg) document.querySelector('meta[name="theme-color"]')?.setAttribute('content', bg);
  listeners.forEach((f) => f());
}

export const timeSetting = (): TimeSetting => setting;
export const timeOfDay = (): TimeOfDay => current;

export function setTimeSetting(next: TimeSetting): void {
  setting = next;
  try {
    if (next === 'auto') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, next);
  } catch {
    // not saved; the choice still holds for this visit
  }
  apply();
  listeners.forEach((f) => f());
}

/** Called when the time of day (or the setting) changes. */
export function onTimeChange(f: () => void): void {
  listeners.add(f);
}

export function initDaytime(): void {
  apply();
  // "auto" follows the clock while the page stays open
  setInterval(apply, 60_000);
}
