'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const hosts = require('../src/hosts');

const ORIGINAL = '# Copyright (c) Microsoft\r\n127.0.0.1 localhost\r\n10.0.0.5 nas.local\r\n';

test('render adds and removes the managed block, keeping other lines', () => {
  const blocked = hosts.render(ORIGINAL, true, ['youtube.com']);
  assert.ok(blocked.includes('0.0.0.0 youtube.com\r\n:: youtube.com\r\n'));
  assert.ok(blocked.includes('10.0.0.5 nas.local'));
  assert.ok(hosts.isBlocked(blocked));
  assert.strictEqual(hosts.render(blocked, true, ['youtube.com']), blocked); // idempotent
  const allowed = hosts.render(blocked, false);
  assert.strictEqual(allowed, ORIGINAL);
  assert.ok(!hosts.isBlocked(allowed));
});

test('never touches youtubekids.com', () => {
  const blocked = hosts.render('', true);
  assert.ok(!/youtubekids/.test(blocked));
});

test('apply writes only on change', async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ytg-')), 'hosts');
  fs.writeFileSync(file, ORIGINAL);
  assert.strictEqual(await hosts.apply(true, hosts.DEFAULT_DOMAINS, file), true);
  assert.strictEqual(await hosts.apply(true, hosts.DEFAULT_DOMAINS, file), false);
  // a manual edit that removes the block is repaired
  fs.writeFileSync(file, ORIGINAL);
  assert.strictEqual(await hosts.apply(true, hosts.DEFAULT_DOMAINS, file), true);
  assert.strictEqual(await hosts.apply(false, hosts.DEFAULT_DOMAINS, file), true);
  assert.strictEqual(fs.readFileSync(file, 'utf8'), ORIGINAL);
});
