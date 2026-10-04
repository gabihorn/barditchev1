'use strict';

// Minimal AdGuard Home API client that owns a marked block inside the "Custom filtering rules".
// Rules outside the markers are never touched.

const START = '! >>> youtube-guard (managed automatically - do not edit) >>>';
const END = '! <<< youtube-guard <<<';

const DEFAULT_BLOCK_DOMAINS = ['youtube.com', 'youtu.be', 'youtube-nocookie.com'];
// accounts.youtube.com is part of the Google sign-in flow (also used by YouTube Kids).
const DEFAULT_ALLOW_DOMAINS = ['youtubekids.com', 'accounts.youtube.com'];

function splitList(value, fallback) {
  if (!value) return fallback;
  return String(value).split(',').map((s) => s.trim()).filter(Boolean);
}

function configFromEnv(env = process.env) {
  return {
    url: (env.ADGUARD_URL || 'http://adguardhome:80').replace(/\/+$/, ''),
    username: env.ADGUARD_USER || 'admin',
    password: env.ADGUARD_PASSWORD || '',
    clients: splitList(env.ADGUARD_CLIENTS, []),
    blockDomains: splitList(env.BLOCK_DOMAINS, DEFAULT_BLOCK_DOMAINS),
    allowDomains: splitList(env.ALLOW_DOMAINS, DEFAULT_ALLOW_DOMAINS),
  };
}

function clientModifier(clients) {
  if (!clients || clients.length === 0) return '';
  const quoted = clients.map((c) => (/^[\w.:/-]+$/.test(c) ? c : `'${c.replace(/'/g, "\\'")}'`));
  return `$client=${quoted.join('|')}`;
}

function buildManagedRules({ blocked, clients, blockDomains, allowDomains }) {
  const mod = clientModifier(clients);
  const lines = [START];
  if (blocked) {
    for (const d of blockDomains) lines.push(`||${d}^${mod}`);
    for (const d of allowDomains) lines.push(`@@||${d}^${mod}`);
  } else {
    lines.push('! state: allowed');
  }
  lines.push(END);
  return lines;
}

function stripManaged(rules) {
  const out = [];
  let inside = false;
  for (const line of rules) {
    if (line === START) { inside = true; continue; }
    if (line === END) { inside = false; continue; }
    if (!inside) out.push(line);
  }
  return out;
}

function mergeRules(existing, managed) {
  const rest = stripManaged(existing);
  while (rest.length && rest[rest.length - 1].trim() === '') rest.pop();
  return [...rest, ...managed];
}

async function request(cfg, path, { method = 'GET', body } = {}) {
  const headers = { Authorization: `Basic ${Buffer.from(`${cfg.username}:${cfg.password}`).toString('base64')}` };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(cfg.url + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`AdGuard ${method} ${path} -> HTTP ${res.status} ${text.slice(0, 200)}`);
  return (res.headers.get('content-type') || '').includes('json') && text ? JSON.parse(text) : text;
}

async function getUserRules(cfg) {
  const status = await request(cfg, '/control/filtering/status');
  return status.user_rules || [];
}

async function setUserRules(cfg, rules) {
  await request(cfg, '/control/filtering/set_rules', { method: 'POST', body: { rules } });
}

// Returns { changed: boolean, rules: string[] }
async function applyBlocked(cfg, blocked) {
  const existing = await getUserRules(cfg);
  const next = mergeRules(existing, buildManagedRules({ ...cfg, blocked }));
  if (JSON.stringify(existing) === JSON.stringify(next)) return { changed: false, rules: next };
  await setUserRules(cfg, next);
  return { changed: true, rules: next };
}

async function readBlocked(cfg) {
  const rules = await getUserRules(cfg);
  const start = rules.indexOf(START);
  if (start === -1) return null;
  const end = rules.indexOf(END, start);
  return rules.slice(start + 1, end === -1 ? undefined : end).some((r) => r.startsWith('||'));
}

module.exports = {
  START, END, configFromEnv, buildManagedRules, mergeRules, stripManaged, applyBlocked, readBlocked, getUserRules,
};
