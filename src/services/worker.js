import * as jobs from '../data/jobs.js';
import { toggles } from './toggles.js';
import { pool } from '../db.js';

const handlers = {
  // shortcut: email is a console log (brief allows it); swap for nodemailer + Mailpit/SMTP for real delivery.
  async notify_owner(p) {
    if (toggles.email === 'fail') throw new Error('SMTP unavailable (simulated via /dev/toggles)');
    const { rows } = await pool.query('SELECT notify_email FROM tenants WHERE id = $1', [p.tenantId]);
    console.log(`[email] to=${rows[0]?.notify_email ?? '(none)'} subject="New submission on ${p.widgetTitle}" submission=${p.submissionId}`);
  },
};

let busy = false;

async function tick() {
  if (busy) return;
  busy = true;
  try {
    for (let job; (job = await jobs.claimNext()); ) {
      try {
        await handlers[job.type](job.payload);
        await jobs.markDone(job.id);
      } catch (err) {
        const final = await jobs.markFailed(job, err);
        if (final) console.error(`[ALERT] job ${job.id} (${job.type}) failed permanently after ${job.attempts} attempts: ${err.message}`);
        else console.warn(`[worker] job ${job.id} attempt ${job.attempts} failed, will retry: ${err.message}`);
      }
    }
  } catch (err) {
    console.error('[worker] poll error', err.message);
  } finally {
    busy = false;
  }
}

// shortcut: a job left 'running' by a crash is never re-claimed; add a stale-lock sweep if that matters.
export const startWorker = (intervalMs = 1000) => setInterval(tick, intervalMs);
