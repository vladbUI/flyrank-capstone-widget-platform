const env = process.env;
const int = (v, d) => (v === undefined || v === '' ? d : Number.parseInt(v, 10));

export const config = {
  port: int(env.PORT, 3000),
  databaseUrl: env.DATABASE_URL ?? 'postgres://widget:widget@localhost:5432/widgets',
  publicBaseUrl: (env.PUBLIC_BASE_URL ?? 'http://localhost:3000').replace(/\/$/, ''),
  // "2" → hop count (number); "10.0.0.0/8" → subnet; unset/"false" → ignore X-Forwarded-For (spoofable)
  trustProxy: !env.TRUST_PROXY || env.TRUST_PROXY === 'false' ? false : /^\d+$/.test(env.TRUST_PROXY) ? Number(env.TRUST_PROXY) : env.TRUST_PROXY,
  geoMode: env.GEO_MODE === 'real' ? 'real' : 'mock',
  geoTimeoutMs: int(env.GEO_TIMEOUT_MS, 1500),
  devTools: env.DEV_TOOLS === 'true',
  bodyLimit: '10kb',
  rateLimits: {
    ipWidget: { max: int(env.RATE_LIMIT_IP_WIDGET_MAX, 20), windowMs: int(env.RATE_LIMIT_IP_WIDGET_WINDOW_MS, 10_000) },
    widget: { max: int(env.RATE_LIMIT_WIDGET_MAX, 100), windowMs: int(env.RATE_LIMIT_WIDGET_WINDOW_MS, 60_000) },
  },
};
