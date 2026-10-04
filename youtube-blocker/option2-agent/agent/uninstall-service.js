'use strict';

// Removes the service and cleans up everything the agent added
// (hosts entries, firewall rules, browser policies).

const path = require('path');
const { Service } = require('node-windows');
const hosts = require('./src/hosts');
const firewall = require('./src/firewall');
const policies = require('./src/policies');
const { run } = require('./src/exec');

const svc = new Service({ name: 'YouTubeGuard', script: path.join(__dirname, 'src', 'agent.js') });

async function cleanup() {
  await hosts.apply(false);
  await firewall.applyYoutubeIps(false);
  await firewall.applyDohGuard(false);
  await policies.removeBrowserPolicies();
  await run('ipconfig', ['/flushdns']).catch(() => {});
  console.log('hosts entries, firewall rules and browser policies removed.');
}

svc.on('uninstall', () => {
  console.log('Service removed.');
  cleanup().catch((err) => console.error('cleanup failed:', err.message));
});
svc.on('alreadyuninstalled', () => {
  console.log('Service was not installed.');
  cleanup().catch((err) => console.error('cleanup failed:', err.message));
});

svc.uninstall();
