'use strict';

// youtube-guard Windows agent.
// Long-polls the control server for the desired state and enforces it locally
// (hosts file and/or Windows Firewall). Runs as a Windows service (LocalSystem) via node-windows.

const fs = require('fs');
const os = require('os');
const path = require('path');
const log = require('./log');
const hosts = require('./hosts');
const firewall = require('./firewall');
const policies = require('./policies');
const { run } = require('./exec');

const ROOT = path.join(__dirname, '..');
const CONFIG_FILE = process.env.YTG_CONFIG || path.join(ROOT, 'config.json');
const CACHE_FILE = path.join(ROOT, 'state-cache.json');

const DEFAULTS = {
  serverUrl: '',
  agentToken: '',
  agentId: os.hostname(),
  method: 'hosts',               // hosts | firewall | both
  dohGuard: true,                // firewall rules against public DoH/DoT resolvers
  enforceBrowserPolicies: true,  // registry policies that disable browser DoH
  longPollSeconds: 25,
  retrySeconds: 10,
  enforceSeconds: 30,            // re-apply periodically (repairs manual edits of the hosts file)
  heartbeatSeconds: 60,
  offlineFallback: 'last',       // last | block | allow - what to do while the server is unreachable
  killBrowsersOnBlock: false,    // close browsers when switching to blocked (cuts open YouTube tabs)
  browsers: ['chrome.exe', 'msedge.exe', 'firefox.exe', 'brave.exe', 'opera.exe'],
  blockDomains: hosts.DEFAULT_DOMAINS,
};

function loadConfig() {
  const cfg = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8').replace(/^\uFEFF/, '')) };
  if (!/^https?:\/\//.test(cfg.serverUrl)) throw new Error('config.serverUrl must be an http(s) URL');
  if (!cfg.agentToken) throw new Error('config.agentToken is required');
  if (!['hosts', 'firewall', 'both'].includes(cfg.method)) throw new Error('config.method must be hosts | firewall | both');
  if (!['last', 'block', 'allow'].includes(cfg.offlineFallback)) throw new Error('config.offlineFallback must be last | block | allow');
  cfg.longPollSeconds = Math.min(Math.max(Number(cfg.longPollSeconds) || 25, 0), 55);
  return cfg;
}

function loadCache() {
  try {
    return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function saveCache(data) {
  try {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(data));
  } catch (err) {
    log.warn(`cannot write cache: ${err.message}`);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------- state ----------------

let cfg;
try {
  cfg = loadConfig();
} catch (err) {
  log.error(`invalid config (${CONFIG_FILE}): ${err.message}`);
  process.exit(1);
}
const useHosts = cfg.method === 'hosts' || cfg.method === 'both';
const useFirewall = cfg.method === 'firewall' || cfg.method === 'both';

const cache = loadCache();
let desired = typeof cache.blocked === 'boolean' ? cache.blocked : null; // last state received from the server
let version = cache.version ?? null;
let online = null;
let target = null;   // state currently being enforced
let applied = null;  // state last applied successfully
let lastError = null;

function fallbackState() {
  if (cfg.offlineFallback === 'block') return true;
  if (cfg.offlineFallback === 'allow') return false;
  return desired ?? true; // fail closed when nothing is known yet
}

// ---------------- enforcement ----------------

async function killBrowsers() {
  for (const exe of cfg.browsers) {
    await run('taskkill', ['/F', '/IM', exe]).catch(() => {});
  }
}

async function doEnforce(blocked) {
  target = blocked;
  let changed = false;
  if (useHosts) changed = (await hosts.apply(blocked, cfg.blockDomains)) || changed;
  if (useFirewall) await firewall.applyYoutubeIps(blocked, cfg.blockDomains);

  if (changed || applied !== blocked) {
    await run('ipconfig', ['/flushdns']).catch((e) => log.warn(e.message));
    if (blocked && applied === false && cfg.killBrowsersOnBlock) await killBrowsers();
    log.info(`applied: ${blocked ? 'BLOCKED' : 'ALLOWED'} (method=${cfg.method})`);
    applied = blocked;
    heartbeat();
  }
  lastError = null;
}

let chain = Promise.resolve();
function enforce(blocked) {
  chain = chain
    .then(() => doEnforce(blocked))
    .catch((err) => {
      lastError = err.message;
      log.error(`enforce failed: ${err.message}`);
    });
  return chain;
}

// ---------------- server communication ----------------

async function heartbeat() {
  try {
    await fetch(new URL('/api/agent/heartbeat', cfg.serverUrl), {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.agentToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: cfg.agentId, hostname: os.hostname(), applied, method: cfg.method, error: lastError }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch { /* the poll loop reports connectivity problems */ }
}

async function pollLoop() {
  for (;;) {
    const started = Date.now();
    try {
      const url = new URL('/api/agent/state', cfg.serverUrl);
      url.searchParams.set('wait', String(cfg.longPollSeconds));
      if (version !== null) url.searchParams.set('since', String(version));
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${cfg.agentToken}` },
        signal: AbortSignal.timeout((cfg.longPollSeconds + 15) * 1000),
      });
      if (res.status === 401) throw new Error('unauthorized - check agentToken');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const s = await res.json();

      if (online !== true) log.info('connected to control server');
      online = true;
      const changed = s.version !== version || s.blocked !== desired;
      if (changed) {
        log.info(`server state: blocked=${s.blocked} reason=${s.reason}${s.until ? ` until=${s.until}` : ''}`);
        desired = s.blocked;
        version = s.version;
        saveCache({ blocked: desired, version });
      }
      if (changed || target !== desired) await enforce(desired);
      // Protects against a tight loop if a proxy answers long-polls immediately.
      if (!changed && Date.now() - started < 1000) await sleep(1000);
    } catch (err) {
      if (online !== false) log.warn(`control server unreachable: ${err.message}`);
      online = false;
      lastError = `server: ${err.message}`;
      const fb = fallbackState();
      if (target !== fb) await enforce(fb);
      await sleep(cfg.retrySeconds * 1000);
    }
  }
}

// ---------------- startup ----------------

async function main() {
  log.info(`youtube-guard agent starting (id=${cfg.agentId}, server=${cfg.serverUrl}, method=${cfg.method})`);

  if (cfg.enforceBrowserPolicies) {
    await policies.enforceBrowserPolicies().catch((e) => log.warn(`browser policies: ${e.message}`));
  }
  await firewall.applyDohGuard(cfg.dohGuard).catch((e) => log.warn(`DoH guard: ${e.message}`));
  // Clean up leftovers if the method was changed in the config.
  if (!useHosts) await hosts.apply(false).catch((e) => log.warn(e.message));
  if (!useFirewall) await firewall.applyYoutubeIps(false).catch(() => {});

  // Enforce the last known state right away, before the server answers.
  await enforce(fallbackState());

  setInterval(() => target !== null && enforce(target), cfg.enforceSeconds * 1000);
  setInterval(heartbeat, cfg.heartbeatSeconds * 1000);
  pollLoop();
}

process.on('uncaughtException', (err) => {
  log.error(`uncaught: ${err.stack || err.message}`);
  process.exit(1); // the service wrapper restarts the agent
});
process.on('unhandledRejection', (err) => log.error(`unhandled rejection: ${err && (err.stack || err.message)}`));

main().catch((err) => {
  log.error(`fatal: ${err.stack || err.message}`);
  process.exit(1);
});
