import { McpServer } from '@modelcontextprotocol/server';
import { CodeforcesClient } from './api.js';
import { createTools } from './tools.js';
import { createAccountTools } from './account-tools.js';

export function createServer(api = new CodeforcesClient(), { authenticated = false } = {}) {
  const server = new McpServer({ name: 'codeforces', version: '1.0.0' });
  for (const tool of [...createTools(api), ...(authenticated ? createAccountTools(api) : [])]) {
    server.registerTool(tool.name, {
      description: tool.description,
      inputSchema: tool.schema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    }, async args => {
      try {
        const result = await tool.run(args);
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
      } catch (error) {
        return { isError: true, content: [{ type: 'text', text: error instanceof Error ? error.message : 'Codeforces request failed.' }] };
      }
    });
  }
  return server;
}
