import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequest } from '../functions/api/judge.js';

const questions = { team: { type: 'choice', instructions: 'Which team?', criteria: { billing: 'Money', support: 'Help' } }, urgent: { type: 'noul', instructions: 'Urgent?' } };
const answers = { team: { type: 'choice', choice: 'billing', confidence: 0.9, probabilities: { billing: 0.95, support: 0.05 } }, urgent: { type: 'noul', noul: 0.9 } };

function request(body, headers = {}) {
  return new Request('https://jevtool.dev/api/judge', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { 'Content-Type': 'application/json', Origin: 'https://jevtool.dev', 'X-TypeSafe-Key': 'ts-fixture', ...headers } });
}

function fakeTypeSafe(t, { status = 200 } = {}) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    calls.push({ url, auth: options.headers.Authorization, body: JSON.parse(options.body) });
    if (status !== 200) return new Response('secret upstream detail', { status });
    return Response.json({ model: 'jev-1.13.0', usage: { input_tokens: 120, output_tokens: 10 }, answers });
  };
  t.after(() => { globalThis.fetch = original; });
  return calls;
}

test('forwards one case with the visitor key and returns the answers', async t => {
  const calls = fakeTypeSafe(t);
  const response = await onRequest({ request: request({ model: 'jev-1.13.0', state: { text: 'refund now' }, questions }) });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  const body = await response.json();
  assert.deepEqual(body, { model: 'jev-1.13.0', answers, usage: { input_tokens: 120, output_tokens: 10 } });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.typesafe.ai/v1/systemone');
  assert.equal(calls[0].auth, 'Bearer ts-fixture');
  assert.deepEqual(calls[0].body, { model: 'jev-1.13.0', state: { text: 'refund now' }, questions });
});

test('bad key, model, state, questions, JSON and size are rejected before any upstream call', async t => {
  const calls = fakeTypeSafe(t);
  const ok = { model: 'jev-1.13.0', state: 'x', questions };
  assert.equal((await onRequest({ request: request(ok, { 'X-TypeSafe-Key': '' }) })).status, 400);
  assert.equal((await onRequest({ request: request(ok, { 'X-TypeSafe-Key': 'has space' }) })).status, 400);
  assert.equal((await onRequest({ request: request({ ...ok, model: 'gpt-5' }) })).status, 400);
  assert.equal((await onRequest({ request: request({ ...ok, state: undefined }) })).status, 400);
  assert.equal((await onRequest({ request: request({ ...ok, questions: {} }) })).status, 400);
  assert.equal((await onRequest({ request: request({ ...ok, questions: { q: { type: 'box', instructions: 'x' } } }) })).status, 400);
  assert.equal((await onRequest({ request: request('{') })).status, 400);
  assert.equal((await onRequest({ request: request({ ...ok, state: 'x'.repeat(100 * 1024) }) })).status, 413);
  assert.equal(calls.length, 0);
});

test('cross-site, wrong method and wrong media type are refused', async t => {
  const calls = fakeTypeSafe(t);
  const ok = { model: 'jev-1.13.0', state: 'x', questions };
  assert.equal((await onRequest({ request: request(ok, { Origin: 'https://other.example' }) })).status, 403);
  assert.equal((await onRequest({ request: new Request('https://jevtool.dev/api/judge') })).status, 405);
  assert.equal((await onRequest({ request: request(ok, { 'Content-Type': 'text/plain' }) })).status, 415);
  assert.equal(calls.length, 0);
});

test('an upstream failure is reported as 502 without echoing the upstream body', async t => {
  fakeTypeSafe(t, { status: 401 });
  const response = await onRequest({ request: request({ model: 'jev-1.13.0', state: 'x', questions }) });
  assert.equal(response.status, 502);
  const body = await response.json();
  assert.match(body.error, /HTTP 401/);
  assert.ok(!JSON.stringify(body).includes('secret upstream detail'));
});
