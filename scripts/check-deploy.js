import { readFileSync } from 'node:fs';

const config = JSON.parse(readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
if (config.vars.PUBLIC_ORIGIN.includes('YOUR_SUBDOMAIN') || config.kv_namespaces[0].id === '0'.repeat(32)) {
  console.error('Set PUBLIC_ORIGIN and the OAUTH_KV namespace ID in wrangler.jsonc before deploying. See DEPLOY.md.');
  process.exitCode = 1;
}
