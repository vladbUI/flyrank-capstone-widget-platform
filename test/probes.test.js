// Acceptance probes against a running stack (docker compose up + seed). Run: docker compose exec -T api npm test
// Needs DEV_TOOLS=true and GEO_MODE=mock (the compose defaults).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const ORIGIN = 'http://localhost:5500';
const KEY_A = process.env.DEMO_KEY_A || 'demo-key-tenant-a';
const KEY_B = process.env.DEMO_KEY_B || 'demo-key-tenant-b';
const NEWSLETTER_A = '11111111-1111-4111-8111-111111111111';
const CONTACT_A = '22222222-2222-4222-8222-222222222222';

async function call(method, path, { key, body, raw, headers = {} } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      Origin: ORIGIN,
      ...(body !== undefined || raw !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(key ? { Authorization: `Bearer ${key}` } : {}),
      ...headers,
    },
    body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
  });
  const text = await res.text();
  return { status: res.status, headers: res.headers, json: text ? JSON.parse(text) : null };
}
const submit = (widgetId, fields, opts = {}) => call('POST', `/v1/widgets/${widgetId}/submissions`, { body: { fields, ...opts.extra }, headers: opts.headers });
const toggle = (t) => call('POST', '/dev/toggles', { body: t });
const listSubs = async (key = KEY_A) => (await call('GET', '/v1/admin/submissions?limit=200', { key })).json.data;

after(() => toggle({ geoA: 'up', geoB: 'up', email: 'ok' }));

test('admin API rejects missing and invalid keys', async () => {
  assert.equal((await call('GET', '/v1/admin/widgets')).status, 401);
  assert.equal((await call('GET', '/v1/admin/widgets', { key: 'nope' })).status, 401);
});

test('widget CRUD with validation and embed snippet', async () => {
  const bad = await call('POST', '/v1/admin/widgets', { key: KEY_A, body: { type: 'popup', title: '' } });
  assert.equal(bad.status, 400);
  assert.equal(bad.json.error.code, 'validation_failed');

  const created = await call('POST', '/v1/admin/widgets', { key: KEY_A, body: {
    type: 'signup', title: 'CRUD test', fields: [{ name: 'email', label: 'Email', type: 'email', required: true }],
  } });
  assert.equal(created.status, 201);
  assert.match(created.json.embed, /^<script async src="http:\/\/localhost:3000\/widget\.js\?id=[0-9a-f-]{36}&v=[0-9a-f]{12}"><\/script>$/);
  const id = created.json.id;

  assert.equal((await call('GET', `/v1/admin/widgets/${id}`, { key: KEY_A })).json.title, 'CRUD test');
  const patched = await call('PATCH', `/v1/admin/widgets/${id}`, { key: KEY_A, body: { title: 'Renamed' } });
  assert.equal(patched.status, 200);
  assert.equal(patched.json.title, 'Renamed');
  assert.equal((await call('DELETE', `/v1/admin/widgets/${id}`, { key: KEY_A })).status, 204);
  assert.equal((await call('GET', `/v1/admin/widgets/${id}`, { key: KEY_A })).status, 404);
});

test('tenant isolation: B cannot read, modify or delete A\'s widget or see A\'s submissions', async () => {
  assert.equal((await call('GET', `/v1/admin/widgets/${NEWSLETTER_A}`, { key: KEY_B })).status, 404);
  assert.equal((await call('PATCH', `/v1/admin/widgets/${NEWSLETTER_A}`, { key: KEY_B, body: { title: 'pwned' } })).status, 404);
  assert.equal((await call('DELETE', `/v1/admin/widgets/${NEWSLETTER_A}`, { key: KEY_B })).status, 404);
  const listB = (await call('GET', '/v1/admin/widgets', { key: KEY_B })).json.data;
  assert.ok(listB.every((w) => w.id !== NEWSLETTER_A));
  assert.ok((await listSubs(KEY_B)).every((s) => s.widgetId !== NEWSLETTER_A));
  assert.equal((await call('GET', `/v1/admin/widgets/${NEWSLETTER_A}`, { key: KEY_A })).json.title, 'Acme newsletter');
});

test('public config: small, cached, CORS-enabled; unknown ids 404', async () => {
  const r = await call('GET', `/v1/widgets/${NEWSLETTER_A}/config`);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('cache-control'), 'public, max-age=60');
  assert.equal(r.headers.get('access-control-allow-origin'), '*');
  assert.ok(r.headers.get('etag'));
  assert.equal(r.json.tenantId, undefined);
  assert.ok(JSON.stringify(r.json).length < 1024);
  assert.equal((await call('GET', `/v1/widgets/${randomUUID()}/config`)).status, 404);
  assert.equal((await call('GET', '/v1/widgets/not-a-uuid/config')).status, 404);
});

test('widget.js: versioned URL is immutable, unversioned is short-lived', async () => {
  const embed = (await call('GET', `/v1/admin/widgets/${NEWSLETTER_A}`, { key: KEY_A })).json.embed;
  const v = /v=([0-9a-f]{12})/.exec(embed)[1];
  const versioned = await fetch(`${BASE}/widget.js?id=${NEWSLETTER_A}&v=${v}`);
  assert.equal(versioned.headers.get('cache-control'), 'public, max-age=31536000, immutable');
  assert.match(versioned.headers.get('content-type'), /javascript/);
  const unversioned = await fetch(`${BASE}/widget.js?id=${NEWSLETTER_A}`);
  assert.equal(unversioned.headers.get('cache-control'), 'public, max-age=300');
});

