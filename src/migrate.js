import { readdir, readFile } from 'node:fs/promises';
import { pool, tx } from './db.js';

const dir = new URL('../migrations/', import.meta.url);

// Applies every migrations/*.sql not yet recorded in schema_migrations, in name order.
export async function migrate() {
  await tx(async (c) => {
    await c.query('SELECT pg_advisory_xact_lock(4242)'); // one migrator at a time
    await c.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
    const { rows } = await c.query('SELECT name FROM schema_migrations');
    const done = new Set(rows.map((r) => r.name));
    for (const name of (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort()) {
      if (done.has(name)) continue;
      await c.query(await readFile(new URL(name, dir), 'utf8'));
      await c.query('INSERT INTO schema_migrations (name) VALUES ($1)', [name]);
      console.log(`[migrate] applied ${name}`);
    }
  });
}

if (process.argv[1]?.endsWith('migrate.js')) {
  await migrate();
  await pool.end();
}
