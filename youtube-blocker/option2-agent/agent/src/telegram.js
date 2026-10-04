'use strict';

// Telegram bot control for the standalone agent (no server needed).
// The agent long-polls the Telegram Bot API, so it works from anywhere without opening ports.
// Only chats that paired with the one-time pairing code (shown at install) may control it.

const fs = require('fs');
const path = require('path');

const DAY_LETTERS = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];
const MAX_PAIR_ATTEMPTS = 5;

const KEYBOARD = {
  inline_keyboard: [
    [{ text: '🔴 חסום', callback_data: 'חסום' }, { text: '🟢 פתח 30 דק׳', callback_data: 'פתח 30' }],
    [{ text: '🟢 פתח שעה', callback_data: 'פתח 60' }, { text: '🔄 אוטומטי', callback_data: 'אוטומטי' }],
    [{ text: 'ℹ️ מצב', callback_data: 'מצב' }, { text: '📅 לוח זמנים', callback_data: 'לוח' }],
  ],
};

const HELP = [
  'פקודות:',
  'פתח 30 – פתיחת יוטיוב ל-30 דקות',
  'חסום – חסימה מיידית לשעתיים (חסום 60 = לשעה)',
  'אוטומטי – חזרה ללוח הזמנים',
  'חסום תמיד / פתוח תמיד – מצב קבוע',
  'מצב – מה המצב עכשיו',
  'לוח – הצגת לוח הזמנים',
  '/setschedule {JSON} – עדכון לוח הזמנים',
].join('\n');

function fmtTime(iso, timeZone) {
  return new Date(iso).toLocaleTimeString('he-IL', { timeZone, hour: '2-digit', minute: '2-digit' });
}

function describeDays(days) {
  const sorted = [...days].sort();
  const contiguous = sorted.length > 2 && sorted.every((d, i) => i === 0 || d === sorted[i - 1] + 1);
  return contiguous ? `${DAY_LETTERS[sorted[0]]}-${DAY_LETTERS[sorted[sorted.length - 1]]}` : sorted.map((d) => DAY_LETTERS[d]).join(',');
}

function scheduleText(schedule) {
  const head = schedule.default === 'block'
    ? 'יוטיוב חסום, חוץ מהשעות האלה:'
    : 'יוטיוב פתוח, חוץ מהשעות החסומות האלה:';
  const lines = schedule.windows.map((w) => `• ${describeDays(w.days)} ${w.from}–${w.to}${w.label ? ` (${w.label})` : ''}`);
  return [head, ...(lines.length ? lines : ['(אין חלונות)']), '', `אזור זמן: ${schedule.timezone}`].join('\n');
}

function statusText(snap, schedule, extra = {}) {
  const head = snap.blocked ? '🔴 יוטיוב חסום' : '🟢 יוטיוב פתוח';
  let reason;
  if (snap.reason === 'override') reason = `${snap.blocked ? 'חסום' : 'פתוח'} זמנית עד ${fmtTime(snap.until, schedule.timezone)}`;
  else if (snap.reason === 'mode:block') reason = 'מצב קבוע: חסום תמיד';
  else if (snap.reason === 'mode:allow') reason = 'מצב קבוע: פתוח תמיד';
  else if (snap.reason.startsWith('schedule:window')) {
    const label = snap.reason.split(':').slice(2).join(':');
    reason = `לפי לוח הזמנים${label ? ` (${label})` : ''}`;
  } else reason = 'לפי לוח הזמנים';
  const lines = [head, reason];
  if (extra.applied !== undefined && extra.applied !== null && extra.applied !== snap.blocked) lines.push('⏳ מחיל במחשב...');
  if (extra.error) lines.push(`⚠️ שגיאה במחשב: ${extra.error}`);
  return lines.join('\n');
}

