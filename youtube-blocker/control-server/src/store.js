'use strict';

const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const { validateSchedule, evaluateSchedule } = require('./schedule');

const MODES = ['schedule', 'block', 'allow'];

const DEFAULT_STATE = {
  mode: 'schedule',
  override: null, // { blocked: boolean, until: ISO string }
  schedule: {
    timezone: 'Asia/Jerusalem',
    default: 'block',
    windows: [
      { label: 'אחרי הצהריים', days: [0, 1, 2, 3, 4], from: '16:00', to: '17:30' },
      { label: 'שישי', days: [5], from: '10:00', to: '12:00' },
    ],
  },
};

class Store extends EventEmitter {
  constructor(file) {
    super();
    this.file = file;
    this.data = structuredClone(DEFAULT_STATE);
    this.agents = {};
    // Start from a boot-unique value so agents holding an old version re-sync after a restart.
    this.version = Date.now();
    this.effective = null;
    this.load();
    this.refresh();
  }

  load() {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      this.data = {
        mode: MODES.includes(raw.mode) ? raw.mode : DEFAULT_STATE.mode,
        override: raw.override || null,
        schedule: validateSchedule(raw.schedule || DEFAULT_STATE.schedule),
      };
    } catch (err) {
      if (err.code !== 'ENOENT') console.error(`[store] could not read ${this.file}: ${err.message} - using defaults`);
      this.save();
    }
  }

  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.file);
  }

  evaluate(now = new Date()) {
    const { override, mode, schedule } = this.data;
    if (override && new Date(override.until) > now) {
      return { blocked: override.blocked, reason: 'override', until: override.until };
    }
    if (mode === 'block') return { blocked: true, reason: 'mode:block', until: null };
    if (mode === 'allow') return { blocked: false, reason: 'mode:allow', until: null };
    const { blocked, window } = evaluateSchedule(schedule, now);
    return {
      blocked,
      reason: window ? `schedule:window${window.label ? `:${window.label}` : ''}` : `schedule:default`,
      until: null,
    };
  }

  // Recomputes the effective state; bumps the version and emits "change" when it differs.
  refresh(now = new Date()) {
    if (this.data.override && new Date(this.data.override.until) <= now) {
      this.data.override = null;
      this.save();
    }
    const next = this.evaluate(now);
    const prev = this.effective;
    this.effective = next;
    if (!prev || prev.blocked !== next.blocked || prev.reason !== next.reason || prev.until !== next.until) {
      this.version += 1;
      this.emit('change', this.snapshot());
    }
    return this.effective;
  }

  snapshot() {
    return { ...this.effective, version: this.version, serverTime: new Date().toISOString() };
  }

  setOverride(blocked, minutes) {
    if (typeof blocked !== 'boolean') throw new Error('"blocked" must be true or false');
    const mins = minutes === undefined ? 60 : Number(minutes);
    if (!Number.isFinite(mins) || mins <= 0 || mins > 7 * 24 * 60) throw new Error('"minutes" must be between 1 and 10080');
    this.data.override = { blocked, until: new Date(Date.now() + mins * 60_000).toISOString() };
    this.save();
    return this.refresh();
  }

  clearOverride() {
    this.data.override = null;
    this.save();
    return this.refresh();
  }

  setMode(mode) {
    if (!MODES.includes(mode)) throw new Error(`"mode" must be one of: ${MODES.join(', ')}`);
    this.data.mode = mode;
    this.save();
    return this.refresh();
  }

  setSchedule(schedule) {
    this.data.schedule = validateSchedule(schedule);
    this.save();
    return this.refresh();
  }

  recordHeartbeat(info) {
    const id = String(info.id || info.hostname || 'unknown').slice(0, 64);
    this.agents[id] = {
      hostname: info.hostname ? String(info.hostname).slice(0, 64) : undefined,
      applied: typeof info.applied === 'boolean' ? info.applied : undefined,
      method: info.method ? String(info.method).slice(0, 32) : undefined,
      error: info.error ? String(info.error).slice(0, 500) : null,
      lastSeen: new Date().toISOString(),
    };
  }
}

module.exports = { Store, DEFAULT_STATE, MODES };
