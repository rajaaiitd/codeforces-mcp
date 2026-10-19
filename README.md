# Codeforces MCP

A Model Context Protocol server with **11 tools**, Codeforces account authorization, and a Cloudflare Workers deployment. Users connect their own Codeforces account through a browser; they do not create a separate service account.

## Share it with others

Follow [DEPLOY.md](DEPLOY.md) to deploy the remote service to Cloudflare. Share the resulting `https://YOUR_WORKER_HOST/mcp` URL. OAuth-compatible MCP clients open the browser connection page automatically.

The browser asks for a Codeforces API key and secret, verifies them, and issues an MCP access token. Credentials are encrypted in Cloudflare KV, and each user's authenticated calls remain isolated. Codeforces documents API-key signatures rather than a delegated OAuth sign-in; the MCP service supplies the OAuth authorization layer.

Anyone can deploy their own copy. Each deployment has its own Codeforces rate limit, so a personal deployment avoids sharing it with other users.

## Use locally over stdio

Requires Node.js 22.15 or newer and outbound HTTPS access to `codeforces.com`.

```bash
git clone https://github.com/rAjaa1729/codeforces-mcp.git
cd codeforces-mcp
npm ci
npm run smoke
```

`npm ci` installs the dependencies. Stdio mode requires no build step.

Configure your MCP client to launch this process:

- Name: `codeforces`
- Transport: `stdio`
- Command: `node`
- Argument: `/absolute/path/to/codeforces-mcp/src/index.js` (run `pwd` inside the project folder to get the first part)
- Environment variables: optional `CODEFORCES_API_KEY` and `CODEFORCES_API_SECRET` (both must be supplied together)

For clients that use the `mcpServers` JSON format, merge the entry from [mcp-config.example.json](mcp-config.example.json) into your client configuration. Replace the example path with this project's absolute path. If a desktop client cannot find Node, use the full path printed by `command -v node` as the command.

Your MCP client launches and manages the process. To start it manually, use `node src/index.js`; it waits silently for MCP messages on stdin. Configure the client to run Node directly so stdout contains only protocol messages.

Without credentials, local mode exposes the eight public tools. With both environment variables, it exposes all 11. Set these in your MCP client's protected environment configuration; do not put secrets in chat messages or commit them. Remote mode always requires browser authorization.

## Tools

| Tool | Purpose |
| --- | --- |
| `codeforces_user_info` | Profiles, ratings, ranks and organizations for a list of handles |
| `codeforces_user_rating` | Contest rating history, newest first |
| `codeforces_user_submissions` | Submission verdicts and problem metadata for a handle |
| `codeforces_contests` | Contests or gyms, with phase and name filters |
| `codeforces_problems` | Search by name, contest, tags and rating; includes solve counts and statement links |
| `codeforces_contest_standings` | Official public standings, with handle filtering |
| `codeforces_contest_submissions` | Contest submissions, optionally for a handle |
| `codeforces_contest_rating_changes` | Published contest rating changes, optionally for a handle |
| `codeforces_my_friends` | The connected account's friends; requires account authorization |
| `codeforces_my_contests` | Contests available to the connected account, including private gyms and mashups |
| `codeforces_gym_standings` | Authenticated standings for accessible gyms and mashups |

Example requests in your connected assistant:

- “Show tourist’s profile and latest rating changes.”
- “What Codeforces contests are coming up?”
- “Find five graph problems rated 1200–1600, ordered by solve count.”
- “Show my last 20 submissions for handle `YOUR_HANDLE`.”
- “Get the standings for contest 566.”
- “Show my Codeforces friends.”
- “List the private gyms my connected account can access.”

Tool argument examples:

```json
{"handles": ["tourist", "Petr"]}
```

```json
{"tags": ["graphs"], "minRating": 1200, "maxRating": 1600, "sort": "most_solved", "limit": 5}
```

```json
{"phase": "BEFORE", "limit": 10}
```

List tools use a zero-based `offset` and `limit` (default 20, maximum 100). Responses include the total matching items and `nextOffset`. Submission tools use the Codeforces API’s one-based `from` and `count` (default 20, maximum 100). All requested problem tags must match; rating filters exclude unrated problems.

## Behavior and limits

- Read-only public and authorized account data. No code submission or source-code retrieval.
- Problem results contain metadata and statement links. Full statement text and editorials are not exposed by these tools.
- API requests are serialized at least 2.1 seconds apart. The hosted service shares this throttle across users through a Durable Object. The local process has its own throttle. The request queue is bounded; busy callers receive an error asking them to retry.
- HTTP 429, server errors, and Codeforces call-limit errors retry up to twice with backoff. Each HTTP request has a 20-second timeout.
- Public responses are cached for 30 seconds; submissions for 10 seconds; problemsets and contest rating changes for five minutes. The public cache holds at most 32 entries. Authenticated responses are not cached in the hosted service.
- Regular contest standings are fetched anonymously with only `contestId`; filtering and pagination happen locally. Use `codeforces_gym_standings` for authenticated gym/mashup standings. First fetches of large standings and the problemset can take longer.
- The MCP SDK supports older MCP clients through its stdio and HTTP compatibility layers.

## Verify

```bash
npm test
npm run smoke
npm run smoke -- --live
npm run check:worker
```

The tests cover signed requests, throttling, retries, caching, filtering, pagination, input validation, stdio execution, OAuth discovery, browser consent, token exchange, encrypted credential storage, account isolation, refresh, revocation, PKCE, CSRF and redirect rejection. OAuth tests execute the real provider library and MCP SDK with fake KV/Codeforces responses and a small platform shim. The ordinary smoke check starts the local server and lists its tools without accessing Codeforces. `--live` additionally performs API calls and requires network access from Node.js.

After deploying, follow the live checks in [DEPLOY.md](DEPLOY.md#verify-the-deployment).

## Project layout

```text
src/api.js          Codeforces request signing, throttling and public caching
src/tools.js        Tool schemas, filters and pagination
src/account-tools.js Authenticated account tools
src/server.js       MCP tool registration and result formatting
src/index.js        Stdio entry point
src/cloudflare/     OAuth connection flow, consent page and Durable Object
wrangler.jsonc      Cloudflare deployment configuration
scripts/smoke.js    MCP connection check, optional live lookup
test/              API, tools, OAuth and MCP integration tests
```

Implementation references: [Codeforces API introduction](https://codeforces.com/apiHelp), [API methods](https://codeforces.com/apiHelp/methods), and the [official MCP SDK](https://ts.sdk.modelcontextprotocol.io/v2/).

## License

[MIT](LICENSE). This is an independent project and is not affiliated with Codeforces.
