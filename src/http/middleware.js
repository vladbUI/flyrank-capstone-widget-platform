import { z } from 'zod';
import * as tenants from '../data/tenants.js';
import { hashKey } from '../services/apiKeys.js';
import { HttpError } from './errors.js';

// Public endpoints are called from any website, so any origin is allowed. No cookies are used,
// so '*' is safe. Runs before body parsing so even 413/429 responses are readable by the browser.
export function publicCors(req, res, next) {
  res.set({
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Idempotency-Key',
    'Access-Control-Expose-Headers': 'Retry-After',
    'Access-Control-Max-Age': '600',
  });
  if (req.method === 'OPTIONS') return res.status(204).end(); // preflight
  next();
}

// Fixed-window counter per key.
// shortcut: in-memory, so limits are per process and reset on restart; use Redis for multi-instance.
export function rateLimit({ max, windowMs, key }) {
  const hits = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [k, e] of hits) if (e.resetAt <= now) hits.delete(k);
  }, windowMs).unref();

  return (req, res, next) => {
    const k = key(req);
    const now = Date.now();
    let e = hits.get(k);
    if (!e || e.resetAt <= now) hits.set(k, (e = { count: 0, resetAt: now + windowMs }));
    if (++e.count > max) {
      res.set('Retry-After', String(Math.ceil((e.resetAt - now) / 1000)));
      return next(new HttpError(429, 'rate_limited', 'Too many requests, please slow down'));
    }
    next();
  };
}

export async function requireTenant(req, res, next) {
  const m = /^Bearer (\S+)$/.exec(req.get('authorization') ?? '');
  const tenant = m && (await tenants.findByKeyHash(hashKey(m[1])));
  if (!tenant) throw new HttpError(401, 'unauthorized', 'Missing or invalid API key');
  req.tenant = tenant;
  res.set('Cache-Control', 'no-store');
  next();
}

// Non-UUID ids would make Postgres throw (→ 500); treat them as "not found" instead.
export function widgetIdParam(req) {
  const r = z.string().uuid().safeParse(req.params.id);
  if (!r.success) throw new HttpError(404, 'not_found', 'Widget not found');
  return r.data;
}
