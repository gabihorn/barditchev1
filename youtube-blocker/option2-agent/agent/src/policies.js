'use strict';

// Browser policies that turn off the browser's own DNS-over-HTTPS, so the hosts file is honored.
const { run } = require('./exec');

const POLICIES = [
  ['HKLM\\SOFTWARE\\Policies\\Google\\Chrome', 'DnsOverHttpsMode', 'REG_SZ', 'off'],
  ['HKLM\\SOFTWARE\\Policies\\Microsoft\\Edge', 'DnsOverHttpsMode', 'REG_SZ', 'off'],
  ['HKLM\\SOFTWARE\\Policies\\BraveSoftware\\Brave', 'DnsOverHttpsMode', 'REG_SZ', 'off'],
  ['HKLM\\SOFTWARE\\Policies\\Mozilla\\Firefox\\DNSOverHTTPS', 'Enabled', 'REG_DWORD', '0'],
  ['HKLM\\SOFTWARE\\Policies\\Mozilla\\Firefox\\DNSOverHTTPS', 'Locked', 'REG_DWORD', '1'],
];

async function enforceBrowserPolicies() {
  for (const [key, name, type, value] of POLICIES) {
    await run('reg', ['add', key, '/v', name, '/t', type, '/d', value, '/f']);
  }
}

async function removeBrowserPolicies() {
  for (const [key, name] of POLICIES) {
    await run('reg', ['delete', key, '/v', name, '/f']).catch(() => {});
  }
}

module.exports = { enforceBrowserPolicies, removeBrowserPolicies };
