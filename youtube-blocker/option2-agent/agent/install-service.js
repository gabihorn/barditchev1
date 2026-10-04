'use strict';

// Registers the agent as a Windows service (runs as LocalSystem, starts with Windows,
// restarts automatically if it crashes). Run from an elevated (Administrator) prompt.

const path = require('path');
const fs = require('fs');
const { Service } = require('node-windows');

if (!fs.existsSync(path.join(__dirname, 'config.json'))) {
  console.error('config.json is missing - copy config.example.json to config.json and fill it in first.');
  process.exit(1);
}

const svc = new Service({
  name: 'YouTubeGuard',
  description: 'Blocks youtube.com (keeps youtubekids.com) according to the home control server.',
  script: path.join(__dirname, 'src', 'agent.js'),
  workingDirectory: __dirname,
  wait: 2,          // seconds before the first restart
  grow: 0.5,        // back-off growth between restarts
  maxRestarts: 1000,
});

svc.on('install', () => {
  console.log('Service installed, starting...');
  svc.start();
});
svc.on('alreadyinstalled', () => console.log('Service already installed. Run uninstall-service first to reinstall.'));
svc.on('start', () => console.log('Service started. Logs: ' + path.join(__dirname, 'logs')));
svc.on('error', (err) => console.error('Service error:', err));

svc.install();
