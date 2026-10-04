'use strict';

const fs = require('fs/promises');
const path = require('path');

const HOSTS_PATH = process.env.YTG_HOSTS_PATH || path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'drivers', 'etc', 'hosts');
const START = '# >>> youtube-guard (managed automatically - do not edit) >>>';
const END = '# <<< youtube-guard <<<';

// The hosts file has no wildcards, so every subdomain is listed explicitly.
const DEFAULT_DOMAINS = [
  'youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'studio.youtube.com',
  'tv.youtube.com', 'gaming.youtube.com', 'consent.youtube.com',
  'youtu.be', 'www.youtu.be', 'youtube-nocookie.com', 'www.youtube-nocookie.com',
];

function stripManaged(lines) {
  const out = [];
  let inside = false;
  for (const line of lines) {
    const t = line.trim();
    if (t === START) { inside = true; continue; }
    if (t === END) { inside = false; continue; }
    if (!inside) out.push(line);
  }
  return out;
}

// Pure function: returns the new hosts content for the requested state.
function render(content, blocked, domains = DEFAULT_DOMAINS) {
  const lines = stripManaged(content.replace(/^\uFEFF/, '').split(/\r?\n/));
  while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();
  if (blocked) {
    lines.push('', START);
    for (const d of domains) lines.push(`0.0.0.0 ${d}`, `:: ${d}`);
    lines.push(END);
  }
  return lines.join('\r\n') + '\r\n';
}

function isBlocked(content) {
  return content.split(/\r?\n/).some((l) => l.trim() === START);
}

async function readHosts(file = HOSTS_PATH) {
  try {
    return await fs.readFile(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return '';
    throw err;
  }
}

// Writes only when the content actually changes. Returns true if the file was modified.
async function apply(blocked, domains = DEFAULT_DOMAINS, file = HOSTS_PATH) {
  const current = await readHosts(file);
  const next = render(current, blocked, domains);
  if (next === current) return false;
  let lastErr;
  // The DNS Client service or an antivirus can briefly lock the file.
  for (let i = 0; i < 6; i++) {
    try {
      await fs.writeFile(file, next, 'utf8');
      return true;
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw new Error(`cannot write ${file}: ${lastErr.message}`);
}

module.exports = { HOSTS_PATH, START, END, DEFAULT_DOMAINS, render, isBlocked, apply, readHosts };
