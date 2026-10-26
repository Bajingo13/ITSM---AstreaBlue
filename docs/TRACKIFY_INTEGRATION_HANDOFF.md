# Trackify → AstreaBlue ITSM: Ticket Integration Guide

This guide is for the Trackify development team. It explains how to let Trackify users raise IT support tickets that go straight into the **AstreaBlue ITSM** Service Desk.

AstreaBlue owns everything about the ticket: the ticket number, SLA, technician assignment, status, resolution and audit trail. On the Trackify side, you collect the request, send it to AstreaBlue, and show the user its progress.

```
Trackify user → Trackify frontend → Trackify backend → HTTPS + x-api-key → AstreaBlue ITSM API → Service Desk
```

> **Important:** every call to AstreaBlue must come from the **Trackify backend**. Never call the API from browser JavaScript or a mobile app, because the API key must never reach a user's device.

---

## 1. What you will receive

The AstreaBlue administrator gives you these through a secure channel, not plain email or chat:

| Item | Value |
|---|---|
| Base URL | `https://backend-production-fc059.up.railway.app/api/v1/external` |
| System code | `TRACKIFY` |
| API key | Sent separately. It is shown only once when issued, so store it immediately. |

Store them as server-side configuration or secrets:

```
ASTREABLUE_API_URL=https://backend-production-fc059.up.railway.app
ASTREABLUE_EXTERNAL_API_KEY=<provided separately>
ASTREABLUE_SYSTEM_CODE=TRACKIFY
```

Never commit the key to source control, never print it in logs, and never put it in a URL. If you think it has leaked, tell the AstreaBlue admin. They can revoke it and issue a new one immediately.

## 2. Authentication

Every request sends the key in a header:

```
x-api-key: <ASTREABLUE_EXTERNAL_API_KEY>
Content-Type: application/json
```

## 3. Create a ticket

**`POST /tickets`**

Call this when an Trackify user submits your "Report an issue / IT Help" form.

```json
{
  "origin_system": "Trackify",
  "origin_module": "Reports",
  "origin_feature": "Export to Excel",
  "external_reference": "TRK-REQ-000123",
  "external_employee_id": "EMP-1045",
  "requester_name": "Juan Dela Cruz",
  "requester_email": "juan.delacruz@company.com",
  "title": "Unable to export report",
  "description": "Clicking Export to Excel returns an error page.",
  "priority": "Medium"
}
```

| Field | Required | Notes |
|---|---|---|
| `origin_system` | Yes | Always `"Trackify"` (not case-sensitive) |
| `origin_module` | Yes | Area of Trackify the issue relates to (max 150 chars) |
| `origin_feature` | No | More specific screen/function (max 150) |
| `external_reference` | Yes | **Your own unique ID for this request** (max 150). See §6. |
| `external_employee_id` | Yes | The employee's ID in Trackify (max 150) |
| `requester_name` | Yes | Logged-in employee's name (max 200) |
| `requester_email` | Yes | Logged-in employee's email (max 320) |
| `title` | Yes | Max 255 |
| `description` | Yes | Max 10,000 |
| `priority` | No | `Low`, `Medium`, `High`, `Critical`. Default `Medium`. |
| `category` | **Do not send** | The Service Desk sets the category when they triage the ticket. Sending a name that doesn't exactly match an AstreaBlue category is rejected with 400, so leave this field out. It still appears in status responses once the Service Desk has set it. |

Take the requester fields from the Trackify login session, not from form inputs the user can edit.

Attachments are not supported. Ask users to describe the problem in text. The Service Desk can request files afterwards.

**Response: 201 Created**

```json
{
  "success": true,
  "message": "Ticket created successfully.",
  "data": {
    "ticket_number": "TRACKIFY-20261027001",
    "status": "Open Queue",
    "priority": "P3-Medium",
    "created_at": "2026-10-27T06:10:00.000Z"
  }
}
```

**Save `ticket_number`** next to your `external_reference`, and show it to the user, e.g. "Your ticket TRACKIFY-20261027001 has been submitted."

## 4. Check ticket status

**`GET /tickets/{ticket_number}`**

```json
{
  "success": true,
  "message": "Ticket retrieved.",
  "data": {
    "ticket_number": "TRACKIFY-20261027001",
    "title": "Unable to export report",
    "status": "In Progress",
    "priority": "P3-Medium",
    "category": "Software",
    "origin_system": "Trackify",
    "origin_module": "Reports",
    "origin_feature": "Export to Excel",
    "external_reference": "TRK-REQ-000123",
    "assigned_technician_name": "Maria Santos",
    "resolution": null,
    "created_at": "2026-10-27T06:10:00.000Z",
    "updated_at": "2026-10-27T07:02:00.000Z",
    "latest_update": "2026-10-27T07:02:00.000Z",
    "comments": [
      { "comment": "We are checking the report export service.", "created_at": "2026-10-27T07:02:00.000Z", "external_comment_reference": null }
    ]
  }
}
```

