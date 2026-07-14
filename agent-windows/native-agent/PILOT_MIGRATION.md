# Native Agent Pilot Migration

## Preconditions

- Deploy the enrollment migration and backend routes to Railway.
- Deploy the Endpoint Administration frontend.
- Keep `MONITORING_AGENT_TOKEN` configured during the pilot.
- Do not delete existing laptop records, consent records, or `C:\ProgramData\AstreaBlue\device.json`.

## First physical-laptop test

1. Choose one non-critical Windows laptop currently visible in Endpoint Management.
2. Create a 15-minute code in **Endpoint Management → Administration**, restricted to that laptop's hostname.
3. Copy `AstreaBlue-Native-Agent-Windows.zip` to the laptop and extract it.
4. Open PowerShell as Administrator and run `native-install.ps1`.
5. Confirm `Get-Service AstreaBlueMonitoringAgent` reports `Running` and `Automatic`.
6. Run `native-diagnostics.ps1`; require `"healthy":true` and `"heartbeat":"success"`.
7. Confirm the existing AstreaBlue device record—not a duplicate—shows Online and a recent credential heartbeat.
8. Restart Windows. Confirm the service and Online state return without any user signing in.
9. Run `native-repair.ps1`, then repeat diagnostics.
10. Run `native-uninstall.ps1`, confirm the service is removed, then reinstall with a new one-time code and verify the same device identity is retained.

## Rollback

The native installer does not delete the old Node-agent files or the permanent pilot identity. If the native pilot fails:

1. Run `native-uninstall.ps1` without `-PurgeIdentity`.
2. Run the existing Node pilot installer with the temporary migration token.
3. Confirm heartbeats return before investigating the native logs under `C:\ProgramData\AstreaBlue\MonitoringAgent\logs`.

## Legacy-token retirement gate

Remove `MONITORING_AGENT_TOKEN` from Railway and remove backend legacy-token support only after every deployed laptop has passed restart testing and reports recent `credential_last_seen_at` activity. Retire the token in one controlled release so rollback remains available until the final migration is accepted.
