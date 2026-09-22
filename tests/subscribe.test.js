import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequest } from '../functions/api/subscribe.js';
import { onRequest as redirect } from '../functions/_middleware.js';

function fixture() {
  const records = new Map();
  const env = { SUBSCRIBERS: { get: async key => records.get(key), put: async (key, value) => records.set(key, value) } };
  return { records, env };
}
function request(body, options = {}) {
  return new Request('https://jevtool.dev/api/subscribe', {
    method: 'POST', body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json', Origin: 'https://jevtool.dev', ...options.headers },
  });
}

test('valid signup persists one normalized subscriber and repeated signup does not duplicate it', async () => {
  const { env, records } = fixture();
  for (let i = 0; i < 2; i++) {
    const response = await onRequest({ env, request: request({ email: ' Preview@Example.com ' }) });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true });
  }
  assert.equal(records.size, 1);
  const [key, value] = [...records][0];
  assert.match(key, /^subscriber:[a-f0-9]{64}$/);
  assert.equal(JSON.parse(value).email, 'preview@example.com');
});
test('invalid email, malformed JSON and oversized payload never write', async () => {
  const { env, records } = fixture();
  for (const email of ['', 'foo', 'a@b', 'a\n@b.com', 42, 'x'.repeat(255) + '@test.com']) {
    assert.equal((await onRequest({ env, request: request({ email }) })).status, 400);
  }
  const malformed = new Request('https://jevtool.dev/api/subscribe', { method: 'POST', body: '{', headers: { 'Content-Type': 'application/json' } });
  assert.equal((await onRequest({ env, request: malformed })).status, 400);
  assert.equal((await onRequest({ env, request: request({ email: 'a@example.com', extra: 'x'.repeat(3000) }) })).status, 413);
  assert.equal(records.size, 0);
});
test('cross-site form and JSON requests are rejected', async () => {
  const { env, records } = fixture();
  assert.equal((await onRequest({ env, request: request({ email: 'a@example.com' }, { headers: { Origin: 'https://other.example' } }) })).status, 403);
  assert.equal((await onRequest({ env, request: request({ email: 'a@example.com' }, { headers: { 'Sec-Fetch-Site': 'cross-site' } }) })).status, 403);
  assert.equal(records.size, 0);
});
test('honeypot submissions are ignored', async () => {
  const { env, records } = fixture();
  assert.equal((await onRequest({ env, request: request({ email: 'a@example.com', website: 'bot.example' }) })).status, 200);
  assert.equal(records.size, 0);
});
test('storage configuration and write failures do not claim success', async () => {
  assert.equal((await onRequest({ env: {}, request: request({ email: 'a@example.com' }) })).status, 503);
  const env = { SUBSCRIBERS: { get: async () => null, put: async () => { throw new Error('unavailable'); } } };
  assert.equal((await onRequest({ env, request: request({ email: 'a@example.com' }) })).status, 503);
});
test('unsupported methods and media types return actionable HTTP errors', async () => {
  const { env } = fixture();
  const response = await onRequest({ env, request: new Request('https://jevtool.dev/api/subscribe') });
  assert.equal(response.status, 405);
  assert.equal(response.headers.get('Allow'), 'POST');
  assert.equal((await onRequest({ env, request: request({}, { headers: { 'Content-Type': 'text/plain' } }) })).status, 415);
});
test('plain HTML form works without JavaScript', async () => {
  const { env, records } = fixture();
  const req = new Request('https://jevtool.dev/api/subscribe', { method: 'POST', body: new URLSearchParams({ email: 'plain@example.com' }), headers: { Accept: 'text/html', Origin: 'https://jevtool.dev' } });
  const response = await onRequest({ env, request: req });
  assert.equal(response.status, 200);
  assert.match(await response.text(), /You're on the list/);
  assert.equal(records.size, 1);
});
test('www redirects permanently and retains the path and query', async () => {
  const response = await redirect({ request: new Request('https://www.jevtool.dev/?ref=launch'), next: () => assert.fail('should redirect') });
  assert.equal(response.status, 301);
  assert.equal(response.headers.get('Location'), 'https://jevtool.dev/?ref=launch');
  const normal = await redirect({ request: new Request('https://jevtool.dev/'), next: () => new Response('ok') });
  assert.equal(await normal.text(), 'ok');
});
