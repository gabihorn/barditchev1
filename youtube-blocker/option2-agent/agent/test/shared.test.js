'use strict';
// store.js and schedule.js are copied from control-server (the agent is installed on its own).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

for (const file of ['store.js', 'schedule.js']) {
  test(`${file} matches control-server`, () => {
    const a = fs.readFileSync(path.join(__dirname, '..', 'src', file), 'utf8');
    const b = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'control-server', 'src', file), 'utf8');
    assert.strictEqual(a, b, `copy control-server/src/${file} to option2-agent/agent/src/`);
  });
}
