import { pool } from '../db.js';

const COLS = 'id, tenant_id, type, title, description, fields, button_text, display, created_at, updated_at';

const toWidget = (r) => r && {
  id: r.id, type: r.type, title: r.title, description: r.description, fields: r.fields,
  buttonText: r.button_text, display: r.display, createdAt: r.created_at, updatedAt: r.updated_at,
  tenantId: r.tenant_id,
};

// Every owner-facing query is scoped by tenant_id: that IS the tenant isolation.
export async function create(tenantId, w, id = null) {
  const { rows } = await pool.query(
    `INSERT INTO widgets (id, tenant_id, type, title, description, fields, button_text, display)
     VALUES (COALESCE($1, gen_random_uuid()), $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (id) DO NOTHING RETURNING ${COLS}`,
    [id, tenantId, w.type, w.title, w.description ?? null, JSON.stringify(w.fields), w.buttonText, JSON.stringify(w.display)],
  );
  return toWidget(rows[0]);
}

export async function list(tenantId) {
  const { rows } = await pool.query(`SELECT ${COLS} FROM widgets WHERE tenant_id = $1 ORDER BY created_at`, [tenantId]);
  return rows.map(toWidget);
}

export async function get(tenantId, id) {
  const { rows } = await pool.query(`SELECT ${COLS} FROM widgets WHERE tenant_id = $1 AND id = $2`, [tenantId, id]);
  return toWidget(rows[0]);
}

export async function update(tenantId, id, w) {
  const { rows } = await pool.query(
    `UPDATE widgets SET type = $3, title = $4, description = $5, fields = $6, button_text = $7, display = $8, updated_at = now()
     WHERE tenant_id = $1 AND id = $2 RETURNING ${COLS}`,
    [tenantId, id, w.type, w.title, w.description ?? null, JSON.stringify(w.fields), w.buttonText, JSON.stringify(w.display)],
  );
  return toWidget(rows[0]);
}

export async function remove(tenantId, id) {
  const { rowCount } = await pool.query('DELETE FROM widgets WHERE tenant_id = $1 AND id = $2', [tenantId, id]);
  return rowCount > 0;
}

// Public (unauthenticated) lookup by id only: used for config + submissions.
export async function getById(id) {
  const { rows } = await pool.query(`SELECT ${COLS} FROM widgets WHERE id = $1`, [id]);
  return toWidget(rows[0]);
}
