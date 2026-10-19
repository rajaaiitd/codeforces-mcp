import { createHash } from 'node:crypto';
import { createMcpHandler } from '@modelcontextprotocol/server';
import { OAuthProvider, AuthorizationError, CimdFetchError, insufficientScope } from '@cloudflare/workers-oauth-provider';
import { createServer } from '../server.js';
import { consentPage, homePage, html, page } from './pages.js';

export const READ_SCOPE = 'codeforces:read';
const allowedScopes = [READ_SCOPE, 'offline_access'];
const credentialPattern = /^[A-Za-z0-9_-]{8,256}$/;
const digest = value => createHash('sha256').update(value).digest('hex');
const coordinator = env => env.API_COORDINATOR.getByName('global');

// Where the browser goes back to after Connect/Cancel, as a CSP source.
// Web/loopback addresses use their origin ("http://localhost:51402"); app links
// like "cursor://callback" have no origin, so allow just their scheme ("cursor:").
function returnTarget(redirectUri) {
  const url = new URL(redirectUri);
  return url.origin === 'null' ? url.protocol : url.origin;
}

export function canonicalOrigin(value) {
  const url = new URL(value);
  if (url.href !== `${url.origin}/` || url.username || url.password ||
    !(url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) {
    throw new Error('PUBLIC_ORIGIN must be an HTTPS origin (or HTTP localhost for development).');
  }
  return url.origin;
}

async function readForm(request) {
  if (!(request.headers.get('content-type') ?? '').startsWith('application/x-www-form-urlencoded')) throw new Error('Invalid form');
  const reader = request.body?.getReader();
  let text = '', bytes = 0;
  if (!reader) throw new Error('Missing form');
  const decoder = new TextDecoder();
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > 8192) { await reader.cancel(); throw new Error('Form too large'); }
    text += decoder.decode(value, { stream: true });
  }
  text += decoder.decode();
  const form = new URLSearchParams(text);
  for (const key of form.keys()) if (form.getAll(key).length !== 1) throw new Error('Duplicate form field');
  return form;
}

async function showConsent(oauth, authRequest, error = '') {
  if (authRequest.scope.some(s => !allowedScopes.includes(s))) return html(page('Unsupported permission', '<h1>Unsupported permission</h1><p>Reconnect using the Codeforces read permission.</p>'), { status: 400 });
  // This page always explicitly asks for the read permission required by /mcp.
  if (!authRequest.scope.includes(READ_SCOPE)) authRequest.scope.push(READ_SCOPE);
  const details = await oauth.describeConsent(authRequest);
  const consent = await oauth.beginConsent(authRequest);
  return html(consentPage(details, consent.handle, error), { headers: consent.headers, formTargets: [returnTarget(authRequest.redirectUri)] });
}

async function authorize(request, env, origin) {
  const oauth = env.OAUTH_PROVIDER;
  if (request.method === 'GET') {
    try { return await showConsent(oauth, await oauth.parseAuthRequest(request)); }
    catch (error) {
      if (error instanceof AuthorizationError && error.redirectTo) return Response.redirect(error.redirectTo, 302);
      if (error instanceof AuthorizationError || error instanceof CimdFetchError) {
        return html(page('Connection unavailable', '<h1>Connection unavailable</h1><p>The authorization request is invalid or expired. Start the connection again from your MCP client.</p>'), { status: 400 });
      }
      throw error;
    }
  }
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  if (request.headers.get('origin') !== origin) return new Response('Invalid form origin', { status: 403 });
  let form;
  try { form = await readForm(request); } catch { return new Response('Invalid form', { status: 400 }); }
  try {
    const handle = form.get('handle') ?? '';
    if (form.get('decision') === 'deny') {
      const denied = await oauth.denyConsent(request, handle);
      return new Response(null, { status: 302, headers: denied.headers });
    }
    if (form.get('decision') !== 'approve') return new Response('Invalid decision', { status: 400 });
    // Browser binding and one-time consent are checked before any upstream request.
    const approved = await oauth.approveConsent(request, handle);
    const credentials = { apiKey: (form.get('apiKey') ?? '').trim(), apiSecret: (form.get('apiSecret') ?? '').trim() };
    if (!credentialPattern.test(credentials.apiKey) || !credentialPattern.test(credentials.apiSecret)) {
      return showConsent(oauth, approved.request, 'Enter the API key and secret from Codeforces API settings.');
    }
    try { await coordinator(env).verifyCredentials(credentials); }
    catch { return showConsent(oauth, approved.request, 'Could not verify your Codeforces credentials. Check the key and secret, or try again shortly.'); }
    const { redirectTo } = await oauth.completeAuthorization({
      request: approved.request,
      // Codeforces has no who-am-I endpoint. Identify the connection by key hash,
      // never by an unverified user-supplied handle.
      userId: digest(`codeforces:${credentials.apiKey}`),
      metadata: { label: 'Codeforces account' },
      scope: approved.request.scope,
      props: { credentials }, // The provider encrypts props at rest; never put these in metadata.
    });
    approved.headers.set('Location', redirectTo);
    return new Response(null, { status: 302, headers: approved.headers });
  } catch (error) {
    if (error instanceof AuthorizationError || error instanceof CimdFetchError) {
      return html(page('Start again', '<h1>Start the connection again</h1><p>This page expired, was already used, or belongs to another browser.</p>'), { status: 400 });
    }
    throw error;
  }
}

