import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { connect } from '../scripts/mcp-client.js';

test('production entry point calls through the HTTP client and returns a profile', async () => {
  const client = await connect(fileURLToPath(new URL('../src/index.js', import.meta.url)), {
    nodeArgs: ['--import', fileURLToPath(new URL('fixtures/fetch.js', import.meta.url))],
  });
  try {
    const result = await client.request('tools/call', { name: 'codeforces_user_info', arguments: { handles: ['tourist'] } });
    assert.ok(!result.isError, JSON.stringify(result));
    assert.equal(result.structuredContent.users[0].handle, 'tourist');
  } finally { client.close(); }
});

test('real stdio handshake, discovery, tool results, errors and validation', async () => {
  const client = await connect(fileURLToPath(new URL('fixtures/server.js', import.meta.url)));
  try {
    assert.equal(client.initialization.serverInfo.name, 'codeforces');
    const { tools } = await client.request('tools/list');
    assert.equal(tools.length, 8);
    assert.ok(tools.every(t => t.inputSchema.type === 'object' && t.annotations.readOnlyHint));
    const call = args => client.request('tools/call', { name: 'codeforces_user_info', arguments: args });
    const result = await call({ handles: ['tourist'] });
    assert.equal(JSON.parse(result.content[0].text).users[0].rating, 1500);
    assert.equal(result.structuredContent.users[0].handle, 'tourist');
    const failure = await call({ handles: ['missing'] });
    assert.equal(failure.isError, true);
    assert.match(failure.content[0].text, /User not found/);
    const invalid = await call({ handles: [] });
    assert.equal(invalid.isError, true);
  } finally { client.close(); }
});
