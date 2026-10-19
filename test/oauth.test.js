import './fixtures/cloudflare-loader.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { Coordinator } from '../src/cloudflare/coordinator.js';
import { RequestScheduler } from '../src/api.js';
const { createApp } = await import('../src/cloudflare/app.js');

class MemoryKV {
  records = new Map();
  async put(key, value, options = {}) {
    this.records.set(key, { value, metadata: options.metadata, expiration: options.expiration ?? (options.expirationTtl ? Date.now() / 1000 + options.expirationTtl : Infinity) });
  }
  async get(key, options) {
    const row = this.records.get(key);
    if (!row || row.expiration < Date.now() / 1000) return null;
    return (typeof options === 'string' ? options : options?.type) === 'json' ? JSON.parse(row.value) : row.value;
  }
  async delete(key) { this.records.delete(key); }
  async list({ prefix = '' } = {}) {
    return { keys: [...this.records].filter(([key, row]) => key.startsWith(prefix) && row.expiration >= Date.now() / 1000).map(([name, row]) => ({ name, metadata: row.metadata })), list_complete: true, cursor: '' };
  }
}

function harness() {
  const origin = 'https://mcp.example.test';
  const app = createApp(origin);
  const calls = [];
  const backend = new Coordinator({ scheduler: new RequestScheduler({ intervalMs: 0 }), fetchImpl: async url => {
    calls.push(new URL(url));
    const key = url.searchParams.get('apiKey');
    if (key === 'invalid-key') return Response.json({ status: 'FAILED', comment: 'Bad credentials' });
    if (url.pathname.endsWith('user.friends')) return Response.json({ status: 'OK', result: [`friend-of-${key}`] });
    return Response.json({ status: 'OK', result: [] });
  } });
  const env = { OAUTH_KV: new MemoryKV(), API_COORDINATOR: { getByName: () => backend }, ALLOWED_ORIGINS: 'https://trusted-client.test' };
  const request = async (path, init = {}) => {
    const waiting = [];
    const response = await app.fetch(new Request(new URL(path, origin), init), env, { waitUntil: p => waiting.push(p), passThroughOnException() {} });
    await Promise.all(waiting);
    return response;
  };
  const postForm = (path, body, headers = {}) => request(path, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...headers }, body: new URLSearchParams(body) });
  async function begin({ clientName = 'Test MCP client', overrides = {} } = {}) {
    const registration = await request('/oauth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ client_name: clientName, redirect_uris: ['http://localhost:4321/callback'], token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] }) });
    assert.equal(registration.status, 201, await registration.clone().text());
    const client = await registration.json();
    const verifier = randomBytes(32).toString('base64url');
    const query = new URLSearchParams({ client_id: client.client_id, redirect_uri: 'http://localhost:4321/callback', response_type: 'code', scope: 'codeforces:read offline_access', state: 'state-value', resource: `${origin}/mcp`, code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256', ...overrides });
    const page = await request(`/authorize?${query}`);
    const markup = await page.text();
    return { client, verifier, page, markup, handle: /name="handle" value="([^"]+)"/.exec(markup)?.[1], cookie: page.headers.getSetCookie().map(c => c.split(';')[0]).join('; ') };
  }
  async function approve(flow, apiKey = 'account-a-key', apiSecret = 'account-a-secret') {
    return postForm('/authorize', { handle: flow.handle, decision: 'approve', apiKey, apiSecret }, { Origin: origin, Cookie: flow.cookie });
  }
  async function exchange(flow, code, overrides = {}) {
    return postForm('/oauth/token', { grant_type: 'authorization_code', client_id: flow.client.client_id, code, redirect_uri: 'http://localhost:4321/callback', code_verifier: flow.verifier, resource: `${origin}/mcp`, ...overrides });
  }
  async function connect(apiKey, apiSecret) {
    const flow = await begin();
    assert.equal(flow.page.status, 200, flow.markup);
    const approved = await approve(flow, apiKey, apiSecret);
    assert.equal(approved.status, 302, await approved.clone().text());
    const redirect = new URL(approved.headers.get('Location'));
    assert.equal(redirect.searchParams.get('state'), 'state-value');
    assert.equal(redirect.searchParams.get('iss'), origin);
    const code = redirect.searchParams.get('code');
    const response = await exchange(flow, code);
    assert.equal(response.status, 200, await response.clone().text());
    return { flow, code, tokens: await response.json() };
  }
  async function mcp(accessToken, method, params = {}) {
    const response = await request('/mcp', { method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': '2025-11-25' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
    const text = await response.text();
    if (response.status !== 200) return { response, text };
    const message = response.headers.get('content-type').includes('text/event-stream') ? JSON.parse(text.split('\n').find(l => l.startsWith('data: ')).slice(6)) : JSON.parse(text);
    return { response, message };
  }
  return { origin, env, calls, request, postForm, begin, approve, exchange, connect, mcp };
}

test('OAuth discovery challenges unauthenticated requests and exposes correct audience', async () => {
  const h = harness();
  const missing = await h.request('/mcp', { method: 'POST' });
  assert.equal(missing.status, 401);
  assert.match(missing.headers.get('www-authenticate'), /resource_metadata=/);
  const metadata = await (await h.request('/.well-known/oauth-protected-resource/mcp')).json();
  assert.equal(metadata.resource, `${h.origin}/mcp`);
  const authorization = await (await h.request('/.well-known/oauth-authorization-server')).json();
  assert.equal(authorization.authorization_endpoint, `${h.origin}/authorize`);
  assert.ok(authorization.code_challenge_methods_supported.includes('S256'));
});

// Real browsers send "Origin: null" on form posts from a page served with
// Referrer-Policy: no-referrer, which would fail the /authorize Origin check.
test('consent page keeps the browser Origin header so the login form can submit', async () => {
  const flow = await harness().begin();
  assert.equal(flow.page.status, 200);
  assert.equal(flow.page.headers.get('referrer-policy'), 'same-origin');
  // Chrome applies form-action to the redirect after Connect, so the client's
  // return address must be allowed or the browser silently stays on this page.
  assert.match(flow.page.headers.get('content-security-policy'), /form-action 'self' http:\/\/localhost:4321;/);
});

test('browser authorization, encrypted credentials, MCP tool call, refresh and revocation', async () => {
  const h = harness();
  const { flow, code, tokens } = await h.connect();
  assert.ok(tokens.access_token && tokens.refresh_token);
  const stored = JSON.stringify([...h.env.OAUTH_KV.records]);
  assert.ok(!stored.includes('account-a-secret'));
  assert.ok(!stored.includes('account-a-key'));
  assert.ok(!JSON.stringify(tokens).includes('account-a-secret'));
  const initialized = await h.mcp(tokens.access_token, 'initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
  assert.equal(initialized.message.result.serverInfo.name, 'codeforces');
  const listed = await h.mcp(tokens.access_token, 'tools/list');
  assert.equal(listed.message.result.tools.length, 11);
  const friends = await h.mcp(tokens.access_token, 'tools/call', { name: 'codeforces_my_friends', arguments: {} });
  assert.deepEqual(friends.message.result.structuredContent.items, ['friend-of-account-a-key']);
  const refreshed = await h.postForm('/oauth/token', { grant_type: 'refresh_token', client_id: flow.client.client_id, refresh_token: tokens.refresh_token, resource: `${h.origin}/mcp` });
  assert.equal(refreshed.status, 200, await refreshed.clone().text());
  const next = await refreshed.json();
  assert.notEqual(next.access_token, tokens.access_token);
  const revoked = await h.postForm('/oauth/token', { client_id: flow.client.client_id, token: next.refresh_token, token_type_hint: 'refresh_token' });
  assert.equal(revoked.status, 200);
  assert.equal((await h.mcp(next.access_token, 'tools/list')).response.status, 401);
});

test('reusing an authorization code rejects it and invalidates its grant', async () => {
  const h = harness();
  const { flow, code, tokens } = await h.connect();
  assert.equal((await h.exchange(flow, code)).status, 400);
  assert.equal((await h.mcp(tokens.access_token, 'tools/list')).response.status, 401);
});

test('two users cannot read each other’s authenticated Codeforces data', async () => {
  const h = harness();
  const a = await h.connect('account-a-key', 'account-a-secret');
  const b = await h.connect('account-b-key', 'account-b-secret');
  const results = await Promise.all([a, b, a].map(({ tokens }) => h.mcp(tokens.access_token, 'tools/call', { name: 'codeforces_my_friends', arguments: {} })));
  assert.deepEqual(results.map(r => r.message.result.structuredContent.items[0]), ['friend-of-account-a-key', 'friend-of-account-b-key', 'friend-of-account-a-key']);
});

test('CSRF, missing browser binding, and duplicate form fields never reach Codeforces', async () => {
  const h = harness();
  const flow = await h.begin();
  const fields = { handle: flow.handle, decision: 'approve', apiKey: 'account-a-key', apiSecret: 'account-a-secret' };
  assert.equal((await h.postForm('/authorize', fields, { Origin: 'https://evil.test', Cookie: flow.cookie })).status, 403);
  assert.equal((await h.postForm('/authorize', fields, { Origin: h.origin })).status, 400);
  const duplicated = new URLSearchParams(fields); duplicated.append('handle', 'another');
  assert.equal((await h.request('/authorize', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: h.origin, Cookie: flow.cookie }, body: duplicated })).status, 400);
  assert.equal(h.calls.length, 0);
});

test('invalid keys never issue tokens, errors do not reflect secrets, and users can retry', async () => {
  const h = harness();
  const flow = await h.begin();
  const response = await h.approve(flow, 'invalid-key', 'do-not-reflect-secret');
  assert.equal(response.status, 200);
  const markup = await response.text();
  assert.match(markup, /Could not verify/);
  assert.ok(!markup.includes('do-not-reflect-secret'));
  assert.equal([...h.env.OAUTH_KV.records.keys()].filter(k => k.startsWith('grant:')).length, 0);
});

test('consent names are escaped, denial returns state, and no credentials are requested on home page', async () => {
  const h = harness();
  const flow = await h.begin({ clientName: '<script>alert(1)</script>' });
  assert.ok(!flow.markup.includes('<script>'));
  assert.match(flow.markup, /&#60;script&#62;/);
  assert.match(flow.page.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  const denied = await h.postForm('/authorize', { handle: flow.handle, decision: 'deny' }, { Origin: h.origin, Cookie: flow.cookie });
  assert.equal(denied.status, 302);
  const redirect = new URL(denied.headers.get('location'));
  assert.equal(redirect.searchParams.get('error'), 'access_denied');
  assert.equal(redirect.searchParams.get('state'), 'state-value');
  assert.equal(h.calls.length, 0);
  assert.ok(!(await (await h.request('/')).text()).includes('name="apiSecret"'));
});

test('PKCE mismatch and wrong audience cannot exchange authorization codes', async () => {
  for (const overrides of [{ code_verifier: 'x'.repeat(43) }, { resource: 'https://other.example/mcp' }]) {
    const h = harness();
    const flow = await h.begin();
    const approved = await h.approve(flow);
    const code = new URL(approved.headers.get('location')).searchParams.get('code');
    assert.equal((await h.exchange(flow, code, overrides)).status, 400);
  }
});

test('unexpected hosts, browser origins, arbitrary redirects and excess registration are rejected', async () => {
  const h = harness();
  assert.equal((await h.request('https://evil.test/health')).status, 421);
  assert.equal((await h.request('/mcp', { headers: { Origin: 'https://evil.test' } })).status, 403);
  const preflight = await h.request('/mcp', { method: 'OPTIONS', headers: { Origin: 'https://trusted-client.test' } });
  assert.equal(preflight.headers.get('access-control-allow-origin'), 'https://trusted-client.test');
  const invalid = await h.begin({ overrides: { redirect_uri: 'https://evil.test/callback' } });
  assert.equal(invalid.page.status, 400);
  assert.equal(invalid.page.headers.get('location'), null);
  for (let i = 0; i < 9; i++) await h.request('/oauth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal((await h.request('/oauth/register', { method: 'POST' })).status, 429);
});
