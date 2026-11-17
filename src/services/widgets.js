import { z } from 'zod';
import * as repo from '../data/widgets.js';
import { config } from '../config.js';
import { bundleVersion } from './bundle.js';
import { HttpError } from '../http/errors.js';

const field = z.object({
  name: z.string().regex(/^[a-z][a-z0-9_]{0,31}$/, 'lowercase letters, digits, _ (max 32)'),
  label: z.string().trim().min(1).max(80),
  type: z.enum(['text', 'email', 'textarea']),
  required: z.boolean().default(false),
  maxLength: z.number().int().min(1).max(2000).default(200),
}).strict();

export const widgetSchema = z.object({
  type: z.enum(['signup', 'contact']),
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).nullish(),
  fields: z.array(field).min(1).max(10)
    .refine((fs) => new Set(fs.map((f) => f.name)).size === fs.length, 'field names must be unique'),
  buttonText: z.string().trim().min(1).max(40).default('Submit'),
  display: z.object({
    position: z.enum(['inline', 'floating']).default('inline'),
    accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#2563eb'),
  }).strict().default({}),
}).strict();

export const embedSnippet = (id) =>
  `<script async src="${config.publicBaseUrl}/widget.js?id=${id}&v=${bundleVersion}"></script>`;

const forOwner = (w) => w && { ...w, tenantId: undefined, embed: embedSnippet(w.id) };

export const create = async (tenantId, body) => forOwner(await repo.create(tenantId, widgetSchema.parse(body)));
export const list = async (tenantId) => (await repo.list(tenantId)).map(forOwner);

export async function get(tenantId, id) {
  const w = await repo.get(tenantId, id);
  if (!w) throw new HttpError(404, 'not_found', 'Widget not found'); // also for other tenants' widgets
  return forOwner(w);
}

export async function update(tenantId, id, patch) {
  const current = await get(tenantId, id);
  const merged = widgetSchema.parse({
    type: current.type, title: current.title, description: current.description, fields: current.fields,
    buttonText: current.buttonText, display: current.display, ...widgetSchema.partial().parse(patch),
  });
  return forOwner(await repo.update(tenantId, id, merged));
}

export async function remove(tenantId, id) {
  if (!(await repo.remove(tenantId, id))) throw new HttpError(404, 'not_found', 'Widget not found');
}

// The only fields a browser on someone else's site ever sees.
export async function publicConfig(id) {
  const w = await repo.getById(id);
  if (!w) throw new HttpError(404, 'not_found', 'Widget not found');
  return { id: w.id, type: w.type, title: w.title, description: w.description, fields: w.fields, buttonText: w.buttonText, display: w.display };
}
