import { pool } from '../db.js';

export async function findByKeyHash(hash) {
  const { rows } = await pool.query('SELECT id, name, notify_email FROM tenants WHERE api_key_hash = $1', [hash]);
  return rows[0] ?? null;
}

export async function upsert({ id, name, apiKeyHash, notifyEmail }) {
  await pool.query(
    `INSERT INTO tenants (id, name, api_key_hash, notify_email) VALUES ($1, $2, $3, $4)
     ON CONFLICT (id) DO UPDATE SET name = $2, api_key_hash = $3, notify_email = $4`,
    [id, name, apiKeyHash, notifyEmail],
  );
}
