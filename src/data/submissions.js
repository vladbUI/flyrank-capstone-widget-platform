import { pool } from '../db.js';

const toSubmission = (r) => r && {
  id: r.id, widgetId: r.widget_id, data: r.data,
  geo: r.country ? { country: r.country, city: r.city, provider: r.geo_provider } : null,
  createdAt: r.created_at,
};

export async function findByIdempotencyKey(widgetId, key) {
  const { rows } = await pool.query('SELECT * FROM submissions WHERE widget_id = $1 AND idempotency_key = $2', [widgetId, key]);
  return toSubmission(rows[0]);
}

// Returns null when the idempotency key already exists (lost a race with a duplicate request).
export async function insert(client, s) {
  const { rows } = await client.query(
    `INSERT INTO submissions (widget_id, tenant_id, data, country, city, geo_provider, idempotency_key)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (widget_id, idempotency_key) DO NOTHING RETURNING *`,
    [s.widgetId, s.tenantId, JSON.stringify(s.data), s.geo?.country ?? null, s.geo?.city ?? null, s.geo?.provider ?? null, s.idempotencyKey ?? null],
  );
  return toSubmission(rows[0]);
}

export async function list(tenantId, { widgetId, limit }) {
  const { rows } = await pool.query(
    `SELECT * FROM submissions WHERE tenant_id = $1 AND ($2::uuid IS NULL OR widget_id = $2)
     ORDER BY created_at DESC LIMIT $3`,
    [tenantId, widgetId ?? null, limit],
  );
  return rows.map(toSubmission);
}

export async function stats(tenantId, days) {
  const [perDay, perWidget, byCountry] = await Promise.all([
    pool.query(
      `SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS day, count(*)::int AS count
       FROM submissions WHERE tenant_id = $1 AND created_at > now() - make_interval(days => $2)
       GROUP BY 1 ORDER BY 1`, [tenantId, days]),
    pool.query(
      `SELECT w.id AS "widgetId", w.title, count(s.id)::int AS count, max(s.created_at) AS "lastSubmissionAt"
       FROM widgets w LEFT JOIN submissions s ON s.widget_id = w.id
       WHERE w.tenant_id = $1 GROUP BY w.id ORDER BY count DESC`, [tenantId]),
    pool.query(
      `SELECT COALESCE(country, 'unknown') AS country, count(*)::int AS count
       FROM submissions WHERE tenant_id = $1 GROUP BY 1 ORDER BY count DESC`, [tenantId]),
  ]);
  return { days, perDay: perDay.rows, perWidget: perWidget.rows, byCountry: byCountry.rows };
}
