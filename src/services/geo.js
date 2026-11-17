import { config } from '../config.js';
import { toggles } from './toggles.js';

async function getJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(config.geoTimeoutMs) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

const real = {
  // ip-api.com: free, no key, 45 req/min, http only on the free tier
  A: async (ip) => {
    const d = await getJson(`http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,message,countryCode,city`);
    if (d.status !== 'success') throw new Error(d.message ?? 'lookup failed');
    return { country: d.countryCode, city: d.city || null };
  },
  // ipapi.co: free tier ~1000/day, no key
  B: async (ip) => {
    const d = await getJson(`https://ipapi.co/${encodeURIComponent(ip)}/json/`);
    if (d.error || !d.country_code) throw new Error(d.reason ?? 'lookup failed');
    return { country: d.country_code, city: d.city || null };
  },
};

// Deterministic stand-ins so the fallback proof doesn't depend on the internet or on the caller's IP.
const mock = {
  A: async () => ({ country: 'DE', city: 'Berlin' }),
  B: async () => ({ country: 'NL', city: 'Amsterdam' }),
};

const impl = config.geoMode === 'real' ? real : mock;
const providers = [
  { name: 'ip-api.com', toggle: 'geoA', lookup: impl.A },
  { name: 'ipapi.co', toggle: 'geoB', lookup: impl.B },
];

// Tries each provider in order. Never throws: no provider = no geo, the submission still goes through.
export async function lookupGeo(ip) {
  for (const p of providers) {
    try {
      if (toggles[p.toggle] === 'down') throw new Error('provider disabled (toggle)');
      return { ...(await p.lookup(ip)), provider: p.name };
    } catch (err) {
      console.warn(`[geo] ${p.name} failed: ${err.message}`);
    }
  }
  return null;
}
