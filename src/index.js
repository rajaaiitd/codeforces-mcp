#!/usr/bin/env node
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { createServer } from './server.js';
import { CodeforcesClient } from './api.js';

const apiKey = process.env.CODEFORCES_API_KEY;
const apiSecret = process.env.CODEFORCES_API_SECRET;
if (Boolean(apiKey) !== Boolean(apiSecret)) throw new Error('Set both CODEFORCES_API_KEY and CODEFORCES_API_SECRET.');
const credentials = apiKey ? { apiKey, apiSecret } : undefined;
const handle = serveStdio(() => createServer(new CodeforcesClient({ credentials }), { authenticated: Boolean(credentials) }));
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => { void handle.close(); });
}
