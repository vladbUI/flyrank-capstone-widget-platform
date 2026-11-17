import { migrate } from './migrate.js';
import { pool } from './db.js';
import * as tenants from './data/tenants.js';
import * as widgets from './data/widgets.js';
import { widgetSchema, embedSnippet } from './services/widgets.js';
import { hashKey } from './services/apiKeys.js';

// Fixed ids so the test site (test-site/index.html) and the probes can reference them. Re-runnable.
const SEED = {
  tenantA: 'a0000000-0000-4000-8000-00000000000a',
  tenantB: 'b0000000-0000-4000-8000-00000000000b',
  newsletterA: '11111111-1111-4111-8111-111111111111',
  contactA: '22222222-2222-4222-8222-222222222222',
  newsletterB: '33333333-3333-4333-8333-333333333333',
};

const keyA = process.env.DEMO_KEY_A || 'demo-key-tenant-a';
const keyB = process.env.DEMO_KEY_B || 'demo-key-tenant-b';

await migrate();
await tenants.upsert({ id: SEED.tenantA, name: 'Acme Coffee', apiKeyHash: hashKey(keyA), notifyEmail: 'owner@acme.test' });
await tenants.upsert({ id: SEED.tenantB, name: 'Globex Books', apiKeyHash: hashKey(keyB), notifyEmail: 'owner@globex.test' });

const newsletter = (title) => widgetSchema.parse({
  type: 'signup', title, description: 'One email a month. No spam.', buttonText: 'Subscribe',
  fields: [
    { name: 'email', label: 'Email', type: 'email', required: true },
    { name: 'name', label: 'First name', type: 'text', maxLength: 60 },
  ],
});
const contact = widgetSchema.parse({
  type: 'contact', title: 'Talk to us', buttonText: 'Send', display: { position: 'floating', accentColor: '#16a34a' },
  fields: [
    { name: 'email', label: 'Email', type: 'email', required: true },
    { name: 'message', label: 'Message', type: 'textarea', required: true, maxLength: 1000 },
  ],
});

await widgets.create(SEED.tenantA, newsletter('Acme newsletter'), SEED.newsletterA);
await widgets.create(SEED.tenantA, contact, SEED.contactA);
await widgets.create(SEED.tenantB, newsletter('Globex newsletter'), SEED.newsletterB);

console.log(`Seeded.
  Tenant A (Acme)   API key: ${keyA}   widgets: ${SEED.newsletterA}, ${SEED.contactA}
  Tenant B (Globex) API key: ${keyB}   widgets: ${SEED.newsletterB}
  Embed: ${embedSnippet(SEED.newsletterA)}`);
await pool.end();
