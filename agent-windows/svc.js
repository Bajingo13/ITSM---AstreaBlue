/**
 * svc.js — node-windows service installer / uninstaller
 *
 * Usage (run from this folder as Administrator):
 *   node svc.js install    — installs and starts the Windows Service
 *   node svc.js uninstall  — stops and removes the Windows Service
 *
 * Requires node-windows:
 *   npm install node-windows
 */

'use strict';

const path    = require('path');
const Service = require('node-windows').Service;

// ─── Configuration ────────────────────────────────────────────────────────────
const LOG_DIR = 'C:\\ProgramData\\AstreaBlue\\MonitoringAgent\\logs';

const svc = new Service({
  name:        'AstreaBlue Monitoring Agent',
  description: 'AstreaBlue ITSM consent-aware endpoint monitoring agent. Sends heartbeat and activity telemetry to the AstreaBlue backend.',
  script:      path.join(__dirname, 'service-wrapper.js'),

  // ── Working directory (so agent-config.json resolves correctly) ────────────
  workingDirectory: __dirname,

  // ── Log directory ──────────────────────────────────────────────────────────
  logpath: LOG_DIR,

  // ── Auto-restart on crash ──────────────────────────────────────────────────
  maxRestarts:   5,
  wait:          60,    // seconds before first restart attempt
  grow:          0.25,  // back-off multiplier per retry (25 % longer each time)
  abortOnError:  false, // keep trying to restart even after repeated failures

  // ── Run as Local System account (default, no password needed) ─────────────
  // To run under a specific account, set:
  //   nodeOptions: [],
  //   user: { domain: '.', account: 'YourAccount', password: 'YourPassword' }
});

const action = (process.argv[2] || '').toLowerCase();

if (action === 'install') {
  svc.on('install', () => {
    console.log('[AstreaBlue] Service installed. Starting...');
    svc.start();
  });
  svc.on('start', () => {
    console.log('[AstreaBlue] Service started. Device will appear Online in the dashboard shortly.');
  });
  svc.on('error', (err) => {
    console.error('[AstreaBlue] Service error during install:', err);
  });
  console.log('[AstreaBlue] Installing Windows Service...');
  console.log(`[AstreaBlue] Logs will be written to: ${LOG_DIR}`);
  svc.install();

} else if (action === 'uninstall') {
  svc.on('uninstall', () => {
    console.log('[AstreaBlue] Service uninstalled successfully.');
  });
  svc.on('error', (err) => {
    console.error('[AstreaBlue] Service error during uninstall:', err);
  });
  console.log('[AstreaBlue] Uninstalling Windows Service...');
  svc.uninstall();

} else {
  console.log('Usage: node svc.js install | uninstall');
  process.exit(1);
}