export function createApp(origin) {
  origin = canonicalOrigin(origin);
  const resource = `${origin}/mcp`;
  const provider = new OAuthProvider({
    apiRoute: '/mcp',
    authorizeEndpoint: '/authorize',
    tokenEndpoint: '/oauth/token',
    clientRegistrationEndpoint: '/oauth/register',
    clientIdMetadataDocumentEnabled: true,
    accessTokenTTL: 3600,
    refreshTokenTTL: 30 * 24 * 3600,
    scopesSupported: allowedScopes,
    requiredScopes: [READ_SCOPE],
    resourceMetadata: { resource, authorization_servers: [origin] },
    // Avoid logging OAuth request details or credential-bearing errors.
    onError: () => {},
    apiHandler: {
      async fetch(request, env, ctx) {
        if (new URL(request.url).pathname !== '/mcp') return new Response('Not found', { status: 404 });
        if (!ctx.auth.scope.includes(READ_SCOPE)) return insufficientScope(ctx.auth, [READ_SCOPE]);
        const credentials = ctx.props?.credentials;
        if (!credentials?.apiKey || !credentials?.apiSecret) return new Response('Reconnect your Codeforces account', { status: 401 });
        const backend = coordinator(env);
        const api = {
          call: (method, params, ttl) => backend.call(method, params, ttl),
          authenticatedCall: (method, params) => backend.call(method, params, 0, credentials),
        };
        // Request-local closure: account credentials can never carry to another user.
        const mcp = createMcpHandler(() => createServer(api, { authenticated: true }), { maxRequestBodySize: 65536 });
        return mcp.fetch(request);
      },
    },
    defaultHandler: {
      async fetch(request, env) {
        const path = new URL(request.url).pathname;
        if (path === '/authorize') return authorize(request, env, origin);
        if (path === '/' && request.method === 'GET') return html(homePage(origin));
        if (path === '/health' && request.method === 'GET') return Response.json({ status: 'ok' });
        return new Response('Not found', { status: 404 });
      },
    },
  });
  return {
    async fetch(request, env, ctx) {
      const url = new URL(request.url);
      if (url.origin !== origin) return new Response('Invalid host', { status: 421 });
      // Browser MCP clients must be explicitly allowed; native clients send no Origin.
      const browserOrigin = request.headers.get('origin');
      const allowed = new Set([origin, ...(env.ALLOWED_ORIGINS ?? '').split(',').map(s => s.trim()).filter(Boolean)]);
      if (url.pathname === '/mcp' && browserOrigin && !allowed.has(browserOrigin)) return new Response('Origin not allowed', { status: 403 });
      if (url.pathname === '/mcp' && request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: {
          'Access-Control-Allow-Origin': browserOrigin ?? origin,
          'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
          'Access-Control-Allow-Headers': 'Authorization,Content-Type,Accept,MCP-Protocol-Version,MCP-Method,MCP-Name,MCP-Session-Id',
          'Vary': 'Origin',
        } });
      }
      if (['/authorize', '/oauth/register', '/oauth/token', '/oauth/token/revoke', '/mcp'].includes(url.pathname)) {
        const limit = url.pathname === '/oauth/register' ? 10 : url.pathname === '/authorize' && request.method === 'POST' ? 5 : 120;
        const key = digest(`${request.headers.get('cf-connecting-ip') ?? 'local'}:${url.pathname}:${request.method}`);
        if (!await coordinator(env).allowRequest(key, limit)) return new Response('Too many requests. Try again shortly.', { status: 429, headers: { 'Retry-After': '60' } });
      }
      try {
        const response = await provider.fetch(request, env, ctx);
        const headers = new Headers(response.headers);
        headers.set('Cache-Control', 'no-store');
        headers.set('X-Content-Type-Options', 'nosniff');
        if (url.protocol === 'https:') headers.set('Strict-Transport-Security', 'max-age=31536000');
        if (url.pathname === '/mcp' && browserOrigin) {
          headers.set('Access-Control-Allow-Origin', browserOrigin);
          headers.set('Access-Control-Expose-Headers', 'WWW-Authenticate,MCP-Session-Id,MCP-Protocol-Version');
          headers.set('Vary', 'Origin');
        }
        return new Response(response.body, { status: response.status, headers });
      } catch {
        return new Response('The connection service is temporarily unavailable. Please try again.', { status: 503 });
      }
    },
  };
}
