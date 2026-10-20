# Codeforces MCP

Connect your AI assistant to your Codeforces account, so you can plan and review your practice just by asking.

Works with **Claude Code**, **Codex**, **Claude.ai** and any app that supports MCP.

### Why I built this

Practicing on Codeforces means a lot of tab-switching: finding problems at the right rating, checking which ones you've already solved, looking up upcoming contests, reviewing your verdicts and rating history. I wanted to just *ask* instead:

- *"Give me five unsolved DP problems around 1400."*
- *"Which of my recent submissions failed, and on what?"*
- *"When's the next Div. 2, and how did my last three contests go?"*

This MCP server lets your AI assistant answer questions like these from live Codeforces data. It's built for **practice** — finding the right next problem and learning from your mistakes — not for solving problems for you, and never for rated contests.

```text
https://codeforces-mcp.rajaa-ai.co.in/mcp
```

**Contents:** [For users](#for-users) · [For developers](#for-developers)

---

## For users

### 1. Get a Codeforces API key

Open [codeforces.com/settings/api](https://codeforces.com/settings/api) → **Add API key**. Keep the **Key** and **Secret** handy.

### 2. Add the server to your app

| App | How |
| --- | --- |
| **Claude Code** | `claude mcp add --transport http codeforces https://codeforces-mcp.rajaa-ai.co.in/mcp`<br>then type `/mcp` → **codeforces** → **Authenticate** |
| **Codex CLI** | `codex mcp add codeforces --url https://codeforces-mcp.rajaa-ai.co.in/mcp`<br>if the browser doesn't open: `codex mcp login codeforces` |
| **Claude.ai / Desktop** | **Settings → Connectors → Add custom connector** → paste the address → **Connect** |
| **Cursor, VS Code, others** | Add a remote (HTTP) MCP server with the address above |

For apps that use an `mcpServers` JSON file:

```json
{ "mcpServers": { "codeforces": { "url": "https://codeforces-mcp.rajaa-ai.co.in/mcp" } } }
```

### 3. Log in

A browser page opens. Enter your **API key** and **secret** → **Connect account**. Done.

> 🔒 Only enter your key on that page — never paste it into a chat.

### 4. Ask away

- *"Show my Codeforces friends."*
- *"What contests are coming up this week?"*
- *"Find five graph problems rated 1200–1600."*
- *"How has tourist's rating changed this year?"*

### What it can do

| Tool | What it does |
| --- | --- |
| `codeforces_user_info` | Profiles, ratings and ranks |
| `codeforces_user_rating` | Rating history |
| `codeforces_user_submissions` | Recent submissions and verdicts |
| `codeforces_contests` | Upcoming and past contests or gyms |
| `codeforces_problems` | Search problems by tags, rating and name |
| `codeforces_contest_standings` | Contest standings |
| `codeforces_contest_submissions` | Submissions in a contest |
| `codeforces_contest_rating_changes` | Rating changes after a contest |
| `codeforces_my_friends` 🔑 | Your friends |
| `codeforces_my_contests` 🔑 | Contests you can access, including private gyms |
| `codeforces_gym_standings` 🔑 | Standings for your gyms and mashups |

🔑 = uses your logged-in account.

### Good to know

- **Read-only** — it can't submit solutions or change anything on your account.
- **Your key stays private** — encrypted on the server, never sent to the AI.
- **Shared speed limit** — about one Codeforces request every 2 seconds for everyone, so busy moments may say *"try again shortly"*.
- **Not for rated contests** — Codeforces rules ban AI help during rated rounds.

### Troubleshooting

| You see | Do this |
| --- | --- |
| *Could not verify your Codeforces credentials* | Check the key and secret aren't swapped or missing characters |
| *Start the connection again* | The page expired — reconnect from your app |
| *Too many requests* / *Codeforces is busy* | Wait a minute and retry |

**To disconnect:** remove the server from your app, then delete the key at [codeforces.com/settings/api](https://codeforces.com/settings/api).

---

## For developers

### How it works

```text
AI app ──MCP──▶ Cloudflare Worker ──signed API calls──▶ codeforces.com
                 │
                 ├─ OAuth login page (asks for your API key + secret)
                 ├─ KV: encrypted credentials and tokens
                 └─ Durable Object: one shared request queue (≈1 call / 2.1 s)
```

The AI app only ever receives an MCP access token. Your Codeforces key is encrypted at rest and used only by the server to sign requests.

### Run locally (stdio)

Needs Node.js 22.15+.

```bash
git clone https://github.com/rajaaiitd/codeforces-mcp.git
cd codeforces-mcp && npm ci
npm run smoke        # starts the server and lists its tools
```

Point your app at it (see [mcp-config.example.json](mcp-config.example.json)):

```json
{ "mcpServers": { "codeforces": { "command": "node", "args": ["/full/path/to/codeforces-mcp/src/index.js"] } } }
```

Optional: set `CODEFORCES_API_KEY` and `CODEFORCES_API_SECRET` in the app's settings to unlock the 🔑 tools.

### Deploy your own server

See [DEPLOY.md](DEPLOY.md) — Cloudflare Workers, with automatic deploys on every push. Your own copy gets its own speed limit.

### Commands

```bash
npm test         # unit, OAuth and MCP tests
npm run smoke    # stdio smoke check (add -- --live to call Codeforces)
npm run dev      # Cloudflare Worker locally on :8787
npm run deploy   # deploy to Cloudflare
```

### Project layout

```text
src/api.js            Codeforces request signing, throttling, caching
src/tools.js          Public tool schemas, filters, pagination
src/account-tools.js  Logged-in tools
src/server.js         MCP tool registration
src/index.js          Local stdio entry point
src/cloudflare/       Worker, OAuth login page, Durable Object
test/                 Tests
```

References: [Codeforces API](https://codeforces.com/apiHelp) · [MCP TypeScript SDK](https://ts.sdk.modelcontextprotocol.io/v2/)

## License

[MIT](LICENSE). Independent project, not affiliated with Codeforces.
