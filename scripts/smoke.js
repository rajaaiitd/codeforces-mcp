import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { connect } from './mcp-client.js';

const client = await connect(fileURLToPath(new URL('../src/index.js', import.meta.url)), { timeoutMs: 60000 });
try {
  const { tools } = await client.request('tools/list');
  const authenticated = Boolean(process.env.CODEFORCES_API_KEY && process.env.CODEFORCES_API_SECRET);
  assert.equal(tools.length, authenticated ? 11 : 8);
  assert.ok(tools.every(t => t.annotations.readOnlyHint));
  console.log(`MCP connection OK: ${tools.length} tools available.`);
  if (process.argv.includes('--live')) {
    const result = await client.request('tools/call', { name: 'codeforces_user_info', arguments: { handles: ['tourist'] } });
    assert.ok(!result.isError, JSON.stringify(result));
    const data = JSON.parse(result.content[0].text);
    assert.equal(data.users[0].handle.toLowerCase(), 'tourist');
    console.log('Live Codeforces profile lookup OK.');
    if (authenticated) {
      const friends = await client.request('tools/call', { name: 'codeforces_my_friends', arguments: {} });
      assert.ok(!friends.isError, JSON.stringify(friends));
      console.log('Authenticated Codeforces account lookup OK.');
    }
  }
} finally { client.close(); }
