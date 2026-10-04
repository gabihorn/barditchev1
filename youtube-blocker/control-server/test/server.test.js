'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');

const PORT = 18088;
const base = `http://127.0.0.1:${PORT}`;
const ADMIN = 'admin-token-123456';
const AGENT = 'agent-token-123456';

test('server end to end', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ytg-'));
  const proc = spawn(process.execPath, [path.join(__dirname, '..', 'src', 'server.js')], {
    env: { ...process.env, PORT, ADMIN_TOKEN: ADMIN, AGENT_TOKEN: AGENT, DATA_FILE: path.join(dir, 'state.json') },
    stdio: 'ignore',
  });
  t.after(() => proc.kill());
  for (let i = 0; i < 50; i++) {
    try { await fetch(base + '/healthz'); break; } catch { await new Promise((r) => setTimeout(r, 100)); }
  }
  const call = (method, p, token, body) => fetch(base + p, {
    method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body && JSON.stringify(body),
  });

  assert.strictEqual((await call('GET', '/api/status', AGENT)).status, 401);
  await call('POST', '/api/mode', ADMIN, { mode: 'block' });
  const s1 = await (await call('GET', '/api/agent/state', AGENT)).json();
  assert.strictEqual(s1.blocked, true);

  // long-poll resolves when state changes
  const started = Date.now();
  const pending = call('GET', `/api/agent/state?since=${s1.version}&wait=20`, AGENT).then((r) => r.json());
  setTimeout(() => call('POST', '/api/allow', ADMIN, { minutes: 15 }), 300);
  const s2 = await pending;
  assert.strictEqual(s2.blocked, false);
  assert.strictEqual(s2.reason, 'override');
  assert.ok(Date.now() - started < 5000);

  await call('POST', '/api/auto', ADMIN);
  const status = await (await call('GET', '/api/status', ADMIN)).json();
  assert.strictEqual(status.effective.blocked, true);
  assert.strictEqual(status.override, null);

  const bad = await call('PUT', '/api/schedule', ADMIN, { windows: [{ days: [9], from: '1:00', to: '2:00' }] });
  assert.strictEqual(bad.status, 400);
});