test('CORS preflight (OPTIONS) is answered', async () => {
  const r = await call('OPTIONS', `/v1/widgets/${NEWSLETTER_A}/submissions`, {
    headers: { 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type,idempotency-key' },
  });
  assert.equal(r.status, 204);
  assert.equal(r.headers.get('access-control-allow-origin'), '*');
  assert.match(r.headers.get('access-control-allow-methods'), /POST/);
  assert.match(r.headers.get('access-control-allow-headers'), /Idempotency-Key/);
});

test('PROBE 1: valid cross-origin submission → 201, stored, visible in dashboard API', async () => {
  const email = `p1-${Date.now()}@example.com`;
  const r = await submit(NEWSLETTER_A, { email, name: 'Ada' });
  assert.equal(r.status, 201);
  assert.equal(r.headers.get('access-control-allow-origin'), '*');
  const stored = (await listSubs()).find((s) => s.id === r.json.id);
  assert.equal(stored.data.email, email);
  assert.equal(stored.widgetId, NEWSLETTER_A);
  const stats = (await call('GET', '/v1/admin/stats', { key: KEY_A })).json;
  assert.ok(stats.perWidget.find((w) => w.widgetId === NEWSLETTER_A).count >= 1);
  assert.ok(stats.perDay.length >= 1 && stats.byCountry.length >= 1);
});

test('PROBE 2: malformed and oversized payloads → clean 4xx JSON, never 500', async () => {
  const path = `/v1/widgets/${NEWSLETTER_A}/submissions`;
  const malformed = await call('POST', path, { raw: '{"fields": {' });
  assert.equal(malformed.status, 400);
  assert.equal(malformed.json.error.code, 'malformed_json');

  const oversized = await call('POST', path, { body: { fields: { email: 'a@b.co', name: 'x'.repeat(20_000) } } });
  assert.equal(oversized.status, 413);
  assert.equal(oversized.json.error.code, 'payload_too_large');

  for (const fields of [{ name: 'no email' }, { email: 'not-an-email' }, { email: 'a@b.co', admin: true }, { email: 'a@b.co', name: 'x'.repeat(61) }]) {
    const r = await submit(NEWSLETTER_A, fields);
    assert.equal(r.status, 400, JSON.stringify(fields));
    assert.equal(r.json.error.code, 'validation_failed');
  }
  const wrongShape = await call('POST', path, { body: ['array'] });
  assert.equal(wrongShape.status, 400);
  const notJson = await fetch(BASE + path, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: 'hello' });
  assert.equal(notJson.status, 400);
});

test('PROBE 6: honeypot filled → silently dropped, nothing stored', async () => {
  const email = `bot-${Date.now()}@spam.test`;
  const r = await submit(NEWSLETTER_A, { email }, { extra: { hp: 'http://cheap-pills.test' } });
  assert.equal(r.status, 202);
  assert.ok((await listSubs()).every((s) => s.data.email !== email));
});

test('PROBE 4: provider A down → enriched by B; both down → stored without geo', async () => {
  assert.equal((await submit(NEWSLETTER_A, { email: 'geo-a@example.com' })).json.geo.provider, 'ip-api.com');

  await toggle({ geoA: 'down' });
  const viaB = await submit(NEWSLETTER_A, { email: 'geo-b@example.com' });
  assert.equal(viaB.status, 201);
  assert.deepEqual(viaB.json.geo, { country: 'NL', city: 'Amsterdam', provider: 'ipapi.co' });

  await toggle({ geoB: 'down' });
  const none = await submit(NEWSLETTER_A, { email: 'geo-none@example.com' });
  assert.equal(none.status, 201);
  assert.equal(none.json.geo, null);
  assert.ok((await listSubs()).some((s) => s.id === none.json.id && s.geo === null));
  await toggle({ geoA: 'up', geoB: 'up' });
});

test('PROBE 5: email side effect throws → submission still 201 and stored', async () => {
  await toggle({ email: 'fail' });
  const r = await submit(NEWSLETTER_A, { email: 'email-down@example.com' });
  assert.equal(r.status, 201);
  assert.ok((await listSubs()).some((s) => s.id === r.json.id));
  await toggle({ email: 'ok' });
});

test('idempotency: same Idempotency-Key twice → stored once', async () => {
  const headers = { 'Idempotency-Key': `idem-${randomUUID()}` };
  const first = await submit(NEWSLETTER_A, { email: 'idem@example.com' }, { headers });
  const second = await submit(NEWSLETTER_A, { email: 'idem@example.com' }, { headers });
  assert.equal(first.status, 201);
  assert.equal(second.status, 200);
  assert.equal(second.json.id, first.json.id);
  assert.equal(second.json.replay, true);
  assert.equal((await listSubs()).filter((s) => s.id === first.json.id).length, 1);
});

test('PROBE 3: burst → 429s, service keeps serving legitimate traffic', async () => {
  const burst = await Promise.all(Array.from({ length: 40 }, (_, i) => submit(CONTACT_A, { email: `burst${i}@example.com`, message: 'hi' })));
  const codes = burst.map((r) => r.status);
  assert.ok(codes.includes(429), `no 429 in ${codes}`);
  assert.ok(codes.includes(201));
  const limited = burst.find((r) => r.status === 429);
  assert.equal(limited.json.error.code, 'rate_limited');
  assert.ok(Number(limited.headers.get('retry-after')) > 0);

  // Right after the burst: another widget, the config endpoint and the dashboard all still work.
  assert.equal((await submit(NEWSLETTER_A, { email: 'after-burst@example.com' })).status, 201);
  assert.equal((await call('GET', `/v1/widgets/${CONTACT_A}/config`)).status, 200);
  assert.equal((await call('GET', '/health')).status, 200);
});
