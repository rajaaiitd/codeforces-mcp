import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CodeforcesClient } from '../src/api.js';

const ok = result => Response.json({ status: 'OK', result });
function setup(responses = [ok([])]) {
  let time = 0;
  const calls = [];
  const api = new CodeforcesClient({
    now: () => time, wait: async ms => { time += ms; },
    fetchImpl: async url => { calls.push({ url: new URL(url), time }); const result = responses.shift(); if (result instanceof Error) throw result; return result ?? ok([]); },
  });
  return { api, calls, advance: ms => { time += ms; } };
}

test('concurrent requests share throttling; handle lists are encoded safely', async () => {
  const { api, calls } = setup();
  await Promise.all([api.call('user.info', { handles: 'a;b' }), api.call('contest.list'), api.call('user.rating', { handle: 'a' })]);
  assert.deepEqual(calls.map(c => c.time), [0, 2100, 4200]);
  assert.equal(calls[0].url.searchParams.get('handles'), 'a;b');
  assert.equal(calls[0].url.origin, 'https://codeforces.com');
});

test('identical in-flight requests coalesce, cache expires', async () => {
  const { api, calls, advance } = setup([ok([1]), ok([2])]);
  const results = await Promise.all([api.call('user.info'), api.call('user.info')]);
  assert.deepEqual(results, [[1], [1]]);
  await api.call('user.info');
  assert.equal(calls.length, 1);
  advance(30001);
  assert.deepEqual(await api.call('user.info'), [2]);
  assert.equal(calls.length, 2);
});

test('API rate limit and HTTP failures retry with backoff', async () => {
  const { api, calls } = setup([Response.json({ status: 'FAILED', comment: 'Call limit exceeded' }), new Response('', { status: 503 }), ok([3])]);
  assert.deepEqual(await api.call('user.info'), [3]);
  assert.deepEqual(calls.map(c => c.time), [0, 4200, 12600]);
});

test('retries stop after three attempts', async () => {
  const { api, calls } = setup(Array.from({ length: 3 }, () => new Response('', { status: 429 })));
  await assert.rejects(api.call('user.info'), /HTTP 429/);
  assert.equal(calls.length, 3);
});

test('API failure is surfaced, not cached, and does not poison queue', async () => {
  const { api, calls } = setup([Response.json({ status: 'FAILED', comment: 'handle: User not found' }), ok([1])]);
  await assert.rejects(api.call('user.info'), /User not found/);
  assert.deepEqual(await api.call('user.info'), [1]);
  assert.equal(calls.length, 2);
});

test('malformed JSON, invalid envelope, timeout, and network errors are useful', async () => {
  for (const [response, pattern] of [
    [new Response('<html>blocked</html>'), /Could not read/],
    [Response.json({ status: 'OK' }), /unexpected response/],
    [new DOMException('timed out', 'TimeoutError'), /timed out/],
    [new TypeError('fetch failed'), /Check your network/],
    [new Response('', { status: 403 }), /HTTP 403/],
  ]) {
    await assert.rejects(setup([response]).api.call('user.info'), pattern);
  }
});

test('cache has a bounded number of entries', async () => {
  const { api } = setup();
  api.maxCacheEntries = 2;
  await api.call('user.info', { handles: 'a' });
  await api.call('user.info', { handles: 'b' });
  await api.call('user.info', { handles: 'c' });
  assert.equal(api.cache.size, 2);
});

// Cloudflare Workers reject fetch called as a method of another object
// ("Illegal invocation"). Mimic that so the default fetch is always called safely.
test('default fetch is called the way Cloudflare Workers require', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = function (url) {
    if (this !== undefined && this !== globalThis) throw new TypeError('Illegal invocation');
    return Promise.resolve(Response.json({ status: 'OK', result: [{ handle: 'tourist' }] }));
  };
  try {
    const client = new CodeforcesClient({ wait: async () => {} });
    assert.deepEqual(await client.call('user.info', { handles: 'tourist' }, 0), [{ handle: 'tourist' }]);
  } finally {
    globalThis.fetch = realFetch;
  }
});
