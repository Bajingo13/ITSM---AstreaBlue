# AstreaBlue Demo Testing Script

## Before the demo

From `backend/`, load or refresh the sample records:

```bash
npm run demo:seed -- --confirm
```

The script is idempotent. It reuses the same `DEMO` records and does not delete existing data.

## Presenter script

### 1. Executive Dashboard

Say:

> AstreaBlue is a centralized ITSM platform. The Executive Dashboard summarizes Service Desk, assets, endpoints, compliance, projects, and change performance using the same operational database.

Show the module cards and open one analytics section.

### 2. Centralized ticketing

Say:

> Employees submit tickets through AstreaBlue, while approved external systems submit tickets from their own backend using a unique API key. Both enter the same Service Desk workflow.

Create an internal test ticket or show an Inventory external ticket. Point out the ticket number, requester, priority, status, assignment, comments, SLA, and history.

External request format:

```json
{
  "external_employee_id": "INV-EMP-001",
  "requester_name": "Demo Employee",
  "requester_email": "demo.employee@example.com",
  "origin_system": "Inventory System",
  "origin_module": "Stock Management",
  "external_reference": "INV-DEMO-001",
  "title": "Unable to update stock quantity",
  "description": "The stock adjustment page does not save the new quantity.",
  "priority": "P2-High"
}
```

### 3. Configuration Management

Open these records:

- `AB-DEMO-API-GATEWAY-01`
- `AB-DEMO-INVENTORY-APP-01`
- `AB-DEMO-INVENTORY-DB-01`
- `AB-DEMO-WEB-SERVER-01`

Say:

> The CMDB records the services and infrastructure supporting the business system. Relationships show what connects to or depends on another configuration item, allowing impact analysis before a change is approved.

Show the Inventory application relationship to the API gateway and database.

### 4. Change Request

Open `CHG-DEMO-001`.

Say:

> This change introduces the Inventory ticket gateway. It contains the business justification, affected configuration items, impact, risk, implementation plan, testing plan, communications, and backout plan before deployment.

Show its `Approved` status and linked CIs.

Then briefly show:

- `CHG-DEMO-002` — Pending CAB Review
- `CHG-DEMO-003` — Implemented

### 5. Release Planning

Open `REL-DEMO-001`.

Say:

> The approved change is packaged into a production release. The release records its schedule, environment, dependencies, packages, checklist, progress, validation, and linked change.

Show `REL-DEMO-002` as an example currently under verification.

### 6. Rollback Procedure

Open `RBK-DEMO-001`.

Say:

> A rollback procedure is prepared before production deployment. It is linked to the change and release, contains exact recovery steps and a checklist, and retains version and execution history for audit evidence.

Show `RBK-DEMO-002` as the approved database recovery procedure.

### 7. Close

Say:

> AstreaBlue connects ticketing, configuration, change, release, rollback, endpoint governance, and reporting. The benefit is one source of truth, controlled access, and a complete audit trail from issue creation through operational improvement.

## Expected demo records

- 4 configuration items
- 3 CI relationships
- 3 change requests
- 2 release plans
- 2 rollback procedures

## Safety

- Do not show API keys, JWTs, Railway variables, or database credentials.
- Use only records containing `DEMO` during the presentation.
- Confirm the backend and frontend are healthy before beginning.
