# HTTP API

Base URL: `http://127.0.0.1:4310`. Bodies and responses use JSON. This local demo has no authentication. Mutations require `Content-Type: application/json` and, when present, a same-origin `Origin` header.

| Method | Path | Result |
| --- | --- | --- |
| GET | `/api/health` | `{ "status": "ok" }` |
| GET | `/api/dashboard` | Incidents, services with derived health, metrics, seven-day trend |
| GET | `/api/incidents` | Incident summaries, newest first |
| POST | `/api/incidents` | Create incident; returns detail and HTTP 201 |
| GET | `/api/incidents/:id` | Incident, events, allowed `next_statuses` |
| PATCH | `/api/incidents/:id` | Add a note and/or change status; returns updated detail |

## Create

```json
{
  "title": "Checkout requests are failing",
  "description": "Customers receive errors while confirming orders.",
  "service_id": "checkout",
  "severity": "critical"
}
```

`title`: 5–120 trimmed characters. `description`: 10–3,000. `severity`: `critical`, `major`, or `minor`. `service_id`: one of `api`, `checkout`, `auth`, `notifications`, `storage`, `web`. New incidents start in `investigating`; clients cannot set timestamps or IDs.

## Update

```json
{
  "status": "identified",
  "message": "Payment provider timeout confirmed. Applying a fallback."
}
```

Both fields are optional individually, but at least one is required. Notes must contain 1–2,000 trimmed characters. A note-only update preserves the current status. A status-only no-op is rejected. Consult `next_statuses` from the detail response for valid transitions.

## Filters

`GET /api/incidents?q=checkout&status=active&severity=critical&service=checkout`

All filters combine with AND. `q` matches title or incident number case-insensitively for ASCII characters. SQL wildcard characters are treated literally. Status accepts a lifecycle status or the special value `active` (all unresolved). Omit a filter to leave it unrestricted.

The UI applies equivalent filters to the dashboard snapshot in memory. In this small demo there is no pagination.

## Errors

```json
{ "error": "Cannot move from investigating to monitoring." }
```

- `400`: invalid input, invalid JSON or an empty update.
- `403`: rejected Host, cross-origin or cross-site mutation.
- `404`: unknown incident or route.
- `405`: unsupported HTTP method.
- `409`: invalid lifecycle transition.
- `413`: body exceeds 16 KB.
- `415`: mutation without JSON content type.
- `500`: unexpected error; internal details are not sent to clients.
