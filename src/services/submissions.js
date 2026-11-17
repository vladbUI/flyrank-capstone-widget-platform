import { z } from 'zod';
import * as widgetsRepo from '../data/widgets.js';
import * as repo from '../data/submissions.js';
import * as jobs from '../data/jobs.js';
import { tx } from '../db.js';
import { lookupGeo } from './geo.js';
import { HttpError } from '../http/errors.js';

const bodySchema = z.object({
  fields: z.record(z.string(), z.unknown()),
  hp: z.string().max(200).optional(), // honeypot: hidden input humans never fill
}).strict();

const keySchema = z.string().min(8).max(100).regex(/^[\w-]+$/).optional();

// The accepted payload is derived from the widget's own field definitions: unknown keys are rejected.
function fieldsSchema(widget) {
  const shape = {};
  for (const f of widget.fields) {
    let s = z.string().trim().max(f.maxLength);
    if (f.type === 'email') s = s.email();
    shape[f.name] = f.required ? s.min(1, 'required') : z.preprocess((v) => (v === '' ? undefined : v), s.optional());
  }
  return z.object(shape).strict();
}

export async function submit({ widgetId, body, ip, idempotencyKey }) {
  const { fields, hp } = bodySchema.parse(body ?? null);
  if (hp) return { status: 202, spam: true }; // silently dropped: the bot gets no hint why

  const widget = await widgetsRepo.getById(widgetId);
  if (!widget) throw new HttpError(404, 'not_found', 'Widget not found');
  const data = fieldsSchema(widget).parse(fields);
  const key = keySchema.parse(idempotencyKey);

  if (key) {
    const existing = await repo.findByIdempotencyKey(widget.id, key);
    if (existing) return { status: 200, submission: existing, replay: true };
  }

  const geo = await lookupGeo(ip); // degrades to null, never throws

  const submission = await tx(async (client) => {
    const row = await repo.insert(client, { widgetId: widget.id, tenantId: widget.tenantId, data, geo, idempotencyKey: key });
    // Same transaction: the email job exists iff the submission does. Sending happens in the worker.
    if (row) await jobs.enqueue(client, 'notify_owner', { submissionId: row.id, widgetId: widget.id, widgetTitle: widget.title, tenantId: widget.tenantId });
    return row;
  });
  if (!submission) return { status: 200, submission: await repo.findByIdempotencyKey(widget.id, key), replay: true };
  return { status: 201, submission };
}

export const list = (tenantId, q) => repo.list(tenantId, z.object({
  widgetId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
}).parse(q));

export const stats = (tenantId, q) => repo.stats(tenantId, z.object({
  days: z.coerce.number().int().min(1).max(365).default(30),
}).parse(q).days);
