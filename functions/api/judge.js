// Thin proxy for one Jev request. The browser runs the evaluation itself (same
// core as the CLI) and calls this once per case, so the server only ever sees
// a case's state and the questions: never the expected labels. The visitor's
// key is forwarded to TypeSafe for this request only; nothing is stored or
// logged.
import { createClient } from 'jevtool/client';

const MAX_BYTES = 96 * 1024;
const MODEL = /^jev-(\d{1,3}\.\d{1,3}\.\d{1,3}|latest|preview)$/;
const TYPES = new Set(['noul', 'choice', 'score']);

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
      ? 'One case is over 96 KB. Trim its state or run the suite with the CLI.' : 'The request body is not valid JSON.' });
  }
  if (!data || typeof data !== 'object') return json(400, { error: 'The request body is not valid JSON.' });
  const { model, state, questions } = data;
  if (typeof model !== 'string' || !MODEL.test(model)) return json(400, { error: 'Model must be a Jev version such as jev-1.13.0, jev-1.14.0, jev-latest or jev-preview.' });
  if (state === undefined || state === null) return json(400, { error: 'Each case needs a state.' });
  if (!questions || typeof questions !== 'object' || Array.isArray(questions) || !Object.keys(questions).length
    || !Object.values(questions).every(q => q && typeof q === 'object' && TYPES.has(q.type))) {
    return json(400, { error: 'Questions must be an object of noul, choice or score questions.' });
  }
  const judge = createClient({ apiKey, model, timeoutMs: 20_000 });
  try {
    const result = await judge(state, questions);
    return json(200, { model: result.model, answers: result.answers, usage: result.usage ?? null });
  } catch (error) {
    // The client never includes upstream bodies in its messages.
    return json(502, { error: error.message });
  }
}
