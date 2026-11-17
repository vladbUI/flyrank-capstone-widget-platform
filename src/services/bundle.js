import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

// The widget bundle is read once at boot; its content hash is the version in every embed snippet.
export const bundleCode = readFileSync(new URL('../../public/widget.js', import.meta.url), 'utf8');
export const bundleVersion = createHash('sha256').update(bundleCode).digest('hex').slice(0, 12);
