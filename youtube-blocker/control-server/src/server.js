'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Store } = require('./store');
const adguard = require('./adguard');

const PORT = Number(process.env.PORT || 8088);
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, '..', 'data', 'state.json');
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';
const AGENT_TOKEN = process.env.AGENT_TOKEN || '';
const TICK_MS = 10_000;
const MAX_WAIT_SEC = 55;
const ADGUARD_ENABLED = Boolean(process.env.ADGUARD_URL);
const ADGUARD_RESYNC_MS = Number(process.env.ADGUARD_RESYNC_SEC || 60) * 1000;

if (ADMIN_TOKEN.length < 12) {
  console.error('ADMIN_TOKEN must be set (at least 12 characters). Refusing to start.');
  process.exit(1);
}

const store = new Store(DATA_FILE);
const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'));
let adguardStatus = ADGUARD_ENABLED ? { ok: null, lastSync: null, error: null } : null;

// ---------- helpers ----------

function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

function tokenFrom(req, url) {
  const auth = req.headers.authorization || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7).trim();
  return url.searchParams.get('token') || '';
}

function isAdmin(token) {
  return token && safeEqual(token, ADMIN_TOKEN);
}

function isAgent(token) {
  return isAdmin(token) || (AGENT_TOKEN && token && safeEqual(token, AGENT_TOKEN));
}

function send(res, status, body) {
  const payload = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': typeof body === 'string' ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(payload);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 64 * 1024) { reject(new Error('body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(new Error('invalid JSON body')); }
    });
    req.on('error', reject);
  });
}

function fullStatus() {
  return {
    effective: store.snapshot(),
    mode: store.data.mode,
    override: store.data.override,
    schedule: store.data.schedule,
    agents: store.agents,
    adguard: adguardStatus,
  };
}

// ---------- long-poll for agents ----------

const waiters = new Set();

store.on('change', (snap) => {
  console.log(`[state] blocked=${snap.blocked} reason=${snap.reason} version=${snap.version}`);
  for (const w of waiters) w(snap);
  waiters.clear();
  if (ADGUARD_ENABLED) syncAdguard();
});

function waitForChange(sinceVersion, waitSec, req) {
  return new Promise((resolve) => {
    if (!Number.isFinite(sinceVersion) || sinceVersion !== store.version || waitSec <= 0) {
      return resolve(store.snapshot());
    }
    const done = (snap) => { clearTimeout(timer); waiters.delete(done); resolve(snap); };
    const timer = setTimeout(() => done(store.snapshot()), waitSec * 1000);
    waiters.add(done);
    req.on('close', () => { clearTimeout(timer); waiters.delete(done); });
  });
}

// ---------- AdGuard sync (option 1) ----------

let syncing = false;
async function syncAdguard() {
  if (syncing) return;
  syncing = true;
  const blocked = store.effective.blocked;
  try {
    const { changed } = await adguard.applyBlocked(adguard.configFromEnv(), blocked);
    adguardStatus = { ok: true, lastSync: new Date().toISOString(), error: null, blocked };
    if (changed) console.log(`[adguard] rules updated: blocked=${blocked}`);
  } catch (err) {
    adguardStatus = { ok: false, lastSync: adguardStatus && adguardStatus.lastSync, error: err.message };
    console.error(`[adguard] sync failed: ${err.message}`);
  } finally {
    syncing = false;
    // The state might have changed while we were talking to AdGuard.
    if (blocked !== store.effective.blocked) syncAdguard();
  }
}

// ---------- routes ----------

async function handle(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const token = tokenFrom(req, url);
  const route = `${req.method} ${url.pathname.replace(/\/+$/, '') || '/'}`;

  switch (route) {
    case 'GET /':
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(indexHtml);

    case 'GET /healthz':
      return send(res, 200, { ok: true });

    // ----- agent endpoints -----
    case 'GET /api/agent/state': {
      if (!isAgent(token)) return send(res, 401, { error: 'unauthorized' });
      const since = Number(url.searchParams.get('since'));
      const wait = Math.min(Math.max(Number(url.searchParams.get('wait')) || 0, 0), MAX_WAIT_SEC);
      return send(res, 200, await waitForChange(since, wait, req));
    }
    case 'POST /api/agent/heartbeat': {
      if (!isAgent(token)) return send(res, 401, { error: 'unauthorized' });
      store.recordHeartbeat(await readJson(req));
      return send(res, 200, { ok: true });
    }
  }

  // ----- admin endpoints -----
  if (!url.pathname.startsWith('/api/')) return send(res, 404, { error: 'not found' });
  if (!isAdmin(token)) return send(res, 401, { error: 'unauthorized' });

  switch (route) {
    case 'GET /api/status':
      return send(res, 200, fullStatus());

    case 'POST /api/block':
    case 'POST /api/allow': {
      const body = await readJson(req);
      const minutes = body.minutes ?? url.searchParams.get('minutes') ?? undefined;
      store.setOverride(route === 'POST /api/block', minutes === undefined ? undefined : Number(minutes));
      return send(res, 200, fullStatus());
    }
    case 'POST /api/override': {
      const body = await readJson(req);
      store.setOverride(body.blocked, body.minutes);
      return send(res, 200, fullStatus());
    }
    case 'DELETE /api/override':
    case 'POST /api/auto':
      store.clearOverride();
      return send(res, 200, fullStatus());

    case 'POST /api/mode': {
      const body = await readJson(req);
      store.setMode(body.mode ?? url.searchParams.get('mode'));
      return send(res, 200, fullStatus());
    }
    case 'GET /api/schedule':
      return send(res, 200, store.data.schedule);

    case 'PUT /api/schedule':
      store.setSchedule(await readJson(req));
      return send(res, 200, fullStatus());

    case 'POST /api/adguard/sync':
      if (!ADGUARD_ENABLED) return send(res, 400, { error: 'ADGUARD_URL is not configured' });
      await syncAdguard();
      return send(res, 200, fullStatus());

    default:
      return send(res, 404, { error: 'not found' });
  }
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((err) => {
    if (!res.headersSent) send(res, 400, { error: err.message });
  });
});
server.requestTimeout = 0; // long-poll requests stay open up to MAX_WAIT_SEC
server.headersTimeout = 20_000;

setInterval(() => store.refresh(), TICK_MS).unref();
if (ADGUARD_ENABLED) {
  syncAdguard();
  // Periodic re-sync repairs manual edits in the AdGuard UI and restarts of AdGuard.
  setInterval(syncAdguard, ADGUARD_RESYNC_MS).unref();
}

server.listen(PORT, () => {
  console.log(`youtube-guard control server on :${PORT} (adguard sync: ${ADGUARD_ENABLED ? 'on' : 'off'})`);
  if (!AGENT_TOKEN) console.log('AGENT_TOKEN not set - agents must use the ADMIN_TOKEN');
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  });
}
