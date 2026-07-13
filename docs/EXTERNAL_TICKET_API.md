# AstreaBlue External Ticket API

## 1. Purpose

The External Ticket API lets approved company systems create and follow AstreaBlue Service Desk incidents. AstreaBlue remains the source of truth for ticket numbers, SLA, assignment, status, resolution, notifications, comments, and audit history. External teams build their own Help page and call this API only from their backend.

## 2. Architecture overview

`External system UI → External system backend → HTTPS + x-api-key → AstreaBlue External Ticket Gateway → shared Service Desk ticket service → existing Incident Management`

There is no separate external-ticket database or workflow.

## 3. Authentication

Every system receives a separate API key. Send it as `x-api-key`. Keys are shown only at issuance, stored by AstreaBlue as SHA-256 hashes, and must never be logged or sent to a browser/mobile client.

AstreaBlue administrators provision and revoke credentials from `backend/`:

```bash
npm run integration:provision -- --code=HRIS --name=HRIS
npm run integration:revoke -- --code=HRIS
```

Provisioning the same code rotates its credential and revokes older keys.

## 4. Base URLs

- Local: `http://localhost:5000/api/v1/external`
- Production: `https://<astreablue-host>/api/v1/external`

Production integrations must use HTTPS.

## 5. Ticket creation

`POST /tickets`

Headers: `x-api-key: <SYSTEM_API_KEY>` and `Content-Type: application/json`.

Required fields:

| Field | Rules |
|---|---|
| `external_employee_id` | Employee identifier from the originating system; max 150 |
| `requester_name` | Filing employee's display name; max 200 |
| `requester_email` | Filing employee's valid email address; max 320 |
| `origin_system` | Must match the authenticated system name; max 150 |
| `origin_module` | Max 150 |
| `external_reference` | Stable source-system identifier; max 150 |
| `title` | Max 255 |
| `description` | Max 10,000 |

Optional fields: `employee_id` (an existing AstreaBlue user link), `origin_feature` (150), `category`, `category_id`, `priority`, and `attachment_metadata`. External systems do not need to synchronize their employee database with AstreaBlue. When `employee_id` is provided, that user must exist in AstreaBlue.

Priority accepts `Critical`, `High`, `Medium`, `Low`, or canonical `P1-Critical`, `P2-High`, `P3-Medium`, `P4-Low`. The stored/returned value is canonical. Default is Medium.

`category` must case-insensitively match an existing AstreaBlue ticket category. `category_id` may be used instead. Unknown categories return 400; the API does not create categories. If both are omitted, the ticket has no category.

Attachments are not uploaded through this API. `attachment_metadata`, when present, must be a JSON array and is informational only; never include file contents or secrets.

```json
{
  "external_employee_id": "HRIS-EMP-1045",
  "requester_name": "Juan Dela Cruz",
  "requester_email": "juan@company.com",
  "origin_system": "HRIS",
  "origin_module": "Attendance",
  "origin_feature": "Time In",
  "external_reference": "HRIS-ATT-000145",
  "category": "Software",
  "priority": "High",
  "title": "Unable to Time In",
  "description": "The attendance page returns an error."
}
```

AstreaBlue generates external ticket numbers as `<SYSTEM_CODE>-<YYYYMMDD><SEQUENCE>`, for example `HRIS-20260713001`. Internal/manual tickets keep the `TKT-YYYYMMDD-0001` format. New tickets return 201. An identical idempotent replay returns 200:

```json
{"success":true,"message":"Ticket created successfully.","data":{"ticket_number":"HRIS-20260713001","status":"Open Queue","priority":"P2-High","created_at":"2026-07-13T00:00:00.000Z"}}
```

```json
{"success":true,"message":"Existing ticket returned for this external reference.","data":{"ticket_number":"HRIS-20260713001","status":"Open Queue","priority":"P2-High","idempotent_replay":true}}
```

## 6. Ticket status

`GET /tickets/:ticketNumber` returns only the originating system's ticket. Safe fields include ticket number, title, status, priority, category, origin fields, external reference, timestamps, optional technician display name, public resolution, and non-internal comments. It excludes user IDs, branch details, integration IDs, API/security data, and internal comments.

## 7. Comments

`POST /tickets/:ticketNumber/comments`

