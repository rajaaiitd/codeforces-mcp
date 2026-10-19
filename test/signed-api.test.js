import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { CodeforcesClient, RequestScheduler, signedUrl } from '../src/api.js';
import { Coordinator } from '../src/cloudflare/coordinator.js';

test('Codeforces signature follows sorted raw parameters and SHA-512 specification', () => {
  const credentials = { apiKey: 'xxx', apiSecret: 'yyy' };
  const url = signedUrl('contest.hacks', { contestId: 566 }, credentials, { now: () => 1792408103000, nonce: () => '123456' });
  const expected = createHash('sha512').update('123456/contest.hacks?apiKey=xxx&contestId=566&time=1792408103#yyy').digest('hex');
  assert.equal(url.searchParams.get('apiSig'), `123456${expected}`);
  assert.ok(!url.href.includes('yyy'));
  const tagged = signedUrl('problemset.problems', { tags: 'dfs and similar;graphs' }, credentials, { now: () => 1000, nonce: () => 'abcdef' });
  const hash = createHash('sha512').update('abcdef/problemset.problems?apiKey=xxx&tags=dfs and similar;graphs&time=1#yyy').digest('hex');
  assert.equal(tagged.searchParams.get('apiSig'), `abcdef${hash}`);
});

test('authenticated requests are signed after queue delay and on every retry', async () => {
  let now = 1000;
  const urls = [];
  const scheduler = new RequestScheduler({ now: () => now, nextRequestAt: 100000, wait: async ms => { now += ms; } });
  const api = new CodeforcesClient({ scheduler, now: () => now, credentials: { apiKey: 'key', apiSecret: 'secret' }, fetchImpl: async url => {
    urls.push(url);
    return urls.length === 1 ? new Response('', { status: 503 }) : Response.json({ status: 'OK', result: [] });
  } });
  await api.authenticatedCall('user.friends');
  assert.equal(urls[0].searchParams.get('time'), '100');
  assert.equal(urls[1].searchParams.get('time'), '104');
  assert.notEqual(urls[0].searchParams.get('apiSig'), urls[1].searchParams.get('apiSig'));
});

test('coordinator isolates account requests and leaves public standings anonymous', async () => {
  const seen = [];
  const coordinator = new Coordinator({ scheduler: new RequestScheduler({ intervalMs: 0 }), fetchImpl: async url => {
    seen.push(new URL(url));
    return Response.json({ status: 'OK', result: [url.searchParams.get('apiKey') ?? 'public'] });
  } });
  assert.deepEqual(await coordinator.call('user.friends', {}, 0, { apiKey: 'accountA', apiSecret: 'secretA' }), ['accountA']);
  assert.deepEqual(await coordinator.call('user.friends', {}, 0, { apiKey: 'accountB', apiSecret: 'secretB' }), ['accountB']);
  assert.deepEqual(await coordinator.call('contest.standings', { contestId: 566 }), ['public']);
  assert.equal(seen[2].search, '?contestId=566');
  await assert.rejects(coordinator.call('user.friends'), /Unsupported/);
});

test('credential-bearing API errors are redacted', async () => {
  const api = new CodeforcesClient({ credentials: { apiKey: 'key', apiSecret: 'secret' }, fetchImpl: async () => Response.json({ status: 'FAILED', comment: 'invalid key=key secret=secret' }) });
  await assert.rejects(api.authenticatedCall('user.friends'), error => !error.message.includes('key=key') && !error.message.includes('secret=secret'));
});

test('shared queue and inbound rate limiter refuse excess work', async () => {
  const scheduler = new RequestScheduler({ maxPending: 1 });
  let release;
  const first = scheduler.run(() => new Promise(resolve => { release = resolve; }));
  await assert.rejects(scheduler.run(async () => {}), /busy/);
  release(); await first;
  let now = 0;
  const coordinator = new Coordinator({ now: () => now });
  assert.equal(coordinator.allowRequest('client', 1), true);
  assert.equal(coordinator.allowRequest('client', 1), false);
  now = 61000;
  assert.equal(coordinator.allowRequest('client', 1), true);
});
