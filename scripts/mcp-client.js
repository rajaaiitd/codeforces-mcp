import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

// Small legacy-protocol probe: exercises the real stdio wire used by MCP hosts.
export async function connect(entry, { timeoutMs = 5000, nodeArgs = [] } = {}) {
  const child = spawn(process.execPath, [...nodeArgs, entry], { stdio: ['pipe', 'pipe', 'pipe'] });
  let nextId = 0;
  let stderr = '';
  const pending = new Map();
  const lines = createInterface({ input: child.stdout });
  const rejectPending = error => {
    for (const { reject, timer } of pending.values()) { clearTimeout(timer); reject(error); }
    pending.clear();
  };
  child.stderr.on('data', data => { stderr += data; });
  child.on('error', rejectPending);
  child.on('exit', () => rejectPending(new Error(`MCP process exited. ${stderr}`)));
  lines.on('line', line => {
    let message;
    try { message = JSON.parse(line); } catch { rejectPending(new Error(`Non-JSON stdout: ${line}`)); return; }
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    clearTimeout(request.timer);
    if (message.error) request.reject(new Error(message.error.message));
    else request.resolve(message.result);
  });
  const send = message => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n');
  const request = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timed out: ${method}. ${stderr}`)); }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
    send({ id, method, params });
  });
  const close = () => { lines.close(); child.stdin.end(); child.kill(); };
  try {
    const initialization = await request('initialize', {
      protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'codeforces-smoke', version: '1.0.0' },
    });
    send({ method: 'notifications/initialized' });
    return { request, close, initialization };
  } catch (error) { close(); throw error; }
}
