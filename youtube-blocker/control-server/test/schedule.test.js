'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { validateSchedule, evaluateSchedule } = require('../src/schedule');

const sched = validateSchedule({
  timezone: 'Asia/Jerusalem',
  default: 'block',
  windows: [
    { label: 'afternoon', days: [0, 1, 2, 3, 4], from: '16:00', to: '17:30' },
    { label: 'night', days: [4], from: '23:00', to: '01:00' },
  ],
});

// 2026-10-04 is a Sunday. Israel is UTC+3 (IDT) on that date.
const at = (iso) => new Date(iso);

test('blocked outside windows', () => {
  assert.strictEqual(evaluateSchedule(sched, at('2026-10-04T12:00:00Z')).blocked, true); // 15:00 local
});

test('allowed inside window', () => {
  const r = evaluateSchedule(sched, at('2026-10-04T13:30:00Z')); // 16:30 local
  assert.strictEqual(r.blocked, false);
  assert.strictEqual(r.window.label, 'afternoon');
});

test('window end is exclusive', () => {
  assert.strictEqual(evaluateSchedule(sched, at('2026-10-04T14:30:00Z')).blocked, true); // 17:30 local
});

test('overnight window continues into next day', () => {
  // Thursday 2026-10-08 23:30 local, then Friday 00:30 local
  assert.strictEqual(evaluateSchedule(sched, at('2026-10-08T20:30:00Z')).blocked, false);
  assert.strictEqual(evaluateSchedule(sched, at('2026-10-08T21:30:00Z')).blocked, false);
  assert.strictEqual(evaluateSchedule(sched, at('2026-10-08T22:30:00Z')).blocked, true); // 01:30 local
});

test('default allow inverts windows', () => {
  const s = validateSchedule({ timezone: 'Asia/Jerusalem', default: 'allow', windows: [{ days: [0], from: '20:00', to: '07:00' }] });
  assert.strictEqual(evaluateSchedule(s, at('2026-10-04T18:00:00Z')).blocked, true); // Sun 21:00
  assert.strictEqual(evaluateSchedule(s, at('2026-10-04T12:00:00Z')).blocked, false);
});

test('validation errors', () => {
  assert.throws(() => validateSchedule({ timezone: 'Nope/Zone' }));
  assert.throws(() => validateSchedule({ windows: [{ days: [7], from: '10:00', to: '11:00' }] }));
  assert.throws(() => validateSchedule({ windows: [{ days: [1], from: '25:00', to: '11:00' }] }));
});
