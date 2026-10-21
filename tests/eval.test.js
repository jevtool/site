import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequest } from '../functions/api/eval.js';

const suite = {
  name: 'fixture', target: 0.9,
  questions: { team: { type: 'choice', instructions: 'Which team?', criteria: { billing: 'Money', support: 'Help' } }, urgent: { type: 'noul', instructions: 'Urgent?' } },
  cases: [
    { id: 'a', state: { text: 'refund now' }, expect: { team: 'billing', urgent: true }, tags: ['en'] },
    { id: 'b', state: { text: 'how do I' }, expect: { team: 'support', urgent: false }, tags: ['en'] },
  ],
};

function request(body, headers = {}) {
  return new Request('https://jevtool.dev/api/eval', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { 'Content-Type': 'application/json', Origin: 'https://jevtool.dev', 'X-TypeSafe-Key': 'ts-fixture', ...headers } });
}

// Stand-in for api.typesafe.ai: records every call, answers from the state, never sees labels.
function fakeTypeSafe(t, { status = 200 } = {}) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    const body = JSON.parse(options.body);
    calls.push({ url, auth: options.headers.Authorization, model: body.model, body });
    if (status !== 200) return new Response('secret upstream detail', { status });
    const billing = /refund/.test(body.state.text);
    return Response.json({ model: body.model, usage: { input_tokens: 120 }, answers: {
      team: { type: 'choice', choice: billing ? 'billing' : 'support', confidence: 0.9, probabilities: { billing: billing ? 0.95 : 0.05, support: billing ? 0.05 : 0.95 } },
      urgent: { type: 'noul', noul: billing ? 0.9 : 0.1 } } });
  };
  t.after(() => { globalThis.fetch = original; });
  return calls;
}

test('runs a suite with the visitor key, forwards only state and questions, returns the CLI report shape', async t => {
  const calls = fakeTypeSafe(t);
  const response = await onRequest({ request: request({ suite, model: 'jev-1.13.0', compare: 'jev-1.14.0' }) });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  const report = await response.json();
  assert.equal(report.status, 'passed');
  assert.equal(report.runner, 'jevtool.dev');
  assert.deepEqual(report.runs.map(r => r.model), ['jev-1.13.0', 'jev-1.14.0']);
  assert.equal(report.runs[0].questions.team.accuracy, 1);
  assert.equal(report.comparisons[0].flips.team.length, 0);
  assert.equal(calls.length, 4);
  assert.ok(calls.every(c => c.url === 'https://api.typesafe.ai/v1/systemone' && c.auth === 'Bearer ts-fixture'));
  assert.ok(calls.every(c => !('expect' in c.body) && !('cases' in c.body) && !JSON.stringify(c.body).includes('"expect"')));
});

test('missing or malformed key, invalid suite, bad model and oversized body are rejected before any upstream call', async t => {
  const calls = fakeTypeSafe(t);
  assert.equal((await onRequest({ request: request({ suite }, { 'X-TypeSafe-Key': '' }) })).status, 400);
  assert.equal((await onRequest({ request: request({ suite }, { 'X-TypeSafe-Key': 'has space' }) })).status, 400);
  assert.equal((await onRequest({ request: request({ suite: { questions: {}, cases: [] } }) })).status, 400);
  assert.equal((await onRequest({ request: request({ suite, model: 'gpt-5' }) })).status, 400);
  assert.equal((await onRequest({ request: request({ suite, model: 'jev-1.13.0', compare: 'jev-1.13.0' }) })).status, 400);
  assert.equal((await onRequest({ request: request({ suite, target: 2 }) })).status, 400);
  assert.equal((await onRequest({ request: request('{') })).status, 400);
  const big = { ...suite, cases: Array.from({ length: 61 }, (_, i) => ({ id: String(i), state: { text: 'x' } })) };
  const tooMany = await onRequest({ request: request({ suite: big }) });
  assert.equal(tooMany.status, 400);
  assert.match((await tooMany.json()).error, /up to 60 cases/);
  assert.equal((await onRequest({ request: request({ suite, pad: 'x'.repeat(300 * 1024) }) })).status, 413);
  assert.equal(calls.length, 0);
});

test('cross-site, wrong method and wrong media type are refused', async t => {
  const calls = fakeTypeSafe(t);
  assert.equal((await onRequest({ request: request({ suite }, { Origin: 'https://other.example' }) })).status, 403);
  assert.equal((await onRequest({ request: new Request('https://jevtool.dev/api/eval') })).status, 405);
  assert.equal((await onRequest({ request: request({ suite }, { 'Content-Type': 'text/plain' }) })).status, 415);
  assert.equal(calls.length, 0);
});

test('an upstream authentication failure is reported without echoing the upstream body', async t => {
  fakeTypeSafe(t, { status: 401 });
  const response = await onRequest({ request: request({ suite }) });
  assert.equal(response.status, 200);
  const report = await response.json();
  assert.equal(report.status, 'error');
  assert.match(report.runs[0].errors[0].error, /HTTP 401/);
  assert.ok(!JSON.stringify(report).includes('secret upstream detail'));
});