// Pure command handler. Returns the reply text; mutates the store.
function handleCommand(rawText, store, extra = {}) {
  const text = String(rawText || '').trim().replace(/^\//, '').replace(/@\w+$/, '');
  const tz = store.data.schedule.timezone;
  let m;

  if (/^(start|menu|help|תפריט|עזרה)$/i.test(text)) return HELP;

  if (/^(חסום תמיד|always_block)$/i.test(text)) {
    store.clearOverride();
    store.setMode('block');
    return statusText(store.snapshot(), store.data.schedule, extra);
  }
  if (/^(פתוח תמיד|פתח תמיד|always_allow)$/i.test(text)) {
    store.clearOverride();
    store.setMode('allow');
    return statusText(store.snapshot(), store.data.schedule, extra);
  }
  if ((m = /^(חסום|block)(?:\s+(\d+))?$/i.exec(text))) {
    const minutes = m[2] ? Number(m[2]) : 120;
    store.setOverride(true, minutes);
    return `🔴 יוטיוב נחסם עד ${fmtTime(store.data.override.until, tz)}`;
  }
  if ((m = /^(פתח|allow)(?:\s+(\d+))?$/i.exec(text))) {
    const minutes = m[2] ? Number(m[2]) : 30;
    store.setOverride(false, minutes);
    return `🟢 יוטיוב פתוח עד ${fmtTime(store.data.override.until, tz)}`;
  }
  if (/^(אוטומטי|auto)$/i.test(text)) {
    store.clearOverride();
    store.setMode('schedule');
    return `🔄 חזרה ללוח הזמנים\n${statusText(store.snapshot(), store.data.schedule, extra)}`;
  }
  if (/^(מצב|סטטוס|status)$/i.test(text)) return statusText(store.snapshot(), store.data.schedule, extra);
  if (/^(לוח|לוח זמנים|schedule)$/i.test(text)) {
    return `${scheduleText(store.data.schedule)}\n\nלעדכון שלח:\n/setschedule ${JSON.stringify(store.data.schedule)}`;
  }
  if ((m = /^setschedule\s+([\s\S]+)$/i.exec(text))) {
    let parsed;
    try {
      parsed = JSON.parse(m[1]);
    } catch {
      return '❌ ה-JSON לא תקין';
    }
    try {
      store.setSchedule(parsed);
    } catch (err) {
      return `❌ ${err.message}`;
    }
    return `✅ לוח הזמנים עודכן\n${scheduleText(store.data.schedule)}`;
  }
  return `לא הבנתי 🤔\n\n${HELP}`;
}

class TelegramBot {
  constructor({ botToken, pairingCode, notifyScheduleChanges = true, apiBase = 'https://api.telegram.org' }, { store, dataDir, log, getAgentStatus }) {
    if (!botToken) throw new Error('telegram.botToken is required');
    this.token = botToken;
    this.pairingCode = String(pairingCode || '');
    this.notifyScheduleChanges = notifyScheduleChanges;
    this.apiBase = apiBase;
    this.store = store;
    this.log = log;
    this.getAgentStatus = getAgentStatus || (() => ({}));
    this.file = path.join(dataDir, 'telegram.json');
    this.state = { chats: [], offset: 0 };
    this.pairAttempts = new Map();
    this.activeChat = null; // chat whose command is being processed (it gets a direct reply instead)
    this.startedAt = Math.floor(Date.now() / 1000);
    try {
      this.state = { ...this.state, ...JSON.parse(fs.readFileSync(this.file, 'utf8')) };
    } catch { /* first run */ }

    store.on('change', (snap) => {
      if (snap.reason.startsWith('schedule') && !this.notifyScheduleChanges && this.activeChat === null) return;
      const text = statusText(snap, store.data.schedule);
      this.broadcast(this.activeChat === null ? text : `${text}\n(שונה ע״י משתמש אחר)`, this.activeChat);
    });
  }

  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(this.state));
  }

  async api(method, body, timeoutMs = 15_000) {
    const res = await fetch(`${this.apiBase}/bot${this.token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(`telegram ${method}: ${data.description}`);
    return data.result;
  }

  send(chatId, text, withKeyboard = true) {
    return this.api('sendMessage', { chat_id: chatId, text, ...(withKeyboard ? { reply_markup: KEYBOARD } : {}) })
      .catch((err) => this.log.warn(err.message));
  }

  async broadcast(text, exceptChat = null) {
    for (const chat of this.state.chats) {
      if (chat !== exceptChat) await this.send(chat, text);
    }
  }

  isAuthorized(chatId) {
    return this.state.chats.includes(chatId);
  }

  async handleText(chatId, text) {
    if (!this.isAuthorized(chatId)) {
      const m = /^\/?(?:pair|צימוד)\s+(\S+)$/i.exec(String(text || '').trim());
      const attempts = this.pairAttempts.get(chatId) || 0;
      if (attempts >= MAX_PAIR_ATTEMPTS) return;
      if (m && this.pairingCode && m[1] === this.pairingCode) {
        this.state.chats.push(chatId);
        this.save();
        this.log.info(`telegram: chat ${chatId} paired`);
        await this.send(chatId, `✅ מחובר! מעכשיו אפשר לשלוט ביוטיוב במחשב מכאן.\n\n${HELP}`);
        return;
      }
      this.pairAttempts.set(chatId, attempts + 1);
      await this.send(chatId, '⛔ אין הרשאה. לחיבור שלח: /pair <הקוד שהוצג בהתקנה>', false);
      return;
    }
    this.activeChat = chatId;
    let reply;
    try {
      reply = handleCommand(text, this.store, this.getAgentStatus());
    } finally {
      this.activeChat = null;
    }
    this.log.info(`telegram: chat ${chatId}: "${String(text).slice(0, 40)}"`);
    await this.send(chatId, reply);
  }

  async handleUpdate(u) {
    if (u.message && typeof u.message.text === 'string') {
      // Ignore commands that queued up while the PC was off (e.g. an old "פתח 30").
      if (u.message.date < this.startedAt - 120) return;
      await this.handleText(u.message.chat.id, u.message.text);
    } else if (u.callback_query) {
      const cq = u.callback_query;
      await this.api('answerCallbackQuery', { callback_query_id: cq.id }).catch(() => {});
      if (cq.message) await this.handleText(cq.message.chat.id, cq.data);
    }
  }

  async run() {
    this.log.info(`telegram bot started (${this.state.chats.length} paired chat(s))`);
    for (;;) {
      try {
        const updates = await this.api('getUpdates', {
          offset: this.state.offset,
          timeout: 50,
          allowed_updates: ['message', 'callback_query'],
        }, 65_000);
        for (const u of updates) {
          this.state.offset = u.update_id + 1;
          this.save();
          await this.handleUpdate(u).catch((err) => this.log.error(`telegram update: ${err.message}`));
        }
      } catch (err) {
        this.log.warn(`telegram: ${err.message}`);
        await new Promise((r) => setTimeout(r, 5000));
      }
    }
  }
}

module.exports = { TelegramBot, handleCommand, statusText, scheduleText, KEYBOARD };
