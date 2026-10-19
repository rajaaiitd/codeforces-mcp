# Host on Cloudflare

This project exposes a remote MCP endpoint at `https://YOUR_WORKER_HOST/mcp`. Every remote client must authorize a Codeforces account. The user has no separate account or password on this service.

## What users do

1. Add your `/mcp` URL in an MCP client that supports Streamable HTTP and OAuth.
2. The client opens the authorization page in a browser.
3. The user creates a key at [Codeforces API settings](https://codeforces.com/settings/api), then enters its key and secret on that page.
4. The service verifies the credentials with the authenticated `user.friends` API method. The user grants read access to the requesting client.
5. The client receives an MCP access token and can use all 11 tools. It never receives the Codeforces secret.

Codeforces documents API key/secret signatures rather than a delegated OAuth login. The OAuth flow is provided by this MCP service; the Codeforces connection uses its documented SHA-512 signatures. The service does not accept Codeforces passwords.

## Deploy

Use Node.js 22.15 or newer. Commands below run from this project directory. Wrangler is pinned to version 4.133.0 in the npm scripts.

```bash
npm ci
npm test
npx wrangler@4.133.0 login
npx wrangler@4.133.0 whoami
npx wrangler@4.133.0 kv namespace create OAUTH_KV --env ""
```

Update these two values in `wrangler.jsonc`:

- `kv_namespaces[0].id`: the namespace ID printed by the create command.
- `vars.PUBLIC_ORIGIN`: your exact HTTPS Worker origin, such as `https://codeforces-mcp.YOUR_SUBDOMAIN.workers.dev`. Find your account's workers.dev subdomain in the Cloudflare Workers dashboard. The Worker name is `codeforces-mcp` unless you change it.

Use an origin without a trailing slash or path. No Codeforces credentials or application encryption key belong in this configuration. The OAuth provider encrypts account credentials using token-derived key material.

Then run:

```bash
npm run check:worker
npm run deploy
```

Wrangler creates the SQLite-backed Durable Object through the checked-in migration. The deploy script stops if placeholder values remain. Once deployed, share the HTTPS URL ending in `/mcp`; the home page also displays it. A custom domain can be configured in Cloudflare; if you switch origins, update `PUBLIC_ORIGIN` and reconnect clients because tokens are bound to the previous audience.

### Deploy automatically on every push

Connect the repo once in the Cloudflare dashboard: **Workers & Pages → codeforces-mcp → Settings → Build → Connect**, then set:

| Setting | Value |
| --- | --- |
| Branch | `main` |
| Build command | `npm ci && npm test` |
| Deploy command | `npm run deploy` |

Every push to `main` then runs the tests and deploys. If a test fails, nothing is deployed and the live service keeps running the previous version.

The Worker uses one KV namespace (`OAUTH_KV`) and one named Durable Object (`API_COORDINATOR`, instance `global`). Preserve the namespace and Durable Object storage across deployments. Don't put production credentials in local test fixtures or enable logging of request bodies, authorization headers, or Codeforces signed URLs.

## Verify the deployment

```bash
curl -i https://YOUR_WORKER_HOST/health
curl -i https://YOUR_WORKER_HOST/mcp
curl https://YOUR_WORKER_HOST/.well-known/oauth-authorization-server
curl https://YOUR_WORKER_HOST/.well-known/oauth-protected-resource/mcp
```

`/health` should return `200`. An unauthenticated `/mcp` request should return `401` with a `WWW-Authenticate` header pointing to resource metadata. Discovery should name your exact deployed origin.

Connect an OAuth-capable MCP client or use the [MCP Inspector](https://modelcontextprotocol.io/docs/tools/inspector). Complete the browser authorization with a dedicated Codeforces API key, discover the 11 tools, and call `codeforces_my_friends`. Test with two different accounts before inviting users. The test suite already exercises this flow against the real OAuth library with simulated Codeforces responses; deployed network behavior still needs this live check.

Browser-based MCP clients send an `Origin` header. Add their exact origins as a comma-separated `ALLOWED_ORIGINS` value in `wrangler.jsonc` and redeploy. Native clients without an Origin header work without this setting. No wildcard origins are accepted by the MCP endpoint.

## Run locally

```bash
npm ci
npm run dev
```

Open `http://localhost:8787/` and point your MCP client at `http://localhost:8787/mcp`. The `development` environment uses local KV and Durable Object emulation, with its own resource origin. It makes real outbound Codeforces calls for credential verification and tools. Use `localhost` consistently: requests with another hostname are rejected. No production Cloudflare login is needed for local emulation.

## Authentication and storage

The service uses Cloudflare's `@cloudflare/workers-oauth-provider` for OAuth discovery, client registration, PKCE, browser-bound consent, credential encryption, access tokens, refresh and revocation. Both Client ID Metadata Documents and Dynamic Client Registration are enabled for client compatibility. The `global_fetch_strictly_public` flag protects client metadata fetches.

The only resource audience is your exact `/mcp` URL. The required scope is `codeforces:read`; `offline_access` is supported when requested. Access tokens last one hour; refresh authorization has a fixed maximum lifetime of 30 days. The provider hashes tokens and encrypts the `props` containing Codeforces credentials in KV. Codeforces keys are not stored in grant metadata or tool schemas. No authenticated response cache is shared between users.

Codeforces does not document an API endpoint that returns the key owner's identity. A connection is identified internally by a hash of its API key. A user-supplied handle is never treated as proof of ownership. Authentication is verified using an API method that requires a valid signature.

The consent page shows the client name, callback hostname and requested access. Browser-bound consent, Origin checking, HTML escaping, CSP and disabled framing protect the form. Invalid credentials are not reflected into the page or returned to the MCP client.

## Disconnecting

Users can remove the MCP connection in their client and revoke the dedicated key in Codeforces API settings. MCP clients can revoke tokens using the provider's advertised `revocation_endpoint` (the same `/oauth/token` endpoint, with a `token` form field and client authentication). Revoking a refresh token revokes its grant. Removing a connection in a client may not itself send a revocation request; revoking the Codeforces key prevents further private API access regardless.

OAuth records expire through KV TTLs. KV is eventually consistent, so token revocation propagation across Cloudflare locations follows KV consistency behavior. Credentials already read by an in-flight call cannot be recalled. Public Codeforces tools can still operate with a valid MCP token after the underlying Codeforces API key is revoked; private tools will fail. Revoke the MCP grant to disable both.

## Capacity and operations

Codeforces permits one request per two seconds. A shared Durable Object serializes upstream requests at least 2.1 seconds apart, persists its next allowed request time, bounds queued operations to eight, and shares a public cache. Private responses are not cached. When busy, callers receive a retryable tool error. Separate deployments or other services sharing an upstream IP can still hit Codeforces limits.

The service also limits requests by hashed client IP and route; credential verification allows five attempts per minute, registration ten per minute, and other protected routes 120 per minute. These in-memory abuse limits reset when the Durable Object restarts. The upstream throttle timestamp persists. One shared coordinator deliberately trades throughput for compliance with Codeforces' API limit; this is a small-service design, not unbounded horizontal throughput.

Worker observability is disabled by default to avoid accidental request/credential logging. `/health` reports that routing is available; it does not call Codeforces. Production monitoring can record counts, latency and generic error codes without storing bodies or tokens.

## Testing

- `npm test` runs the automated tests, including the real OAuth provider and MCP SDK with a platform shim and fake KV/Codeforces responses.
- `npm run check:worker` performs a Wrangler deployment dry run that bundles the Worker and resolves its bindings.
- Automated tests do not contact Codeforces. After deploying, complete a live account authorization as described in [Verify the deployment](#verify-the-deployment).

References: [Codeforces authentication](https://codeforces.com/apiHelp), [Cloudflare MCP authorization](https://developers.cloudflare.com/agents/model-context-protocol/protocol/authorization/), [OAuth provider library](https://github.com/cloudflare/workers-oauth-provider), and [MCP authorization](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization).
