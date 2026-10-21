// Online eval runner. The browser sends a suite plus the visitor's own TypeSafe
// key; this function runs the same evaluation core as the CLI and returns the
// report. The key is forwarded to TypeSafe for this request only. Nothing is
// stored, and neither the key nor the cases are logged.
import { validateSuite, evaluateSuite } from 'jevtool/eval-core';
import { createClient } from 'jevtool/client';

const MAX_BYTES = 256 * 1024;
const MAX_CASES = 60;
const MODEL = /^jev-(\d{1,3}\.\d{1,3}\.\d{1,3}|latest|preview)$/;

function json(status, body, extra = {}) {
  return new Response(JSON.stringify(body), { status, headers: {
    'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...extra } });
}

async function readBody(request) {
  if (Number(request.headers.get('Content-Length')) > MAX_BYTES) throw new Error('size');
  const reader = request.body?.getReader();
  if (!reader) return '';
  let size = 0;
  const chunks = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BYTES) { await reader.cancel(); throw new Error('size'); }
    chunks.push(value);
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(body);
}

export async function onRequest({ request }) {
  if (request.method !== 'POST') return json(405, { error: 'Use POST.' }, { Allow: 'POST' });
  const origin = request.headers.get('Origin');
  if ((origin && origin !== new URL(request.url).origin) || request.headers.get('Sec-Fetch-Site') === 'cross-site') {
    return json(403, { error: 'Run evaluations from jevtool.dev.' });
  }
  if (request.headers.get('Content-Type')?.split(';')[0].trim() !== 'application/json') return json(415, { error: 'Send JSON.' });
  const apiKey = request.headers.get('X-TypeSafe-Key')?.trim() ?? '';
  if (!apiKey || apiKey.length > 256 || /\s/.test(apiKey)) {
    return json(400, { error: 'Enter your TypeSafe API key. Create one at console.typesafe.ai; it is used for this run only and never stored.' });
  }
  let data;
  try { data = JSON.parse(await readBody(request)); }
  catch (error) {
    return json(error.message === 'size' ? 413 : 400, { error: error.message === 'size'
      ? 'The request is over 256 KB. Trim the cases or run the suite with the CLI.' : 'The request body is not valid JSON.' });
  }
  if (!data || typeof data !== 'object') return json(400, { error: 'The request body is not valid JSON.' });
  const { suite, model, compare, orderCheck, target } = data;
  try { validateSuite(suite); }
  catch (error) { return json(400, { error: error.message }); }
  if (suite.cases.length > MAX_CASES) {
    return json(400, { error: `The online runner takes up to ${MAX_CASES} cases. Install the CLI (npm install -g jevtool) for larger suites.` });
  }
  const models = [model || suite.model || 'jev-1.13.0', ...(compare ? [compare] : [])].map(m => String(m).trim());
  if (models.some(m => !MODEL.test(m)) || new Set(models).size !== models.length) {
    return json(400, { error: 'Model must be a Jev version such as jev-1.13.0, jev-1.14.0, jev-latest or jev-preview, and the compared model must differ.' });
  }
  if (target !== undefined && !(target > 0.5 && target <= 1)) return json(400, { error: 'Target must be between 0.5 and 1.' });
  const report = await evaluateSuite({
    suite, models, concurrency: 6, orderCheck: orderCheck === true, target,
    judgeFor: m => createClient({ apiKey, model: m, timeoutMs: 20_000 }),
  });
  report.runner = 'jevtool.dev';
  return json(200, report);
}
