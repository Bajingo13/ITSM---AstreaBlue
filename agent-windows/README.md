# AstreaBlue Windows Monitoring Agent

Requires Node.js 18 or newer on Windows. Edit `agent-config.json`, then run `npm start` from this folder.

The agent creates a permanent device UUID in `C:\ProgramData\AstreaBlue\device.json`, then sends heartbeat, foreground application/window-title samples, and idle duration. Hostname and friendly-name changes update the same UUID-backed device. It does not collect keystrokes, passwords, microphone audio, or camera data. Screenshot capture is disabled by default and requires server-side consent.

Use a dedicated high-entropy token that matches the backend `MONITORING_AGENT_TOKEN`. Restrict access to `agent-config.json` because it contains that credential.
