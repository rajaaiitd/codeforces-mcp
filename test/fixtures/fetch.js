import assert from 'node:assert/strict';

globalThis.fetch = async (url, options) => {
  assert.equal(url.href, 'https://codeforces.com/api/user.info?handles=tourist');
  assert.ok(options.signal instanceof AbortSignal);
  return Response.json({ status: 'OK', result: [{ handle: 'tourist', rating: 1500 }] });
};
