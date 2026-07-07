# AstreaBlue Monitoring Agent — Company Deployment Guide

> **Version:** 1.1.0 · **Platform:** Windows 10 / 11 (64-bit) · **Requires:** Node.js ≥ 18

---

## Table of Contents

1. [Overview](#overview)
2. [Prerequisites](#prerequisites)
3. [Files in This Package](#files-in-this-package)
4. [Step-by-Step Installation](#step-by-step-installation)
5. [Configuration Reference](#configuration-reference)
6. [Setting the Agent Token](#setting-the-agent-token)
7. [Installing as a Windows Service](#installing-as-a-windows-service)
8. [Verifying the Device is Online](#verifying-the-device-is-online)
9. [Starting and Stopping the Service](#starting-and-stopping-the-service)
10. [Uninstalling the Agent](#uninstalling-the-agent)
11. [Log Files](#log-files)
12. [Troubleshooting](#troubleshooting)
13. [Privacy & Compliance Notes](#privacy--compliance-notes)
14. [FAQ](#faq)

---

## Overview

The AstreaBlue Monitoring Agent runs silently in the background on company Windows laptops. It:

- Sends a **heartbeat** to the AstreaBlue backend at a configurable interval (default: every 60 seconds)
- Reports the **foreground application name, window title, and idle duration** at a configurable interval
- Marks the device **Online / Offline** in the AstreaBlue dashboard automatically
- Operates as a **Windows Service** — starts automatically when Windows boots, restarts itself on crash

What it **does NOT** collect:
- ❌ Keystrokes or typed text
- ❌ Passwords or clipboard contents
- ❌ Microphone audio
- ❌ Webcam / camera data
- ❌ Screenshots (unless explicitly enabled **and** granted server-side consent per device)

---

## Prerequisites

| Requirement | Minimum Version | Notes |
|-------------|----------------|-------|
| Windows | 10 or 11 (64-bit) | Windows Server 2019+ also supported |
| Node.js | **18.x or newer** | Download: https://nodejs.org/en/download |
| npm | comes with Node.js | |
| Permissions | **Local Administrator** | Required to install the Windows Service only |

**To check your Node.js version:**
```powershell
node --version
```

---

## Files in This Package

```
agent-windows\
├── agent.js                 ← Main agent logic (heartbeat, activity, optional screenshot)
├── service-wrapper.js       ← Thin entry-point used by the Windows Service
├── svc.js                   ← node-windows install/uninstall script
├── agent-config.json        ← Configuration (edit this before installing)
├── package.json             ← npm metadata and dependencies
│
├── install-service.ps1      ← Run as Admin: installs and starts the service
├── uninstall-service.ps1    ← Run as Admin: stops and removes the service
├── start-service.ps1        ← Run as Admin: starts the service
├── stop-service.ps1         ← Run as Admin: stops the service
│
└── README_DEPLOYMENT.md     ← This file
```

---

## Step-by-Step Installation

### Step 1 — Copy agent files to the laptop

Copy the entire `agent-windows` folder to a permanent location on the target laptop. Recommended path:

```
C:\Program Files\AstreaBlue\MonitoringAgent\
```

> **Important:** Do not place the folder on a network drive or removable storage. The service needs the files to be available at boot time.

---

### Step 2 — Install Node.js (if not already installed)

1. Download from https://nodejs.org/en/download — choose the **Windows Installer (.msi)** LTS version
2. Run the installer and follow the prompts
3. Open PowerShell and verify: `node --version`

---

### Step 3 — Configure the agent

Open `agent-config.json` in Notepad or any text editor:

```json
{
  "backendUrl": "https://backend-production-fc059.up.railway.app",
  "agentToken": "replace-with-your-production-token",
  "deviceName": "",
  "heartbeatIntervalSeconds": 60,
  "activityIntervalSeconds": 60,
  "screenshotEnabled": false
}
```

| Field | Description |
|-------|-------------|
| `backendUrl` | **Do not change.** This is the production Railway backend URL. |
| `agentToken` | **Replace this.** See [Setting the Agent Token](#setting-the-agent-token) below. |
| `deviceName` | Leave empty to use the computer's hostname automatically, or enter a custom name (e.g. `"LAPTOP-HR-001"`). |
| `heartbeatIntervalSeconds` | How often (seconds) to send a heartbeat. Minimum: 30. Default: 60. |
| `activityIntervalSeconds` | How often (seconds) to send an activity sample. Minimum: 30. Default: 60. |
| `screenshotEnabled` | **Keep as `false`.** Screenshots require IT team approval and explicit server-side consent per device. |

**Save the file** after editing.

On first start, the agent generates a permanent UUID in `C:\ProgramData\AstreaBlue\device.json`. Do not delete or copy this file between laptops. The backend identifies the physical laptop by this UUID, so renaming Windows or changing `deviceName` updates the existing device instead of creating another one.

The configured backend is the data destination: `http://localhost:5000` uses the local database, while `https://backend-production-fc059.up.railway.app` uses the Railway database. Their device lists are separate.

---

### Step 4 — Install the Windows Service

Open **PowerShell as Administrator** (right-click PowerShell → Run as Administrator), navigate to the agent folder, and run:

```powershell
Set-Location "C:\Program Files\AstreaBlue\MonitoringAgent"
.\install-service.ps1
```

This script will:
1. Verify Node.js ≥ 18 is installed
2. Validate your `agent-config.json`
3. Install the `node-windows` npm package
4. Register **AstreaBlue Monitoring Agent** as a Windows Service
5. Start the service immediately

> If you see a message about execution policy, run:
> ```powershell
> Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
> ```
> Then re-run `.\install-service.ps1`.

---

## Configuration Reference

### backendUrl

Production Railway backend:
```
https://backend-production-fc059.up.railway.app
```

For local development / testing, change to:
```
http://localhost:5000
```

---

## Setting the Agent Token

The `agentToken` is a shared secret between the agent and the backend. It must match the `MONITORING_AGENT_TOKEN` environment variable set in your Railway backend deployment.

**To find or set the token on Railway:**

1. Go to https://railway.app → your project → the backend service
2. Click **Variables** tab
3. Find or set: `MONITORING_AGENT_TOKEN=your-secure-token-here`
4. Use the **same value** in `agent-config.json` on every laptop

> **Security:** The agent token is stored in `agent-config.json`. Restrict file system access to this file to Administrators only:
> ```powershell
> icacls "agent-config.json" /inheritance:r /grant Administrators:F /deny Users:R
> ```

**Generate a strong token** (run in PowerShell):
```powershell
[System.Convert]::ToBase64String([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
```

---

## Installing as a Windows Service

The service is installed by `install-service.ps1` (see Step 4 above).

**What the service does:**
- **Service name:** `AstreaBlue Monitoring Agent`
- **Startup type:** Automatic — starts when Windows boots
- **Crash recovery:** Automatically restarts after 60 seconds if the agent process exits unexpectedly (up to 5 restarts)
- **Run account:** Local System (no password required)
- **Log directory:** `C:\ProgramData\AstreaBlue\MonitoringAgent\logs\`

**Verify the service is installed:**
```powershell
Get-Service -Name "AstreaBlue*"
```

Expected output:
```
Status   Name                           DisplayName
------   ----                           -----------
Running  AstreaBlueMonitoringAgent      AstreaBlue Monitoring Agent
```

---

## Verifying the Device is Online

After the service starts:

1. Log in to **AstreaBlue** at https://backend-production-fc059.up.railway.app (or your frontend URL)
2. Navigate to **Endpoint Monitoring** or **Asset Monitoring → Monitored Devices**
3. The device (using its hostname or custom `deviceName`) should appear with status **Online** within **2 minutes**

If the device does not appear:
- Check the log files (see [Log Files](#log-files))
- Verify the `agentToken` matches the Railway `MONITORING_AGENT_TOKEN`
- Verify network connectivity: `Test-NetConnection backend-production-fc059.up.railway.app -Port 443`

---

## Starting and Stopping the Service

All scripts must be run as Administrator.

```powershell
# Start the service
.\start-service.ps1

# Stop the service
.\stop-service.ps1

# Restart (stop then start)
.\stop-service.ps1; Start-Sleep 3; .\start-service.ps1
```

Or use Windows Services Manager (`services.msc`) — search for **AstreaBlue Monitoring Agent**.

After stopping, the device status changes to **Offline** when its last heartbeat is more than 120 seconds old. Refresh the dashboard to trigger an immediate status check.

---

## Uninstalling the Agent

Run as Administrator:

```powershell
Set-Location "C:\Program Files\AstreaBlue\MonitoringAgent"
.\uninstall-service.ps1
```

Then optionally delete the agent files:
```powershell
Remove-Item -Recurse -Force "C:\Program Files\AstreaBlue\MonitoringAgent"
```

Log files are retained at `C:\ProgramData\AstreaBlue\MonitoringAgent\logs\`. Delete manually if no longer needed:
```powershell
Remove-Item -Recurse -Force "C:\ProgramData\AstreaBlue\MonitoringAgent"
```

---

## Log Files

Log files are written to:
```
C:\ProgramData\AstreaBlue\MonitoringAgent\logs\
```

| File | Contents |
|------|----------|
| `agent-YYYY-MM-DD.log` | Daily rotating agent log — heartbeat/activity success and failures |
| `AstreaBlue Monitoring Agent.log` | node-windows service wrapper log |
| `AstreaBlue Monitoring Agent_errors.log` | Service-level errors from node-windows |

**View today's log:**
```powershell
Get-Content "C:\ProgramData\AstreaBlue\MonitoringAgent\logs\agent-$(Get-Date -Format 'yyyy-MM-dd').log" -Tail 50
```

**Watch logs live:**
```powershell
Get-Content "C:\ProgramData\AstreaBlue\MonitoringAgent\logs\agent-$(Get-Date -Format 'yyyy-MM-dd').log" -Wait -Tail 20
```

---

## Troubleshooting

### Service installs but device never appears Online

1. Check the log for errors:
   ```powershell
   Get-Content "C:\ProgramData\AstreaBlue\MonitoringAgent\logs\agent-$(Get-Date -Format 'yyyy-MM-dd').log"
   ```
2. Look for `Heartbeat FAILED` lines
3. Common cause: wrong `agentToken` → `401 Invalid monitoring agent token`
4. Common cause: firewall blocking HTTPS → test connectivity:
   ```powershell
   Test-NetConnection backend-production-fc059.up.railway.app -Port 443
   ```

### node svc.js install fails with "Access Denied"

Run PowerShell **as Administrator**.

### PowerShell execution policy error

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
```

### Service starts then immediately stops

Check `C:\ProgramData\AstreaBlue\MonitoringAgent\logs\AstreaBlue Monitoring Agent_errors.log`.
Most common cause: `agent-config.json` has an invalid `agentToken` (still starts with `replace-`).

### How to run manually for testing

Without installing the service:
```powershell
Set-Location "C:\Program Files\AstreaBlue\MonitoringAgent"
node agent.js
```
Press `Ctrl+C` to stop. This is useful for validating config before installing as a service.

---

## Privacy & Compliance Notes

> **This section should be shared with employees before deploying the agent on their devices.**

### What is collected

| Data Point | Collected? | Notes |
|-----------|-----------|-------|
| Foreground application name | ✅ Yes | e.g. `chrome`, `excel`, `slack` |
| Active window title | ✅ Yes | e.g. "Budget Report - Excel" |
| Idle time (seconds) | ✅ Yes | Time since last keyboard/mouse input |
| Device heartbeat (permanent UUID and hostname) | ✅ Yes | Confirms the laptop is powered on and connected without using hostname as identity |
| Keystrokes / typed text | ❌ No | Never collected |
| Passwords | ❌ No | Never collected |
| Clipboard contents | ❌ No | Never collected |
| Microphone audio | ❌ No | Never collected |
| Webcam / camera | ❌ No | Never collected |
| Screenshots | ❌ No (default) | Requires IT to enable AND explicit server-side consent per device |
| Browsing history | ❌ No | URL domain sampling is possible but not enabled by default |
| File contents | ❌ No | Never collected |
| GPS / location | ❌ No | Never collected |

### Legal basis

Monitoring is performed on company-owned equipment for legitimate business interests (IT asset management, productivity, compliance). Employees should be informed of this monitoring policy before the agent is deployed.

In jurisdictions requiring explicit consent (e.g. Philippines RA 10173 / GDPR), ensure your HR and Legal teams have:
- Added endpoint monitoring disclosure to the Employment Agreement or IT Acceptable Use Policy
- Provided employees with a copy of this data collection summary
- Obtained signed consent where legally required

### Data retention

Activity logs are stored in the AstreaBlue backend database (Railway PostgreSQL). Consult your data retention policy for how long logs are kept. Logs can be purged from the database by an administrator.

### Screenshot policy

Screenshots are **disabled by default** (`screenshotEnabled: false`). If your organization decides to enable screenshots:
1. IT must set `screenshotEnabled: true` in `agent-config.json`
2. An administrator must grant explicit server-side consent per device in the AstreaBlue dashboard
3. Employees must be notified in writing before screenshots begin

---

## FAQ

**Q: Will employees know the agent is running?**
A: The agent runs as a background Windows Service with no visible UI. IT should disclose its presence through the company's Acceptable Use Policy.

**Q: Can an employee disable the agent?**
A: Standard users cannot stop or uninstall Windows Services. Administrator credentials are required.

**Q: Does the agent work when the VPN is off?**
A: Yes, as long as the laptop has internet access. The backend is hosted on Railway (public HTTPS).

**Q: What happens if the backend is unreachable?**
A: The agent logs a failure for that interval and automatically retries on the next heartbeat cycle. No data is cached or queued locally.

**Q: Can the agent be deployed via GPO or SCCM?**
A: Yes. The PowerShell scripts are compatible with Group Policy Software Installation and SCCM/Intune deployment. Use `install-service.ps1` as the install script with Administrator context.

**Q: How do I update the agent to a new version?**
A: 1) Stop the service (`stop-service.ps1`), 2) Replace `agent.js` and `service-wrapper.js`, 3) Start the service (`start-service.ps1`). No reinstall required for minor updates.
