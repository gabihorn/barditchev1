'use strict';
const test = require('node:test');
const assert = require('node:assert');
const ag = require('../src/adguard');

const cfg = { clients: ['192.168.1.50'], blockDomains: ['youtube.com', 'youtu.be'], allowDomains: ['youtubekids.com'] };

test('builds client-scoped rules', () => {
  const rules = ag.buildManagedRules({ ...cfg, blocked: true });
  assert.deepStrictEqual(rules.slice(1, -1), [
    '||youtube.com^$client=192.168.1.50',
    '||youtu.be^$client=192.168.1.50',
    '@@||youtubekids.com^$client=192.168.1.50',
  ]);
});

test('quotes client names with spaces', () => {
  const rules = ag.buildManagedRules({ ...cfg, clients: ['Kids PC', '10.0.0.0/24'], blocked: true });
  assert.strictEqual(rules[1], "||youtube.com^$client='Kids PC'|10.0.0.0/24");
});

test('merge keeps user rules and replaces managed block', () => {
  const existing = ['||ads.example^', '', ...ag.buildManagedRules({ ...cfg, blocked: true }), '||other^'];
  const merged = ag.mergeRules(existing, ag.buildManagedRules({ ...cfg, blocked: false }));
  assert.deepStrictEqual(merged, ['||ads.example^', '', '||other^', ag.START, '! state: allowed', ag.END]);
  // idempotent
  assert.deepStrictEqual(ag.mergeRules(merged, ag.buildManagedRules({ ...cfg, blocked: false })), merged);
});

test('applyBlocked talks to the AdGuard API', async (t) => {
  const http = require('node:http');
  let userRules = ['||ads.example^'];
  const seenAuth = [];
  const srv = http.createServer((req, res) => {
    seenAuth.push(req.headers.authorization);
    if (req.method === 'GET' && req.url === '/control/filtering/status') {
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify({ enabled: true, user_rules: userRules }));
    }
    if (req.method === 'POST' && req.url === '/control/filtering/set_rules') {
      let b = '';
      req.on('data', (c) => { b += c; });
      return req.on('end', () => { userRules = JSON.parse(b).rules; res.end(); });
    }
    res.statusCode = 404; res.end();
  });
  await new Promise((r) => srv.listen(0, r));
  t.after(() => srv.close());
  const c = { ...cfg, url: `http://127.0.0.1:${srv.address().port}`, username: 'admin', password: 'pw' };

  assert.strictEqual((await ag.applyBlocked(c, true)).changed, true);
  assert.strictEqual(await ag.readBlocked(c), true);
  assert.strictEqual((await ag.applyBlocked(c, true)).changed, false);
  assert.strictEqual((await ag.applyBlocked(c, false)).changed, true);
  assert.strictEqual(await ag.readBlocked(c), false);
  assert.strictEqual(userRules[0], '||ads.example^');
  assert.strictEqual(seenAuth[0], 'Basic ' + Buffer.from('admin:pw').toString('base64'));
});