Status values you will see: `Open Queue`, `In Progress`, `Pending`, `Resolved`, `Closed`, `Cancelled`. Treat any status you don't recognise as "open", so your code keeps working if a new status is added.

Priority comes back in the form `P1-Critical`, `P2-High`, `P3-Medium`, `P4-Low`.

**AstreaBlue does not push updates to Trackify.** To keep the "My tickets" page current, either:
- refresh a ticket's status when the user opens the page, and/or
- run a background job every 5–15 minutes for tickets that are not yet `Resolved`, `Closed` or `Cancelled`.

The API allows about **120 requests per minute per system**. Don't poll more often than every few minutes, and stop polling a ticket once it is closed.

You can only read tickets that Trackify created. Asking for any other ticket number returns 404.

## 5. Add a follow-up comment (optional)

**`POST /tickets/{ticket_number}/comments`**

```json
{
  "comment": "The issue still happens after clearing my browser cache.",
  "external_comment_reference": "TRK-REQ-000123-C1"
}
```

- `comment` is required, max 5,000 characters.
- `external_comment_reference` is optional (max 150) but recommended. It stops a retried comment from being posted twice.
- Comments are visible on the ticket timeline. Returns 201 for a new comment, 200 if the same comment was already received.

## 6. Retries and duplicates (`external_reference`)

AstreaBlue uses `external_reference` to recognise a request it has already received:

- If a call **times out or returns 500**, resend **exactly the same payload with the same `external_reference`**. You get back the existing ticket (HTTP 200, `"idempotent_replay": true`), not a duplicate.
- **Never reuse** an `external_reference` for a different request. If the title, description, priority or another field differs, you get **409 Conflict**.
- Generate the reference once, when the Trackify request record is created, and store it.

## 7. Error handling

All errors use the same format:

```json
{ "success": false, "message": "Reason for the error", "data": null }
```

| HTTP | Meaning | What Trackify should do |
|---|---|---|
| 400 | Missing or invalid field | Show the `message` to the user or fix the payload. Do not retry unchanged. |
| 401 | Missing or wrong API key | Configuration problem. Alert Trackify admins. Do not retry. |
| 403 | Key or system disabled or revoked | Contact the AstreaBlue admin. Do not retry. |
| 404 | Ticket not found, or not created by Trackify | Check the ticket number. |
| 409 | `external_reference` reused with different data | Bug on the Trackify side. Use a new reference for a new request. |
| 429 | Too many requests | Wait and retry later, with backoff. |
| 500 / timeout | Temporary problem | Retry with the **same** payload and reference, with backoff (e.g. 5s, 30s, 2m). |

Set a request timeout of 15–30 seconds. Don't log the `x-api-key` header or full request headers.

## 8. Example (Node.js backend)

```js
async function createAstreaBlueTicket(ticket) {
  const response = await fetch(`${process.env.ASTREABLUE_API_URL}/api/v1/external/tickets`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": process.env.ASTREABLUE_EXTERNAL_API_KEY,
    },
    body: JSON.stringify({ origin_system: "Trackify", ...ticket }),
    signal: AbortSignal.timeout(20000),
  });
  const result = await response.json();
  if (!response.ok) throw Object.assign(new Error(result.message), { status: response.status });
  return result.data; // { ticket_number, status, priority, created_at }
}
```

## 9. What to build in Trackify (checklist)

- [ ] Server-side config for URL, key and system code (secret storage, not source code)
- [ ] "Report an issue / IT Help" form → Trackify backend → `POST /tickets`
- [ ] Unique `external_reference` generated once per request and stored
- [ ] Store `ticket_number` and show it to the user
- [ ] Retry on timeout or 500 with the same payload and reference
- [ ] Error handling per §7
- [ ] "My tickets" page using `GET /tickets/{ticket_number}`
- [ ] Background refresh of open tickets (every 5–15 min), stopping once they are closed
- [ ] Optional: follow-up comments
- [ ] API key never in the frontend, URLs or logs

## 10. Testing before go-live

Run these and confirm each one:

1. Create a ticket → 201. AstreaBlue confirms it appears in the Service Desk.
2. Send the same request again → 200 with `idempotent_replay: true` and the same ticket number.
3. Send the same `external_reference` with a different title → 409.
4. Get the ticket's status → 200.
5. Add a comment → 201. Repeat it with the same reference → 200.
6. Use a wrong API key → 401.
7. Get a made-up ticket number → 404.

Put `[TEST]` at the start of test ticket titles so the Service Desk can close them. Tell the AstreaBlue admin when you've finished, so they can check the results on their side.

## 11. Contacts

- **AstreaBlue ITSM admin** (keys, access issues): ______________________
- **Trackify developer**: ______________________
