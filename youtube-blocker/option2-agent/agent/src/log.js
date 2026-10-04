'use strict';

const fs = require('fs');
const path = require('path');

const LOG_DIR = path.join(__dirname, '..', 'logs');
const LOG_FILE = path.join(LOG_DIR, 'agent.log');
const MAX_BYTES = 2 * 1024 * 1024;

fs.mkdirSync(LOG_DIR, { recursive: true });

function write(level, msg) {
  const line = `${new Date().toISOString()} [${level}] ${msg}`;
  (level === 'error' ? console.error : console.log)(line);
  try {
    if (fs.existsSync(LOG_FILE) && fs.statSync(LOG_FILE).size > MAX_BYTES) {
      fs.renameSync(LOG_FILE, `${LOG_FILE}.1`);
    }
    fs.appendFileSync(LOG_FILE, line + '\n');
  } catch { /* logging must never crash the agent */ }
}

module.exports = {
  info: (m) => write('info', m),
  warn: (m) => write('warn', m),
  error: (m) => write('error', m),
};
