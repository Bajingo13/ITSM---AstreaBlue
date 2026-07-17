# AstreaBlue Windows Agent Delivery Tracker

Updated: 2026-07-17

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
- [x] Consent/policy-gated native screenshot capture in the interactive companion
- [x] Visible Windows notification before each screenshot
- [x] Per-device authenticated screenshot upload through the Windows service
- [x] AES-256-GCM encryption before private Cloudflare R2 storage
- [x] Authenticated, RBAC-scoped screenshot viewing with integrity verification
- [x] Configurable screenshot interval and automatic retention deletion
- [x] Automated retention test verifies R2 object deletion, metadata removal, and audit recording
- [x] Validate screenshot notification, capture, encrypted storage, and viewing on the first pilot laptop
- [ ] Validate screenshot capture across restart and repair on the second pilot laptop
- [x] Consent/policy-gated native USB insertion/removal collector
- [x] USB write-transfer metadata collector (file contents are never collected)
- [x] Server-authoritative DLP risk scoring and matched-rule audit data
- [x] RBAC/branch-scoped USB and DLP operations dashboard
- [x] High/Critical DLP alerts and policy-controlled automatic incident creation
- [x] Automated critical-transfer test verifies DLP alert, `DLP-` P1 ticket creation, and endpoint source metadata
- [x] Offline-safe USB event queue with idempotent batch ingestion
- [x] Validate USB insertion, removal, and file-write detection on the first pilot laptop
- [ ] Validate USB monitoring across a Windows restart on the first pilot laptop
- [ ] Validate DLP alert and optional automatic incident creation on the testing laptop

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

- [x] Deploy the native package to at least one pilot laptop
- [x] Verify enrollment, online state, diagnostics, and repair
- [ ] Verify Windows restart and uninstall behavior on a pilot laptop
- [ ] Migrate remaining pilot laptops in controlled batches
- [ ] Confirm every active laptop uses a unique device credential
- [ ] Remove `MONITORING_AGENT_TOKEN` from Railway
- [ ] Remove legacy global-token support from the backend

## Acceptance rule

Do not retire the Node pilot or global token until the native agent has passed a physical-laptop restart test and every deployed laptop shows recent `credential_last_seen_at` activity.
