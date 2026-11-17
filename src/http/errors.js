import { ZodError } from 'zod';

export class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

// Single place that turns any thrown error into a JSON response. Unknown errors → 500 without internals.
export function errorHandler(err, req, res, _next) {
  if (err instanceof ZodError) {
    return res.status(400).json({
      error: { code: 'validation_failed', message: 'Request validation failed',
        details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) },
    });
  }
  if (err.type === 'entity.too.large') return res.status(413).json({ error: { code: 'payload_too_large', message: 'Request body is too large' } });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: { code: 'malformed_json', message: 'Request body is not valid JSON' } });
  if (err instanceof HttpError) return res.status(err.status).json({ error: { code: err.code, message: err.message } });
  const status = err.status ?? err.statusCode;
  if (status >= 400 && status < 500) return res.status(status).json({ error: { code: 'bad_request', message: err.message } });

  console.error('[error]', req.method, req.originalUrl, err);
  res.status(500).json({ error: { code: 'internal', message: 'Internal server error' } });
}
