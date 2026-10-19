export const escapeHtml = value => String(value).replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);

const styles = `:root{color-scheme:light;font-family:system-ui,sans-serif;color:#182237;background:#f2f5fa}body{margin:0;padding:48px 20px}main{max-width:540px;margin:0 auto;background:white;padding:32px;border-radius:16px;border:1px solid #dce3ed}h1{font-size:28px;letter-spacing:-.8px}p,li{line-height:1.6;color:#475569}.eyebrow{font-size:12px;font-weight:700;letter-spacing:2px;color:#2563eb}label{display:block;margin-top:20px;font-weight:600}input[type=password]{box-sizing:border-box;width:100%;padding:12px;margin-top:8px;border:1px solid #b9c5d6;border-radius:8px;font:inherit}button{padding:12px 18px;border-radius:8px;border:0;background:#2563eb;color:white;font:inherit;font-weight:600;cursor:pointer}button.secondary{background:#e8edf4;color:#334155}.actions{display:flex;gap:12px;margin-top:24px}a{color:#1d4ed8}code{overflow-wrap:anywhere}.note{font-size:13px}.error{background:#fff0ee;padding:12px;border-radius:8px;color:#a32922}`;
export const page = (title, body) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)} · Codeforces MCP</title><style>${styles}</style></head><body><main><p class="eyebrow">CODEFORCES MCP</p>${body}</main></body></html>`;

export function consentPage(details, handle, error = '') {
  return page('Connect your account', `
    <h1>Connect your Codeforces account</h1>
    <p><strong>${escapeHtml(details.clientName)}</strong> is requesting read access to your Codeforces data.</p>
    <p class="note">${details.clientDomain ? `Client domain: <strong>${escapeHtml(details.clientDomain)}</strong>.` : 'The client name is self-reported.'} Authorization returns to <strong>${escapeHtml(details.redirectHost)}</strong>.</p>
    ${details.redirectIsLoopback ? '<p class="note">This connects an app on your computer. Continue if you started this connection in that app.</p>' : ''}
    <ul><li>Read profiles, problems, contests and submissions.</li><li>Read your friends and contests you can access, including private gyms.</li>${details.scope.includes('offline_access') ? '<li>Keep the connection active for up to 30 days.</li>' : ''}</ul>
    ${error ? `<p class="error" role="alert">${escapeHtml(error)}</p>` : ''}
    <p>Create a key in <a href="https://codeforces.com/settings/api" target="_blank" rel="noopener noreferrer">Codeforces API settings</a>, then enter it below.</p>
    <form method="post" action="/authorize">
      <input type="hidden" name="handle" value="${escapeHtml(handle)}">
      <label for="apiKey">API key</label><input id="apiKey" type="password" name="apiKey" autocomplete="off" minlength="8" maxlength="256" required>
      <label for="apiSecret">API secret</label><input id="apiSecret" type="password" name="apiSecret" autocomplete="off" minlength="8" maxlength="256" required>
      <p class="note">Your credentials are encrypted for this connection and are never sent to the AI client. This service can use them to read your Codeforces account. No Codeforces password is needed.</p>
      <div class="actions"><button name="decision" value="approve">Connect account</button><button class="secondary" name="decision" value="deny" formnovalidate>Cancel</button></div>
    </form>
    <p class="note">An independent integration, not affiliated with Codeforces. To disconnect, remove this connection in your MCP client and revoke its API key in Codeforces settings.</p>`);
}

export function homePage(origin) {
  return page('Connect', `<h1>Your Codeforces account.<br>Your AI assistant.</h1><p>Explore problems, track contests, review submissions and access your friends and private gyms from an MCP-compatible assistant.</p><p>Add this remote MCP server URL in your assistant:</p><p><code>${escapeHtml(origin)}/mcp</code></p><p>Your assistant will open a browser to connect your Codeforces API key and secret. You do not need a separate account here.</p><p class="note">Supports Streamable HTTP and OAuth authorization. Codeforces credentials are entered only on the connection page, never in a chat message.</p><p class="note">Independent integration. Not affiliated with Codeforces.</p>`);
}

// Builds an HTML response with strict browser security headers.
// formTargets: extra places a form on this page may send the browser to, e.g. the
// MCP app's return address "http://localhost:51402" after the user clicks Connect.
// Chrome blocks a form's redirect to any address not listed here.
export function html(body, { status = 200, headers = new Headers(), formTargets = [] } = {}) {
  headers = new Headers(headers);
  headers.set('Content-Type', 'text/html; charset=utf-8');
  headers.set('Cache-Control', 'no-store');
  // 'same-origin' lets the browser tell our own server which page a form came from
  // (needed for the Origin check on /authorize), while telling outside sites nothing.
  // 'no-referrer' would make browsers send "Origin: null" and break every login.
  headers.set('Referrer-Policy', 'same-origin');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('X-Frame-Options', 'DENY');
  headers.set('Content-Security-Policy', `default-src 'none'; style-src 'unsafe-inline'; form-action ${['\'self\'', ...formTargets].join(' ')}; base-uri 'none'; frame-ancestors 'none'`);
  return new Response(body, { status, headers });
}
