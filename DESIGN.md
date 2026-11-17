# Design — Embeddable Widget & Lead-Capture Platform

## Problem
Customers need a form (newsletter signup, contact) on websites they own, without writing a backend.
They define a widget in our admin API, paste one `<script>` line, and see submissions in a dashboard.
The submission endpoint is public: every browser on the internet can hit it, so it must validate,
rate-limit, filter spam, degrade gracefully when dependencies fail, and never lose a good submission.

## Data model (Postgres, `migrations/001_init.sql`)

| Table | Key columns | Indexes / constraints |
|---|---|---|
| `tenants` | `id`, `name`, `api_key_hash` (sha256), `notify_email` | unique `api_key_hash` |
| `widgets` | `id`, `tenant_id`, `type` (signup/contact), `title`, `description`, `fields` (jsonb), `button_text`, `display` (jsonb) | `(tenant_id)` |
| `submissions` | `id`, `widget_id`, `tenant_id` (denormalised), `data` (jsonb), `country`, `city`, `geo_provider`, `idempotency_key` | unique `(widget_id, idempotency_key)`, `(tenant_id, created_at)`, `(widget_id, created_at)` |
| `jobs` | `id`, `type`, `payload`, `status`, `attempts`, `max_attempts`, `run_at`, `last_error` | partial `(run_at) WHERE status='pending'` |

Tenancy: every admin query carries `WHERE tenant_id = $1` taken from the authenticated API key, never from
the request. A widget owned by another tenant answers `404`, not `403`, so ids can't be probed.
Raw visitor IPs are **not stored**. They are used in memory for rate limiting and geo lookup only.

## Embed flow
1. Owner `POST /v1/admin/widgets` → response contains `embed`:
   `<script async src="http://localhost:3000/widget.js?id=<id>&v=<bundle-hash>"></script>`
2. Browser loads `widget.js`. If `v` matches the current bundle hash → `Cache-Control: immutable, 1y`,
   otherwise `max-age=300` (an old snippet still gets fresh code within 5 min).
3. Script reads its own `src` → `GET /v1/widgets/:id/config` (public, CORS `*`, `max-age=60` + ETag).
4. Renders a form inside a Shadow DOM (host page CSS can't break it; built with `textContent`, no `innerHTML`).
5. Submit → `POST /v1/widgets/:id/submissions` with JSON + `Idempotency-Key` (triggers a CORS preflight).

## API contracts — three request paths

**Owner (Bearer API key)**
- `POST|GET /v1/admin/widgets`, `GET|PATCH|DELETE /v1/admin/widgets/:id`
- `GET /v1/admin/submissions?widgetId=&limit=`
- `GET /v1/admin/stats?days=30` → `{ perDay, perWidget, byCountry }`

**Customer site (public, cached)**
- `GET /widget.js?id=&v=`
- `GET /v1/widgets/:id/config`

**Visitor (public, CORS, protected)**
- `OPTIONS|POST /v1/widgets/:id/submissions` body `{ "fields": {...}, "hp": "" }`

Pipeline: CORS → body parse (10 KB cap → 413) → rate limit (per IP+widget, per widget → 429) →
shape validation (400) → honeypot (202, silently dropped) → field validation against the widget's own
field definitions (400) → idempotency check → geo A → geo B → none → insert submission + `notify_owner`
job in **one transaction** → 201. The email runs in the background worker, so its failure can't touch the response.

## Layers
`src/http` (routing, CORS, auth, errors) → `src/services` (business rules) → `src/data` (SQL only).

## Non-goals
- No CTA/popover widget type, no form builder UI. Two form types prove the pattern.
- No real SMTP. The email is a console log. What matters is that its failure can't block a submission.
- Rate-limit counters live in memory (single instance). A multi-instance deploy would need Redis.
