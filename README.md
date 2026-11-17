# flyrank-capstone-widget-platform

An embeddable widget & lead-capture platform. A customer defines a signup or contact form through an
authenticated API, pastes **one `<script>` line** into any website, and every submission comes back to
this backend. There it is validated, rate-limited, spam-filtered, geo-enriched (with a provider
fallback chain), stored, and shown in a dashboard.

Node 22 · Express 5 · Postgres 16 · Zod · Docker Compose. Three runtime dependencies.

## Run it

```bash
docker compose up -d --build                 # db + api (:3000) + customer test site (:5500)
docker compose exec -T api npm run seed      # demo tenants, keys and widgets
docker compose exec -T api npm test          # 13 acceptance tests (probes 1-6 + more)
```

Then open:
- **http://localhost:5500**: a "customer website" on a different origin, with two embedded widgets
- **http://localhost:3000/dashboard**: owner dashboard (API key `demo-key-tenant-a`)

No `.env` is needed; the compose file has defaults. Copy `.env.example` to `.env` to override.
Migrations run automatically on API start (`migrations/*.sql`, tracked in `schema_migrations`).

## Architecture

```
 Widget owner ──Bearer key──▶ /v1/admin/widgets (CRUD) ──▶ widgets (tenant_id scoped) ──▶ embed snippet
                             /v1/admin/submissions, /stats ◀── submissions

 Customer site (any origin)
   <script src="/widget.js?id=…&v=<hash>">     cache: immutable 1y if v matches, else 5 min
        └─▶ GET /v1/widgets/:id/config         public · CORS * · max-age=60 · ETag
        └─▶ render form in Shadow DOM

 Visitor ──▶ OPTIONS/POST /v1/widgets/:id/submissions   (public · CORS *)
   1. CORS headers (also on errors, so the browser can read 413/429)
   2. rate limit: per IP+widget (20/10s), per widget (100/min)  → 429 + Retry-After
   3. JSON body ≤ 10 KB                                          → 400 malformed / 413 too large
   4. honeypot `hp` filled                                       → 202, silently dropped
   5. validate against this widget's own field definitions        → 400 with details
   6. Idempotency-Key seen before?                               → 200, same id (replay)
   7. geo: ip-api.com ──fail──▶ ipapi.co ──fail──▶ null (never blocks)
   8. ONE transaction: INSERT submission + INSERT notify_owner job → 201
                                    │
 Background worker (1s poll, SKIP LOCKED) ◀──┘  send email; retry 2s, 4s; then [ALERT] log
```

Code layers: `src/http` (routes, CORS, auth, rate limit, error mapping) → `src/services` (business rules)
→ `src/data` (SQL only). `public/widget.js` is the embeddable bundle, `test-site/` the second-origin page.
See [DESIGN.md](DESIGN.md) for the data model and decisions.

## API

All errors look like `{"error":{"code":"…","message":"…","details?":[…]}}`.

### Owner API (header `Authorization: Bearer <api key>`)
| Method & path | Notes |
|---|---|
| `POST /v1/admin/widgets` | body: `type` (`signup`/`contact`), `title`, `description?`, `fields[]` (`name`, `label`, `type` text/email/textarea, `required`, `maxLength`), `buttonText?`, `display?` (`position` inline/floating, `accentColor`) → 201 with `embed` |
| `GET /v1/admin/widgets` | `{ data: [...] }` |
| `GET /v1/admin/widgets/:id` | 404 if missing **or another tenant's** |
| `PATCH /v1/admin/widgets/:id` | partial update, validated after merge |
| `DELETE /v1/admin/widgets/:id` | 204 |
| `GET /v1/admin/submissions?widgetId=&limit=` | newest first, limit ≤ 200 |
| `GET /v1/admin/stats?days=30` | `perDay`, `perWidget`, `byCountry` |

### Public
| Method & path | Notes |
|---|---|
| `GET /widget.js?id=&v=` | the embeddable script |
| `GET /v1/widgets/:id/config` | only the public fields of the widget |
| `POST /v1/widgets/:id/submissions` | body `{"fields":{…},"hp":""}`, optional header `Idempotency-Key` → 201 `{id, geo, replay}` |
| `GET /health` | `{ok:true}` |

### Dev only (`DEV_TOOLS=true`, compose default; never enable in production)
`GET|POST /dev/toggles` with body like `{"geoA":"down","geoB":"down","email":"fail"}`.
These simulate provider and SMTP outages, for probes 4 and 5.

```bash
curl -s -H 'Content-Type: application/json' -H 'Origin: http://localhost:5500' \
  -d '{"fields":{"email":"ada@example.com","name":"Ada"}}' \
  http://localhost:3000/v1/widgets/11111111-1111-4111-8111-111111111111/submissions
```

## Configuration
See [.env.example](.env.example). Notable settings: `GEO_MODE=mock|real` (mock is deterministic; real calls ip-api.com
then ipapi.co, and from localhost the lookup fails, which is the fallback working as intended),
`TRUST_PROXY` (only behind a proxy you control, otherwise anyone can spoof `X-Forwarded-For` to dodge
rate limits), and the `RATE_LIMIT_*` knobs.

## Limitations (honest list)
- Rate-limit counters are in memory: per process, reset on restart. Multi-instance needs Redis.
- Email is a console log, not SMTP. The retry/alert path is real; delivery is not.
- The alert is a log line (`[ALERT] …`), not a page/Slack message.
- A job stuck in `running` after a crash is never re-claimed (no stale-lock sweep).
- Geo is looked up inline (≤ 2 × 1.5 s timeout worst case), not in the background.
- API keys are created only by the seed script; there is no signup or key-rotation endpoint.
- Public CORS is `*` for every widget. There's no per-widget allowed-domains list, so any site can embed any widget id.
- Honeypot only stops naive bots; no CAPTCHA / proof-of-work.
- Raw visitor IPs are not stored (privacy), so per-IP history isn't available after the fact.

## License
MIT. See [LICENSE](LICENSE).
