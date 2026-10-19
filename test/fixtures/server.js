import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { createServer } from '../../src/server.js';

serveStdio(() => createServer({ call: async (method, params) => {
  if (method === 'user.info' && params.handles === 'missing') throw new Error('Codeforces: User not found');
  if (method === 'user.info') return [{ handle: params.handles, rating: 1500 }];
  return [];
} }));
