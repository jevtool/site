import test from 'node:test';
import assert from 'node:assert/strict';
import { handleDecision, providerFor } from '../lib/decisions.js';
import { onRequest as models } from '../functions/v1/models.js';

const questions = { urgent: { type: 'noul', instructions: 'Is `ticket` urgent?' }, team: { type: 'choice', instructions: 'Which team?', criteria: { billing: 'Money', support: 'Help' } } };
const answers = { urgent: { type: 'noul', noul: 0.91 }, team: { type: 'choice', choice: 'billing', confidence: 0.9, probabilities: { billing: 0.95, support: 0.05 } } };

function req(body, headers = {}, method = 'POST') {
  return new Request('https://jevtool.dev/v1/decisions', { method, body: method === 'POST' ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer user-own-key-123', ...headers } });
}

// Stand-in for both providers. `script` maps model → HTTP status (default 200).
function fakeProviders(t, script = {}) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    const body = JSON.parse(options.body);
    calls.push({ url, auth: options.headers.Authorization, body });
    const status = script[body.model] ?? 200;
    if (status !== 200) return new Response('upstream secret detail', { status });
    return Response.json({ model: `${body.model}-resolved`, answers, usage: { input_tokens: 120, cost: 0.000005 } });
  };
  t.after(() => { globalThis.fetch = original; });
  return calls;
}

test('model IDs pick the provider: slash → OpenRouter, none → TypeSafe, header overrides', () => {
  assert.equal(providerFor('jev-latest'), 'typesafe');
  assert.equal(providerFor('inception/mercury-decide'), 'openrouter');
  assert.equal(providerFor('jev-latest', 'openrouter'), 'openrouter');
});

test('TypeSafe model goes to TypeSafe with the caller key; response adds provider and request id', async t => {
  const calls = fakeProviders(t);
  const res = await handleDecision(req({ model: 'jev-latest', state: { ticket: 'down' }, questions }));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), '*');
  assert.equal(res.headers.get('X-Jevtool-Provider'), 'typesafe');
  const body = await res.json();
  assert.equal(body.provider, 'typesafe');
  assert.equal(body.model, 'jev-latest-resolved');
  assert.deepEqual(body.answers, answers);
  assert.match(body.id, /^[0-9a-f-]{36}$/);
  assert.deepEqual(calls.map(c => [c.url, c.auth]), [['https://api.typesafe.ai/v1/systemone', 'Bearer user-own-key-123']]);
  assert.deepEqual(calls[0].body, { model: 'jev-latest', state: { ticket: 'down' }, questions });
});

test('OpenRouter model goes to the Decisions API and passes through billed usage', async t => {
  const calls = fakeProviders(t);
  const body = await (await handleDecision(req({ model: 'inception/mercury-decide', state: 'x', questions }))).json();
  assert.equal(calls[0].url, 'https://openrouter.ai/api/alpha/decisions');
  assert.equal(body.provider, 'openrouter');
  assert.equal(body.usage.cost, 0.000005);
});

test('fallbacks are tried in order and reported; a rejected key stops the chain', async t => {
  let calls = fakeProviders(t, { 'cloudflare/clef-flash': 503 });
  let body = await (await handleDecision(req({ model: 'cloudflare/clef-flash', models: ['inception/mercury-decide'], state: 'x', questions }))).json();
  assert.deepEqual(body.fallback, { requested: 'cloudflare/clef-flash', used: 'inception/mercury-decide', skipped: ['cloudflare/clef-flash'] });
  assert.deepEqual(calls.map(c => c.body.model), ['cloudflare/clef-flash', 'inception/mercury-decide']);

  calls = fakeProviders(t, { 'cloudflare/clef-flash': 401 });
  const res = await handleDecision(req({ model: 'cloudflare/clef-flash', models: ['inception/mercury-decide'], state: 'x', questions }));
  assert.equal(res.status, 401);
  assert.equal((await res.json()).error.code, 'provider_key_rejected');
  assert.equal(calls.length, 1);
});

