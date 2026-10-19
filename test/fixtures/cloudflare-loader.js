import { registerHooks } from 'node:module';

// Only the platform entrypoint class and compatibility flag are shimmed. Tests
// execute the real OAuth provider, cryptography, MCP SDK, and application code.
globalThis.Cloudflare = { compatibilityFlags: { global_fetch_strictly_public: true } };
const source = 'export class WorkerEntrypoint { constructor(ctx, env) { this.ctx=ctx; this.env=env; } }';
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'cloudflare:workers') return { url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true };
    return next(specifier, context);
  },
});
