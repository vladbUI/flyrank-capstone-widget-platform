import { pool } from '../db.js';

export async function enqueue(client, type, payload) {
  await client.query('INSERT INTO jobs (type, payload) VALUES ($1, $2)', [type, JSON.stringify(payload)]);
}

// SKIP LOCKED: safe even if several workers poll the same table.
export async function claimNext() {
  const { rows } = await pool.query(
    `UPDATE jobs SET status = 'running', attempts = attempts + 1, updated_at = now()
     WHERE id = (SELECT id FROM jobs WHERE status = 'pending' AND run_at <= now()
                 ORDER BY run_at FOR UPDATE SKIP LOCKED LIMIT 1)
     RETURNING *`,
  );
  return rows[0] ?? null;
}

export async function markDone(id) {
  await pool.query(`UPDATE jobs SET status = 'done', last_error = NULL, updated_at = now() WHERE id = $1`, [id]);
}

// Exponential backoff (2s, 4s, ...) until max_attempts, then 'failed'.
export async function markFailed(job, error) {
  const final = job.attempts >= job.max_attempts;
  await pool.query(
    `UPDATE jobs SET status = $2, last_error = $3, updated_at = now(),
       run_at = now() + make_interval(secs => power(2, attempts))
     WHERE id = $1`,
    [job.id, final ? 'failed' : 'pending', String(error?.message ?? error).slice(0, 500)],
  );
  return final;
}
