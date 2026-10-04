#!/usr/bin/env node
'use strict';

// Direct AdGuard toggle without the control server.
// Usage:  node src/adguard-cli.js block | allow | status | rules
// Reads the same environment variables as the server: ADGUARD_URL, ADGUARD_USER, ADGUARD_PASSWORD,
// ADGUARD_CLIENTS, BLOCK_DOMAINS, ALLOW_DOMAINS.

const adguard = require('./adguard');

async function main() {
  const cmd = process.argv[2];
  const cfg = adguard.configFromEnv();
  switch (cmd) {
    case 'block':
    case 'allow': {
      const { changed } = await adguard.applyBlocked(cfg, cmd === 'block');
      console.log(`${cmd}: ${changed ? 'rules updated' : 'already in that state'}`);
      break;
    }
    case 'status': {
      const blocked = await adguard.readBlocked(cfg);
      console.log(blocked === null ? 'no managed rules yet' : blocked ? 'BLOCKED' : 'ALLOWED');
      break;
    }
    case 'rules':
      console.log(adguard.buildManagedRules({ ...cfg, blocked: true }).join('\n'));
      break;
    default:
      console.error('usage: adguard-cli.js block | allow | status | rules');
      process.exit(2);
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