test('provider failures map to honest statuses without echoing upstream bodies', async t => {
  for (const [status, expected, code] of [[402, 402, 'provider_payment_required'], [429, 429, 'provider_rate_limited'], [404, 404, 'model_not_found'], [500, 424, 'provider_failed']]) {
    fakeProviders(t, { 'jev-latest': status });
    const res = await handleDecision(req({ model: 'jev-latest', state: 'x', questions }));
    const body = await res.json();
    assert.equal(res.status, expected);
    assert.equal(body.error.code, code);
    assert.ok(!JSON.stringify(body).includes('upstream secret detail'));
  }
});

test('bad input is rejected before any upstream call, each with a fix-it message', async t => {
  const calls = fakeProviders(t);
  const ok = { model: 'jev-latest', state: 'x', questions };
  const cases = [
    [req(ok, { Authorization: '' }), 401, 'missing_api_key'],
    [req(ok, { 'Content-Type': 'text/plain' }), 415, 'invalid_content_type'],
    [req('{'), 400, 'invalid_json'],
    [req({ ...ok, model: '' }), 400, 'invalid_model'],
    [req({ ...ok, model: 'jev-latest', models: ['a', 'b', 'c', 'd', 'e'] }), 400, 'invalid_model'],
    [req({ ...ok, models: ['inception/mercury-decide'] }), 400, 'mixed_providers'],
    [req({ ...ok, state: null }), 400, 'missing_state'],
    [req({ ...ok, questions: { q: { type: 'box', instructions: 'find' } } }), 400, 'invalid_questions'],
    [req(ok, { 'X-Provider': 'acme' }), 400, 'invalid_provider'],
    [req({ ...ok, pad: 'x'.repeat(100 * 1024) }), 413, 'request_too_large'],
    [req(undefined, {}, 'GET'), 405, 'method_not_allowed'],
  ];
  for (const [request, status, code] of cases) {
    const res = await handleDecision(request);
    assert.equal(res.status, status, code);
    assert.equal((await res.json()).error.code, code);
  }
  assert.equal(calls.length, 0);
});

test('CORS preflight is answered without auth', async () => {
  const res = await handleDecision(new Request('https://jevtool.dev/v1/decisions', { method: 'OPTIONS' }));
  assert.equal(res.status, 204);
  assert.match(res.headers.get('Access-Control-Allow-Headers'), /Authorization/);
});

test('models lists TypeSafe IDs plus the OpenRouter decision catalog without aliases', async t => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ data: [{ id: '~typesafe/jev-latest', pricing: { prompt: '0.000000042' } }, { id: 'inception/mercury-decide', name: 'Mercury Decide', pricing: { prompt: '0.00000002' }, context_length: 65536 }] });
  t.after(() => { globalThis.fetch = original; });
  const body = await (await models({ request: new Request('https://jevtool.dev/v1/models') })).json();
  const ids = body.data.map(m => m.id);
  assert.ok(ids.includes('jev-latest') && ids.includes('inception/mercury-decide') && !ids.includes('~typesafe/jev-latest'));
  assert.equal(body.data.find(m => m.id === 'inception/mercury-decide').input_usd_per_million, 0.02);
});

test('compressed bodies from the TypeSafe SDKs are decoded: zstd and gzip; bombs and junk are refused', async t => {
  const { execFileSync } = await import('node:child_process');
  const { gzipSync } = await import('node:zlib');
  const calls = fakeProviders(t);
  const json = JSON.stringify({ model: 'jev-latest', state: { ticket: 'down '.repeat(400) }, questions });
  const send = (body, encoding) => handleDecision(new Request('https://jevtool.dev/v1/systemone', { method: 'POST', body,
    headers: { 'Content-Type': 'application/json', 'Content-Encoding': encoding, Authorization: 'Bearer user-own-key-123' } }));
  let zstd;
  try { zstd = execFileSync('zstd', ['-q', '-c'], { input: json }); } catch { zstd = null; }
  if (zstd) {
    const res = await send(zstd, 'zstd');
    assert.equal(res.status, 200);
    assert.equal(calls.at(-1).body.state.ticket, 'down '.repeat(400));
    const bomb = execFileSync('zstd', ['-q', '-c', '-19'], { input: 'a'.repeat(400 * 1024) });
    assert.equal((await send(bomb, 'zstd')).status, 413);
  }
  assert.equal((await send(gzipSync(json), 'gzip')).status, 200);
  assert.equal((await send(new Uint8Array([1, 2, 3, 4]), 'zstd')).status, 400);
  assert.equal((await send(json, 'br')).status, 415);
});
