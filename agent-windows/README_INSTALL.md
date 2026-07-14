# AstreaBlue Monitoring Agent Installation

This is the Windows Endpoint Monitoring Agent for AstreaBlue ITSM.

Before production installation, create a strong `MONITORING_AGENT_TOKEN` environment variable in Railway. Enter that exact value when the installer prompts for the Agent Token. The installer stores it in the Git-ignored `agent-config.local.json`; never commit the production token to `agent-config.json`.

To prepare a new production token securely without printing it, run `prepare-production-token.ps1`. It saves the token in the ignored local configuration and copies it to the Windows clipboard so it can be pasted directly into Railway.

A device is online only when its heartbeat reaches the same backend and PostgreSQL database used by the web application. A localhost agent reports only to that laptop's local backend.

## Privacy & Security

**Privacy is our priority.** This agent is designed for compliance and transparency:
- No keylogging
- No password capture
- No webcam access
- No microphone access
- Screenshots are **disabled by default**. They can only be enabled via explicit company policy and server-side consent.
- Monitoring is controlled strictly by company policy and consent.

## Configuration Environments

* **Local development**: `backendUrl = http://YOUR-IP:5000` (Use your actual LAN IP, e.g., `http://192.168.1.100:5000`)
* **Railway production**: `backendUrl = https://backend-production-fc059.up.railway.app`

## Installation Steps

1. **Extract the ZIP file** to a local folder (e.g., `C:\AstreaBlue\Agent`).
2. Open the Start menu, search for **PowerShell**, right-click it, and select **Run as Administrator**.
3. Use the `cd` command to navigate to the extracted folder:
   ```powershell
   cd C:\Path\To\agent-windows
   ```
4. Run the installer script:
   ```powershell
   powershell -ExecutionPolicy Bypass -File .\install-agent.ps1
   ```
5. Follow the prompts to enter your `backendUrl` and `agentToken`.

## Testing the Installation

1. Open the **Endpoint Management** dashboard in AstreaBlue.
2. Verify the device appears as **Online**.
3. To test disconnection, you can stop the service:
   ```powershell
   powershell -ExecutionPolicy Bypass -File .\stop-agent.ps1
   ```
4. Verify the device becomes **Offline** in the dashboard after a short timeout.

## Troubleshooting

- **`package.json` missing**: Make sure you have extracted the ZIP and navigated into the `agent-windows` folder before running the script.
- **Wrong folder**: Ensure you are running the script from within the `agent-windows` folder, not outside it.
- **Localhost vs LAN IP**: If using local development, do not use `http://localhost:5000`. Use your machine's actual LAN IP so the endpoint agent can reach it.
- **Wrong agent token**: Double-check the token in `agent-config.json`.
- **Windows Firewall**: Make sure your network allows outbound traffic to the backend server.
- **Node.js missing**: Node.js LTS must be installed. Get it from [nodejs.org](https://nodejs.org).
