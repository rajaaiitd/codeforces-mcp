import { CodeforcesClient, CodeforcesError, RequestScheduler, defaultFetch } from '../api.js';

const publicMethods = new Set(['user.info', 'user.rating', 'user.status', 'contest.list', 'problemset.problems', 'contest.standings', 'contest.status', 'contest.ratingChanges']);
const privateMethods = new Set(['user.friends', 'contest.list', 'contest.standings']);

// One instance lives in a single Durable Object, coordinating all upstream calls.
export class Coordinator {
  constructor({ scheduler = new RequestScheduler(), fetchImpl = defaultFetch, now = Date.now } = {}) {
    Object.assign(this, { scheduler, fetchImpl, now });
    this.publicApi = new CodeforcesClient({ scheduler, fetchImpl, now });
    this.buckets = new Map();
  }

  async call(method, params = {}, ttlMs = 30000, credentials) {
    if (!(credentials ? privateMethods : publicMethods).has(method)) throw new CodeforcesError('Unsupported Codeforces method.');
    if (credentials) {
      // A new private client per call: no cross-account caches or retained credentials.
      return new CodeforcesClient({ scheduler: this.scheduler, fetchImpl: this.fetchImpl, now: this.now, credentials }).authenticatedCall(method, params, 0);
    }
    return this.publicApi.call(method, params, ttlMs);
  }

  async verifyCredentials(credentials) {
    await this.call('user.friends', { onlyOnline: false }, 0, credentials);
    return true;
  }

  allowRequest(key, limit, seconds = 60) {
    const now = this.now();
    // Bound the map; expired entries are removed before admitting new clients.
    if (this.buckets.size >= 10000) {
      for (const [id, bucket] of this.buckets) if (bucket.until <= now) this.buckets.delete(id);
      if (this.buckets.size >= 10000 && !this.buckets.has(key)) return false;
    }
    let bucket = this.buckets.get(key);
    if (!bucket || bucket.until <= now) {
      bucket = { count: 0, until: now + seconds * 1000 };
      this.buckets.set(key, bucket);
    }
    return ++bucket.count <= limit;
  }
}
