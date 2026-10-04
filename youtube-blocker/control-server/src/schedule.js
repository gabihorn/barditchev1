'use strict';

// Schedule format:
// {
//   "timezone": "Asia/Jerusalem",
//   "default": "block",            // state outside the windows: "block" | "allow"
//   "windows": [                    // windows flip the default
//     { "label": "after school", "days": [0,1,2,3,4], "from": "16:00", "to": "17:30" }
//   ]
// }
// days: 0 = Sunday ... 6 = Saturday. A window where from > to crosses midnight.

const DAY_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

function toMinutes(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || ''));
  if (!m) throw new Error(`Invalid time "${hhmm}" (expected HH:MM)`);
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 24 || min > 59 || (h === 24 && min !== 0)) throw new Error(`Invalid time "${hhmm}"`);
  return h * 60 + min;
}

function localParts(date, timeZone) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const parts = Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]));
  return {
    day: DAY_NAMES.indexOf(parts.weekday.toLowerCase().slice(0, 3)),
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

function validateSchedule(s) {
  if (!s || typeof s !== 'object') throw new Error('schedule must be an object');
  const timezone = s.timezone || 'Asia/Jerusalem';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
  } catch {
    throw new Error(`Unknown timezone "${timezone}"`);
  }
  const def = s.default || 'block';
  if (!['block', 'allow'].includes(def)) throw new Error('schedule.default must be "block" or "allow"');
  const windows = s.windows || [];
  if (!Array.isArray(windows)) throw new Error('schedule.windows must be an array');
  const clean = windows.map((w, i) => {
    if (!Array.isArray(w.days) || w.days.length === 0) throw new Error(`windows[${i}].days must be a non-empty array`);
    for (const d of w.days) {
      if (!Number.isInteger(d) || d < 0 || d > 6) throw new Error(`windows[${i}].days: ${d} is not 0-6`);
    }
    const from = toMinutes(w.from);
    const to = toMinutes(w.to);
    if (from === to) throw new Error(`windows[${i}]: from and to are equal`);
    return { label: w.label || '', days: [...new Set(w.days)].sort(), from: w.from, to: w.to };
  });
  return { timezone, default: def, windows: clean };
}

function findActiveWindow(schedule, date = new Date()) {
  const { day, minutes } = localParts(date, schedule.timezone);
  const prevDay = (day + 6) % 7;
  for (const w of schedule.windows) {
    const from = toMinutes(w.from);
    const to = toMinutes(w.to);
    const active = from < to
      ? w.days.includes(day) && minutes >= from && minutes < to
      : (w.days.includes(day) && minutes >= from) || (w.days.includes(prevDay) && minutes < to);
    if (active) return w;
  }
  return null;
}

// Returns { blocked, window }
function evaluateSchedule(schedule, date = new Date()) {
  const window = findActiveWindow(schedule, date);
  const defaultBlocked = schedule.default === 'block';
  return { blocked: window ? !defaultBlocked : defaultBlocked, window };
}

module.exports = { validateSchedule, evaluateSchedule, findActiveWindow, localParts, toMinutes };
