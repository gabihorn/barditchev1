'use strict';

// Windows Firewall rules (netsh). Two independent features:
//
// 1. DoH guard (recommended): blocks DNS-over-TLS (port 853) and the well known public
//    DNS-over-HTTPS servers, so browsers/apps cannot resolve youtube.com around the hosts file.
//
// 2. YouTube IP block (experimental, off by default): the firewall only understands IPs,
//    and youtube.com is served from the same Google front-end IPs as youtubekids.com,
//    Google Search, Gmail, etc. Blocking those IPs will usually break YouTube Kids too.
//    Use only if you want "no YouTube at all, Kids included" as a hard fallback.

const dns = require('dns').promises;
const { run } = require('./exec');

const PREFIX = 'YouTubeGuard';
const DOH_RULE = `${PREFIX}-DoH`;
const IP_RULE = `${PREFIX}-YouTubeIPs`;

const DOH_SERVERS = [
  '8.8.8.8', '8.8.4.4', '2001:4860:4860::8888', '2001:4860:4860::8844',          // Google
  '1.1.1.1', '1.0.0.1', '2606:4700:4700::1111', '2606:4700:4700::1001',          // Cloudflare
  '9.9.9.9', '149.112.112.112', '2620:fe::fe', '2620:fe::9',                       // Quad9
  '208.67.222.222', '208.67.220.220',                                              // OpenDNS
  '94.140.14.14', '94.140.15.15',                                                  // AdGuard DNS
  '45.90.28.0/24', '45.90.30.0/24',                                                // NextDNS
];

function netsh(args) {
  return run('netsh', ['advfirewall', 'firewall', ...args]);
}

async function ruleExists(name) {
  try {
    await netsh(['show', 'rule', `name=${name}`]);
    return true;
  } catch {
    return false; // netsh exits with 1 when no rule matches
  }
}

async function deleteRule(name) {
  if (await ruleExists(name)) await netsh(['delete', 'rule', `name=${name}`]);
}

async function addBlockRule(name, remoteIps, extra = []) {
  // Keep each rule's remoteip list short; netsh has a command-line length limit.
  for (let i = 0; i < remoteIps.length; i += 50) {
    await netsh(['add', 'rule', `name=${name}`, 'dir=out', 'action=block', 'enable=yes',
      `remoteip=${remoteIps.slice(i, i + 50).join(',')}`, ...extra]);
  }
}

async function applyDohGuard(enabled) {
  const exists = await ruleExists(DOH_RULE);
  if (!enabled) {
    if (exists) await deleteRule(DOH_RULE);
    return;
  }
  if (exists) return;
  await addBlockRule(DOH_RULE, DOH_SERVERS, ['protocol=TCP', 'remoteport=443,853']);
  await addBlockRule(DOH_RULE, DOH_SERVERS, ['protocol=UDP', 'remoteport=443,853']);
  await netsh(['add', 'rule', `name=${DOH_RULE}`, 'dir=out', 'action=block', 'enable=yes', 'protocol=TCP', 'remoteport=853']);
}

async function resolveAll(domains) {
  // Use public resolvers directly: the local resolver returns 0.0.0.0 while the hosts block is on.
  const resolver = new dns.Resolver({ timeout: 3000, tries: 2 });
  resolver.setServers(['8.8.8.8', '1.1.1.1']);
  const ips = new Set();
  for (const d of domains) {
    for (const fn of ['resolve4', 'resolve6']) {
      try {
        for (const ip of await resolver[fn](d)) ips.add(ip);
      } catch { /* domain may have no A/AAAA */ }
    }
  }
  return [...ips].sort();
}

const RESOLVE_EVERY_MS = 10 * 60_000;
let lastIpSet = '';
let lastResolveAt = 0;
async function applyYoutubeIps(blocked, domains) {
  if (!blocked) {
    lastIpSet = '';
    await deleteRule(IP_RULE);
    return;
  }
  if (lastIpSet && Date.now() - lastResolveAt < RESOLVE_EVERY_MS && (await ruleExists(IP_RULE))) return;
  const ips = await resolveAll(domains);
  lastResolveAt = Date.now();
  if (!ips.length) throw new Error('could not resolve any YouTube IPs');
  const key = ips.join(',');
  if (key === lastIpSet && (await ruleExists(IP_RULE))) return;
  await deleteRule(IP_RULE);
  await addBlockRule(IP_RULE, ips);
  lastIpSet = key;
}

module.exports = { applyDohGuard, applyYoutubeIps, ruleExists, DOH_RULE, IP_RULE };
