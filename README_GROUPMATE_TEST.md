# Groupmate Laptop Monitoring Test

Each agent reports only to the backend in its own `agent-windows/agent-config.json`. A local backend and the Railway backend use separate databases, so their device lists are not automatically shared.

- `http://localhost:5000` writes to the local database.
- `https://backend-production-fc059.up.railway.app` writes to the Railway database.
- The SuperAdmin debug panel shows which backend/database source the current frontend is reading.

## Set up another Windows laptop

1. Copy the complete `agent-windows` folder to the other laptop.
2. Install a current Node.js LTS release.
3. Open PowerShell in the copied `agent-windows` folder.
4. Make sure the copied folder does not contain a `device.json`. The permanent UUID is generated separately on each laptop in `C:\ProgramData\AstreaBlue\device.json`.
5. Edit `agent-config.json`: set `backendUrl` to `https://backend-production-fc059.up.railway.app`, set `agentToken` to the same value as Railway's `MONITORING_AGENT_TOKEN`, optionally set a friendly unique `deviceName`, and keep `screenshotEnabled` as `false`.
6. Never commit or share the production agent token publicly.
7. Run `npm install`.
8. Run `node agent.js`.
9. Confirm the console shows a permanent Device UUID, Railway URL, device name, heartbeat endpoint, `Heartbeat SUCCESS`, and `Activity SUCCESS`.
10. Sign in to the Railway frontend as SuperAdmin and open **Laptop Activity Monitoring**. The laptop should appear as a separate Online device.
11. Stop with `Ctrl+C`. Once `last_seen_at` is more than 120 seconds old, refresh the page and verify it is Offline.

Renaming Windows, changing `deviceName`, or changing the assigned employee updates the same record because the backend identifies the laptop only by its permanent UUID.

## Local-only test

For the local database, use `"backendUrl": "http://localhost:5000"` and the local backend's `MONITORING_AGENT_TOKEN`. It appears only in a frontend connected to that same local backend.