```json
{"comment":"The issue is still occurring.","external_comment_reference":"HRIS-COMMENT-0001"}
```

`comment` is required (maximum 5,000). The optional reference is maximum 150. Repeating the same reference and text returns the existing comment with 200; conflicting text returns 409. Only the ticket's originating system may comment. Comments are public timeline entries; internal Service Desk notes are never returned.

## 8. Idempotency

Ticket idempotency uses authenticated `origin_system + external_reference`. Retry the exact payload after timeouts. Identical data returns the existing ticket; conflicting title, description, employee, category, priority, module, or feature returns 409.

## 9. Centralized queue security

External tickets are company-wide and enter the centralized Service Desk queue without a branch. Access is isolated by the authenticated integration: a system cannot retrieve or comment on another system's ticket. Internal/manual Service Desk branch RBAC remains unchanged.

## 10. Error responses

All errors use `{"success":false,"message":"...","data":null}`.

| Status | Meaning |
|---|---|
| 400 | Invalid/missing field or unknown category |
| 401 | Missing or invalid API key |
| 403 | Disabled or revoked system/key |
| 404 | Ticket unavailable to this system |
| 409 | Conflicting idempotency reference |
| 429 | Reserved for rate limiting; not currently enabled |
| 500 | Internal failure; retry safely with the same reference |

## 11. Example requests

### cURL

```bash
curl -X POST "$ASTREABLUE_API_URL/api/v1/external/tickets" -H "x-api-key: $ASTREABLUE_EXTERNAL_API_KEY" -H "Content-Type: application/json" --data @ticket.json
```

### Node.js backend fetch

```js
const response = await fetch(`${process.env.ASTREABLUE_API_URL}/api/v1/external/tickets`, {
  method: "POST",
  headers: { "content-type": "application/json", "x-api-key": process.env.ASTREABLUE_EXTERNAL_API_KEY },
  body: JSON.stringify(ticket),
});
const result = await response.json();
```

### PHP cURL

```php
$ch = curl_init(getenv('ASTREABLUE_API_URL').'/api/v1/external/tickets');
curl_setopt_array($ch, [CURLOPT_POST => true, CURLOPT_RETURNTRANSFER => true,
  CURLOPT_HTTPHEADER => ['Content-Type: application/json', 'x-api-key: '.getenv('ASTREABLUE_EXTERNAL_API_KEY')],
  CURLOPT_POSTFIELDS => json_encode($ticket)]);
$result = json_decode(curl_exec($ch), true);
```

### C# HttpClient

```csharp
using var request = new HttpRequestMessage(HttpMethod.Post, $"{apiUrl}/api/v1/external/tickets");
request.Headers.Add("x-api-key", apiKey);
request.Content = JsonContent.Create(ticket);
using var response = await httpClient.SendAsync(request);
```

## 12. Example responses

Create and replay examples are above. Status and comment responses follow the same `success/message/data` envelope. Never parse undocumented fields.

## 13. Testing checklist

- Issue a separate non-production key for the system.
- Create and locate a ticket in Incident Management.
- Verify SLA, notification, audit, and initial timeline.
- Retrieve, comment, retry, and test conflicting retries.
- Test invalid/revoked keys and cross-system access.

## 14. Production checklist

- Set `ASTREABLUE_API_URL`, `ASTREABLUE_EXTERNAL_API_KEY`, and `ASTREABLUE_SYSTEM_CODE` in server-side secrets.
- Use HTTPS, timeouts, safe retries, secret redaction, and restricted outbound access.
- Never commit or expose keys. Rotate immediately if compromised.
- Use unique external references and monitor 4xx/5xx responses.

## 15. Troubleshooting

- 401: check the server-side secret and header name.
- 403: confirm system and key status.
- 400 employee: verify the required external employee fields; if optional `employee_id` is supplied, confirm that AstreaBlue user exists.
- 409: reuse a reference only for the identical logical request.
- 404: confirm ticket number and originating credential.

## 16. Security requirements

API calls must originate from trusted backend code. Do not place keys in React, browser JavaScript, Flutter, mobile binaries, URLs, analytics, logs, screenshots, or support messages. Use parameterized queries, TLS in production, one credential per system, secret-manager storage, rotation, and sanitized error handling.
