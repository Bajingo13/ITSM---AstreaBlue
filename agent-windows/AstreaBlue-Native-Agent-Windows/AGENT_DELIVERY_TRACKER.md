# AstreaBlue Windows Agent Delivery Tracker

Updated: 2026-07-14

## P0 — Secure enrollment foundation

- [x] Short-lived, single-use enrollment codes
- [x] Admin/SuperAdmin enrollment-code UI
- [x] Unique credential per laptop
- [x] Hashed credentials in PostgreSQL
- [x] Credential rotation and revocation APIs
- [x] Credential-to-device binding
- [x] Enrollment security audit records
- [x] Existing device identity and monitoring history preserved
- [x] Temporary legacy global-token compatibility for pilot migration
- [x] Automated enrollment isolation and RBAC tests

## P1 — Native Windows service

- [x] Native .NET Windows service source
- [x] Permanent machine UUID under ProgramData
- [x] DPAPI LocalMachine-protected device credential
- [x] Single-instance mutex
- [x] Automatic startup as LocalSystem Windows service
- [x] Heartbeat starts at Windows service startup
- [x] One-time enrollment command
- [x] Standalone EXE build; Node.js is not required on target laptops
- [x] Automated enrollment, DPAPI-at-rest, policy, heartbeat, hardware, and software smoke test
- [ ] Validate the native EXE on a second physical pilot laptop
- [x] Native policy synchronization
- [x] Native hardware and software inventory parity
- [x] Consent-aware, credential-free user-session companion for activity monitoring

## P2 — Installation and support lifecycle

- [x] Native install script
- [x] Repair script
- [x] Diagnostics command and diagnostics script
- [x] Uninstall script preserves identity/history by default
- [x] Optional full local-data purge
- [x] ZIP packaging script
- [ ] Code-sign the EXE and scripts with a trusted company certificate
- [ ] Produce a signed MSI installer

## P3 — Reliability and updates

- [x] Service recovery configuration after crashes
- [x] Local rotating log files
- [x] Configurable heartbeat interval
- [x] Signed update verification, pilot/stable channels, staged replacement, and automatic rollback framework
- [ ] Production signed-update manifest/download endpoint
- [ ] Staged update channels: pilot, stable
- [ ] Automatic rollback after failed update/health check
- [ ] Central agent-version compliance dashboard

## P4 — Pilot migration and legacy retirement

- [ ] Deploy the native package to one test laptop
- [ ] Verify enrollment, online state, restart, repair, and uninstall
- [ ] Migrate remaining pilot laptops in controlled batches
- [ ] Confirm every active laptop uses a unique device credential
- [ ] Remove `MONITORING_AGENT_TOKEN` from Railway
- [ ] Remove legacy global-token support from the backend

## Acceptance rule

Do not retire the Node pilot or global token until the native agent has passed a physical-laptop restart test and every deployed laptop shows recent `credential_last_seen_at` activity.
