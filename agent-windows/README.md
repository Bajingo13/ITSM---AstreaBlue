# AstreaBlue Windows Monitoring Agent MVP

Requires Node.js 18 or newer on Windows. Edit `agent-config.json`, then run `npm start` from this folder.

The agent sends a hostname heartbeat, foreground application/window-title samples, and idle duration. It does not collect keystrokes, passwords, microphone audio, or camera data. Screenshot capture is disabled by default, stays visible in console output, and performs a server-side consent preflight before any local capture begins.

Use a dedicated high-entropy token that matches the backend `MONITORING_AGENT_TOKEN`. Restrict access to `agent-config.json` because it contains that credential.
