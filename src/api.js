import { setTimeout as sleep } from 'node:timers/promises';
import { createHash, randomBytes } from 'node:crypto';

export class CodeforcesError extends Error {}

// Calls the built-in fetch from its home object. Cloudflare Workers throw
// "Illegal invocation" if fetch is stored on another object and called from
// there (e.g. this.fetchImpl(url)), so we always store this wrapper instead.
export const defaultFetch = (...args) => globalThis.fetch(...args);

export class RequestScheduler {
  constructor({ now = Date.now, wait = sleep, intervalMs = 2100, maxPending = 8, nextRequestAt = 0, persist = () => {} } = {}) {
    Object.assign(this, { now, wait, intervalMs, maxPending, nextRequestAt, persist });
    this.queue = Promise.resolve();
    this.pending = 0;
  }
  run(operation) {
    if (this.pending >= this.maxPending) return Promise.reject(new CodeforcesError('Codeforces is busy. Please try again shortly.'));
    this.pending++;
    const result = this.queue.then(operation);
    this.queue = result.catch(() => {});
    return result.finally(() => { this.pending--; });
  }
  setNext(time) { this.nextRequestAt = time; this.persist(time); }
  async beforeRequest() {
    const delay = this.nextRequestAt - this.now();
    if (delay > 0) await this.wait(delay);
    this.setNext(this.now() + this.intervalMs);
  }
}

export function signedUrl(method, params, credentials, { now = Date.now, nonce = () => randomBytes(3).toString('hex') } = {}) {
  const values = Object.fromEntries(Object.entries(params).filter(([, value]) => value !== undefined).map(([key, value]) => [key, String(value)]));
  const url = new URL(`https://codeforces.com/api/${method}`);
  if (credentials) {
    values.apiKey = credentials.apiKey;
    values.time = String(Math.floor(now() / 1000));
    const prefix = nonce();
    const canonical = Object.keys(values).sort().map(key => `${key}=${values[key]}`).join('&');
    values.apiSig = prefix + createHash('sha512').update(`${prefix}/${method}?${canonical}#${credentials.apiSecret}`).digest('hex');
  }
  for (const key of Object.keys(values).sort()) url.searchParams.set(key, values[key]);
  return url;
}

export class CodeforcesClient {
  constructor({ fetchImpl = defaultFetch, now = Date.now, wait = sleep,
    intervalMs = 2100, timeoutMs = 20000, maxCacheEntries = 32, scheduler, credentials } = {}) {
    Object.assign(this, { fetchImpl, now, timeoutMs, maxCacheEntries, credentials });
    this.scheduler = scheduler ?? new RequestScheduler({ now, wait, intervalMs });
    this.cache = new Map();
    this.pending = new Map();
  }

  authenticatedCall(method, params = {}, ttlMs = 0) {
    if (!this.credentials) throw new CodeforcesError('Connect your Codeforces account to use this tool.');
    return this.call(method, params, ttlMs, true);
  }

  async call(method, params = {}, ttlMs = 30000, authenticated = false) {
    const url = new URL(`https://codeforces.com/api/${method}`);
    for (const key of Object.keys(params).sort()) {
      if (params[key] !== undefined) url.searchParams.set(key, String(params[key]));
    }
    const key = `${authenticated ? 'authenticated:' : 'public:'}${url.href}`;
    const cached = this.cache.get(key);
    if (cached && cached.expires > this.now()) return cached.value;
    if (this.pending.has(key)) return this.pending.get(key);

    const request = this.scheduler.run(async () => {
      // Serialize all calls, including retries, so concurrent tools share the limit.
      for (let attempt = 0; attempt < 3; attempt++) {
        await this.scheduler.beforeRequest();
        // Sign after queueing, with a fresh timestamp and nonce for every retry.
        const requestUrl = authenticated ? signedUrl(method, params, this.credentials, { now: this.now }) : url;
        let response;
        let body;
        try {
          response = await this.fetchImpl(requestUrl, {
            headers: { Accept: 'application/json', 'User-Agent': 'codeforces-mcp/1.0' },
            signal: AbortSignal.timeout(this.timeoutMs),
          });
          if (!response.ok) {
            if ((response.status === 429 || response.status >= 500) && attempt < 2) {
              this.scheduler.setNext(this.now() + this.scheduler.intervalMs * 2 ** (attempt + 1));
              continue;
            }
            throw new CodeforcesError(`Codeforces returned HTTP ${response.status}. Please try again later.`);
          }
          body = await response.json();
        } catch (error) {
          if (error instanceof CodeforcesError) throw error;
          if (error.name === 'TimeoutError' || error.name === 'AbortError') {
            throw new CodeforcesError('Codeforces request timed out. Please try again.');
          }
          throw new CodeforcesError('Could not read the Codeforces API. Check your network or try again later.');
        }
        if (body?.status === 'FAILED') {
          const comment = String(body.comment ?? 'Unknown API error');
          if (/call limit exceeded/i.test(comment) && attempt < 2) {
            this.scheduler.setNext(this.now() + this.scheduler.intervalMs * 2 ** (attempt + 1));
            continue;
          }
          throw new CodeforcesError(authenticated
            ? 'Codeforces rejected the authenticated request. Check your API key, secret, and account permissions.'
            : `Codeforces: ${comment}`);
        }
        if (body?.status !== 'OK' || !Object.hasOwn(body, 'result')) {
          throw new CodeforcesError('Codeforces returned an unexpected response.');
        }
        if (ttlMs > 0) {
          this.cache.delete(key);
          if (this.cache.size >= this.maxCacheEntries) this.cache.delete(this.cache.keys().next().value);
          this.cache.set(key, { value: body.result, expires: this.now() + ttlMs });
        }
        return body.result;
      }
    });
    this.pending.set(key, request);
    try { return await request; } finally { this.pending.delete(key); }
  }
}
