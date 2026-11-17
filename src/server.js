import { config } from './config.js';
import { migrate } from './migrate.js';
import { createApp } from './http/app.js';
import { startWorker } from './services/worker.js';

await migrate();
createApp().listen(config.port, () =>
  console.log(`[api] listening on :${config.port} (geo=${config.geoMode}, devTools=${config.devTools})`));
startWorker();

process.on('SIGTERM', () => process.exit(0)); // node as PID 1 in Docker ignores SIGTERM otherwise
