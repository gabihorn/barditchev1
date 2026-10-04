'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { Store } = require('../src/store');
const { TelegramBot, handleCommand } = require('../src/telegram');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ytg-tg-'));
const silent = { info() {}, warn() {}, error() {} };

test('commands change the state', () => {
  const store = new Store(path.join(tmp(), 'state.json'));
  assert.match(handleCommand('פתח 15', store), /פתוח עד/);
  assert.strictEqual(store.effective.blocked, false);
  assert.strictEqual(store.effective.reason, 'override');
  assert.match(handleCommand('/block', store), /נחסם עד/);
  assert.strictEqual(store.effective.blocked, true);
  handleCommand('פתוח תמיד', store);
  assert.strictEqual(store.effective.reason, 'mode:allow');
  assert.match(handleCommand('אוטומטי', store), /לוח הזמנים/);
  assert.strictEqual(store.data.mode, 'schedule');
  assert.strictEqual(store.data.override, null);
  assert.match(handleCommand('מצב', store), /יוטיוב/);
  assert.match(handleCommand('לוח', store), /א׳-ה׳ 16:00–17:30/);
  assert.match(handleCommand('/setschedule {"default":"allow","windows":[]}', store), /עודכן/);
  assert.strictEqual(store.data.schedule.default, 'allow');
  assert.match(handleCommand('/setschedule {bad', store), /JSON/);
  assert.match(handleCommand('שלום', store), /לא הבנתי/);
});

test('bot pairs with the code, rejects strangers, broadcasts to others', async (t) => {
  const sent = [];
  let pending = [];
  const srv = http.createServer((req, res) => {
    let b = '';
    req.on('data', (c) => { b += c; });
    req.on('end', () => {
      const body = JSON.parse(b || '{}');
      const method = req.url.split('/').pop();
      res.setHeader('Content-Type', 'application/json');
      if (method === 'getUpdates') {
        const result = pending; pending = [];
        return res.end(JSON.stringify({ ok: true, result }));
      }
      if (method === 'sendMessage') sent.push(body);
      res.end(JSON.stringify({ ok: true, result: {} }));
    });
  });
  await new Promise((r) => srv.listen(0, r));
  t.after(() => srv.close());

  const dir = tmp();
  const store = new Store(path.join(dir, 'state.json'));
  const bot = new TelegramBot(
    { botToken: 'x', pairingCode: '482913', apiBase: `http://127.0.0.1:${srv.address().port}` },
    { store, dataDir: dir, log: silent },
  );
  const now = Math.floor(Date.now() / 1000);
  const msg = (id, chat, text, date = now) => ({ update_id: id, message: { date, chat: { id: chat }, text } });

  await bot.handleUpdate(msg(1, 111, 'פתח 30'));
  assert.match(sent.pop().text, /אין הרשאה/);
  assert.strictEqual(store.effective.reason !== 'override', true);

  await bot.handleUpdate(msg(2, 111, '/pair 000000'));
  assert.match(sent.pop().text, /אין הרשאה/);
  await bot.handleUpdate(msg(3, 111, '/pair 482913'));
  assert.match(sent.pop().text, /מחובר/);
  await bot.handleUpdate(msg(4, 222, 'צימוד 482913'));
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(dir, 'telegram.json'))).chats, [111, 222]);

  sent.length = 0;
  await bot.handleUpdate({ update_id: 5, callback_query: { id: 'q', data: 'פתח 30', message: { chat: { id: 111 } } } });
  await new Promise((r) => setTimeout(r, 50));
  assert.strictEqual(store.effective.blocked, false);
  const to111 = sent.filter((m) => m.chat_id === 111);
  const to222 = sent.filter((m) => m.chat_id === 222);
  assert.strictEqual(to111.length, 1);
  assert.match(to111[0].text, /פתוח עד/);
  assert.ok(to111[0].reply_markup.inline_keyboard);
  assert.strictEqual(to222.length, 1);
  assert.match(to222[0].text, /משתמש אחר/);

  // stale command from before startup is ignored
  sent.length = 0;
  await bot.handleUpdate(msg(6, 111, 'חסום', now - 3600));
  assert.strictEqual(sent.length, 0);
  assert.strictEqual(store.effective.blocked, false);

  // brute force protection
  for (let i = 0; i < 10; i++) await bot.handleUpdate(msg(10 + i, 999, '/pair 1'));
  await bot.handleUpdate(msg(30, 999, '/pair 482913'));
  assert.ok(!bot.isAuthorized(999));
});
