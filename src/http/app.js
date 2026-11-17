import express from 'express';
import { config } from '../config.js';
import { errorHandler, HttpError } from './errors.js';
import { publicRouter, adminRouter, devRouter, dashboardPage } from './routes.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);

  app.get('/health', (req, res) => res.json({ ok: true }));
  app.get('/dashboard', (req, res) => res.sendFile(dashboardPage));
  app.use(publicRouter);
  app.use('/v1/admin', adminRouter);
  if (config.devTools) app.use('/dev', devRouter);

  app.use((req, res, next) => next(new HttpError(404, 'not_found', 'Route not found')));
  app.use(errorHandler);
  return app;
}
