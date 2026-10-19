import { DurableObject } from 'cloudflare:workers';
import { Coordinator } from './coordinator.js';
import { RequestScheduler } from '../api.js';
import { createApp } from './app.js';

export class ApiCoordinator extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    const sql = ctx.storage.sql;
    sql.exec('CREATE TABLE IF NOT EXISTS scheduler (id INTEGER PRIMARY KEY, next_at REAL NOT NULL)');
    const rows = sql.exec('SELECT next_at FROM scheduler WHERE id = 1').toArray();
    const scheduler = new RequestScheduler({
      nextRequestAt: rows[0]?.next_at ?? 0,
      persist: time => sql.exec('INSERT INTO scheduler (id, next_at) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET next_at = excluded.next_at', time),
    });
    this.coordinator = new Coordinator({ scheduler });
  }
  call(method, params, ttl, credentials) { return this.coordinator.call(method, params, ttl, credentials); }
  verifyCredentials(credentials) { return this.coordinator.verifyCredentials(credentials); }
  allowRequest(key, limit) { return this.coordinator.allowRequest(key, limit); }
}

let app;
let currentOrigin;
export default {
  async fetch(request, env, ctx) {
    try {
      if (!app || currentOrigin !== env.PUBLIC_ORIGIN) { app = createApp(env.PUBLIC_ORIGIN); currentOrigin = env.PUBLIC_ORIGIN; }
      return await app.fetch(request, env, ctx);
    } catch {
      return new Response('Service configuration is unavailable.', { status: 503 });
    }
  },
};
