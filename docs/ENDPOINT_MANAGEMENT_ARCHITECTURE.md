# AstreaBlue Endpoint Management Architecture

Endpoint Management is the parent module for company-managed endpoint registration, inventory, monitoring, compliance, and security operations.

## Responsibilities

- Endpoint Discovery and Registration
- Endpoint Hardware Inventory
- Endpoint Software Inventory
- Asset Reconciliation and Verification
- Employee Assignment
- Consent and Privacy Compliance
- Endpoint Policy Preparation
- Activity Monitoring
- Screenshot Monitoring
- USB and Device Control
- Browser Monitoring
- Endpoint Health
- Alerts and Automatic Incident Creation
- Audit Logs

## Integrations

- Asset Management: hardware asset linking, assigned employee, branch, department, reconciliation.
- Service Desk: automatic incident creation from endpoint alerts.
- Consent Management: privacy lifecycle and policy activation.
- Knowledge Base: recommended fixes and operator guidance.
- Future Integration Gateway: external company systems.

## Routing

The current production route remains available:

- `/api/v1/laptop-monitoring/*`

Endpoint Management adds compatible aliases:

- `/api/v1/endpoint-management/*`
- `/api/v1/endpoints/*`

All aliases use the same authentication, RBAC, storage, and controller behavior.

## Data Model

Existing production tables are intentionally preserved:

- `monitored_devices`
- `laptop_activity_logs`
- `laptop_screenshots`
- `laptop_alerts`

New endpoint-oriented tables should use `endpoint_*` naming, such as:

- `endpoint_hardware_inventory`
- `endpoint_software_inventory`
- `endpoint_software_scan_runs`
- `endpoint_monitoring_policies`

## RBAC

- SuperAdmin: all endpoints.
- Admin: endpoints in own branch.
- Technician: permitted branch endpoints.
- Employee: own assigned endpoint only when explicitly permitted.

Backend filtering is mandatory; frontend filtering is only a convenience layer.

## Policy Engine Readiness

Endpoint policies should live under Endpoint Management and attach to devices, employees, assets, branches, departments, and consent records. The current consent-generated policy table is the compatibility bridge until a full Endpoint Policy Engine is implemented.
