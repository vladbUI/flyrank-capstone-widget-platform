import express from 'express';
import { z } from 'zod';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';
import * as widgets from '../services/widgets.js';
import * as submissions from '../services/submissions.js';
import { bundleCode, bundleVersion } from '../services/bundle.js';
import { toggles } from '../services/toggles.js';
import { publicCors, rateLimit, requireTenant, widgetIdParam } from './middleware.js';

// ---- Customer site: script + config (public, cached) -------------------------------------------
export const publicRouter = express.Router();

publicRouter.get('/widget.js', (req, res) => {
  // Matching version → the URL is content-addressed, cache "forever". Anything else → short cache.
  res.set('Cache-Control', req.query.v === bundleVersion ? 'public, max-age=31536000, immutable' : 'public, max-age=300');
  res.type('application/javascript').send(bundleCode);
});

const widgetApi = express.Router();
publicRouter.use('/v1/widgets', widgetApi);
widgetApi.use(publicCors);

widgetApi.get('/:id/config', async (req, res) => {
  const cfg = await widgets.publicConfig(widgetIdParam(req));
  res.set('Cache-Control', 'public, max-age=60'); // owner edits show up within a minute
  res.json(cfg);
});

// ---- Visitor: submissions (public, CORS, protected) --------------------------------------------
const { ipWidget, widget } = config.rateLimits;
widgetApi.post('/:id/submissions',
  rateLimit({ ...ipWidget, key: (req) => `${req.ip}|${req.params.id}` }),
  rateLimit({ ...widget, key: (req) => req.params.id }),
  express.json({ limit: config.bodyLimit }),
  async (req, res) => {
    const r = await submissions.submit({
      widgetId: widgetIdParam(req), body: req.body, ip: req.ip, idempotencyKey: req.get('idempotency-key'),
    });
    if (r.spam) return res.status(202).json({ ok: true });
    res.status(r.status).json({ id: r.submission.id, geo: r.submission.geo, replay: Boolean(r.replay) });
  });

// ---- Owner: admin + dashboard API (Bearer API key) ---------------------------------------------
export const adminRouter = express.Router();
adminRouter.use(express.json({ limit: '100kb' }), requireTenant);

adminRouter.post('/widgets', async (req, res) => res.status(201).json(await widgets.create(req.tenant.id, req.body)));
adminRouter.get('/widgets', async (req, res) => res.json({ data: await widgets.list(req.tenant.id) }));
adminRouter.get('/widgets/:id', async (req, res) => res.json(await widgets.get(req.tenant.id, widgetIdParam(req))));
adminRouter.patch('/widgets/:id', async (req, res) => res.json(await widgets.update(req.tenant.id, widgetIdParam(req), req.body)));
adminRouter.delete('/widgets/:id', async (req, res) => {
  await widgets.remove(req.tenant.id, widgetIdParam(req));
  res.status(204).end();
});
adminRouter.get('/submissions', async (req, res) => res.json({ data: await submissions.list(req.tenant.id, req.query) }));
adminRouter.get('/stats', async (req, res) => res.json(await submissions.stats(req.tenant.id, req.query)));

// ---- Dev-only failure switches (mounted only when DEV_TOOLS=true) -------------------------------
export const devRouter = express.Router();
devRouter.get('/toggles', (req, res) => res.json(toggles));
devRouter.post('/toggles', express.json(), (req, res) => {
  Object.assign(toggles, z.object({
    geoA: z.enum(['up', 'down']), geoB: z.enum(['up', 'down']), email: z.enum(['ok', 'fail']),
  }).partial().strict().parse(req.body ?? {}));
  console.log('[dev] toggles now', toggles);
  res.json(toggles);
});

export const dashboardPage = fileURLToPath(new URL('../../public/dashboard.html', import.meta.url));
