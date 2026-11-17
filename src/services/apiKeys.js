import { createHash } from 'node:crypto';

// API keys are stored only as sha256 hashes; the plaintext is shown once (by the seed) and never logged.
export const hashKey = (key) => createHash('sha256').update(key).digest('hex');
