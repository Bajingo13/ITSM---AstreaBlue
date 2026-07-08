/**
 * AstreaBlue Monitoring Agent — Windows Service Wrapper
 *
 * This file is the entry point used by node-windows (via svc.js) to run the
 * agent as a Windows Service. It simply requires the real agent logic.
 *
 * The service wrapper handles:
 *  - Automatic startup when Windows starts
 *  - Automatic restart after crashes (node-windows default: 60 s delay)
 *  - Logging to:  C:\ProgramData\AstreaBlue\MonitoringAgent\logs\
 *
 * Do NOT run this file directly — use install-service.ps1 / start-service.ps1.
 * To run manually (dev / troubleshoot): node agent.js
 */

require('./agent.js');
