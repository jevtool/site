// jevtool Decisions API: one System One endpoint for every decision model.
//
//   POST /v1/decisions   (also /v1/systemone, so TypeSafe SDKs work by setting
//                         TYPESAFE_BASE_URL=https://jevtool.dev)
//   GET  /v1/models      every decision model you can call here
//
// Bring your own key: the caller's own TypeSafe or OpenRouter key arrives in
// the Authorization header and is forwarded to that provider for this request
// only. jevtool never resells model access, stores keys, or logs requests.
//
// Routing: a model ID with a slash (inception/mercury-decide, typesafe/jev-1.13)
// goes to OpenRouter's Decisions API; one without (jev-latest, jev-1.14.0) goes
// to TypeSafe directly. `models: [...]` adds fallbacks, tried in order when a
// model errors; every fallback must use the same provider as the key.
import { createClient } from 'jevtool/client';
import { Decompress } from 'fzstd';

const MAX_BYTES = 96 * 1024;
const TYPES = new Set(['noul', 'choice', 'score']);
const MODEL_ID = /^[a-z0-9][\w.:~-]*(\/[\w.:~-]+)?$/i;

export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, Idempotency-Key, X-Provider',
  'Access-Control-Expose-Headers': 'X-Jevtool-Provider, X-Jevtool-Model, X-Jevtool-Request-Id',
  'Access-Control-Max-Age': '86400',
};

export function reply(status, body, extra = {}) {
  return new Response(JSON.stringify(body), { status, headers: {
    'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...CORS, ...extra } });
}
// Cloudflare replaces 5xx bodies with its own page, so upstream failures use 424.
const fail = (status, code, message, extra) => reply(status, { error: { code, message } }, extra);

export const providerFor = (model, override) => override ?? (model.includes('/') ? 'openrouter' : 'typesafe');

async function readRaw(request) {
  if (Number(request.headers.get('Content-Length')) > MAX_BYTES) throw new Error('size');
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  return collect(reader);
}

async function collect(reader) {
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
  return body;
}

// TypeSafe's SDKs zstd-compress bodies over 1 KiB by default. Decompress with a
// cap on the decoded size so a small compressed body cannot expand unbounded.
function unzstd(bytes) {
  const out = []; let size = 0;
  const stream = new Decompress((chunk) => {
    size += chunk.byteLength;
    if (size > MAX_BYTES) throw new Error('size');
    out.push(chunk);
  });
  try { stream.push(bytes, true); }
  catch (error) { throw new Error(error.message === 'size' ? 'size' : 'encoding_corrupt'); }
  const body = new Uint8Array(size); let offset = 0;
  for (const chunk of out) { body.set(chunk, offset); offset += chunk.byteLength; }
  return body;
}

export async function readBody(request) {
  const raw = await readRaw(request);
  const encoding = (request.headers.get('Content-Encoding') ?? '').trim().toLowerCase();
  let bytes = raw;
  if (encoding === 'zstd') bytes = unzstd(raw);
  else if (encoding === 'gzip' || encoding === 'deflate') {
    try { bytes = await collect(new Blob([raw]).stream().pipeThrough(new DecompressionStream(encoding)).getReader()); }
    catch (error) { throw new Error(error.message === 'size' ? 'size' : 'encoding_corrupt'); }
  } else if (encoding && encoding !== 'identity') throw new Error('encoding_unsupported');
  return new TextDecoder().decode(bytes);
}

// Map a provider failure to an honest status and an actionable message.
function upstreamFailure(provider, error) {
  const name = provider === 'openrouter' ? 'OpenRouter' : 'TypeSafe';
  const status = Number(/HTTP (\d{3})/.exec(error.message)?.[1]);
  if (status === 401 || status === 403) return [401, 'provider_key_rejected', `${name} rejected the key in your Authorization header. Check that it is a valid ${name} API key.`];
  if (status === 402) return [402, 'provider_payment_required', `${name} reports insufficient credits on your account. Add credits with ${name}, then retry.`];
  if (status === 429) return [429, 'provider_rate_limited', `${name} rate-limited this request. Retry after a short wait.`];
  if (status === 400 || status === 422) return [400, 'provider_rejected_request', `${name} rejected the request (HTTP ${status}). Check the model ID and question format.`];
  if (status === 404) return [404, 'model_not_found', `${name} does not serve this model. List callable models at GET /v1/models.`];
  return [424, 'provider_failed', `${name} could not answer: ${error.message}`];
}

export async function handleDecision(request) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (request.method !== 'POST') return fail(405, 'method_not_allowed', 'Use POST with a JSON body.', { Allow: 'POST, OPTIONS' });
  if (request.headers.get('Content-Type')?.split(';')[0].trim() !== 'application/json') return fail(415, 'invalid_content_type', 'Send Content-Type: application/json.');
  const apiKey = request.headers.get('Authorization')?.match(/^Bearer\s+(\S{8,256})$/i)?.[1];
  if (!apiKey) return fail(401, 'missing_api_key', 'Send your own TypeSafe or OpenRouter API key as "Authorization: Bearer <key>". jevtool does not sell model access.');
  let data;
  try { data = JSON.parse(await readBody(request)); }
  catch (error) {
    if (error.message === 'size') return fail(413, 'request_too_large', 'The request is over 96 KB after decompression. Send less state or split the questions.');
    if (error.message === 'encoding_unsupported') return fail(415, 'unsupported_content_encoding', 'Send the body uncompressed, or with Content-Encoding zstd, gzip or deflate.');
    if (error.message === 'encoding_corrupt') return fail(400, 'invalid_compressed_body', 'The compressed body could not be decoded. Resend it, or send it uncompressed.');
    return fail(400, 'invalid_json', 'The body is not valid JSON.');
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return fail(400, 'invalid_json', 'The body must be a JSON object.');
  const { model, models, state, questions } = data;
  const chain = [...new Set([model, ...(Array.isArray(models) ? models : [])].filter(m => m !== undefined))];
  if (!chain.length || chain.length > 5 || !chain.every(m => typeof m === 'string' && m.length <= 200 && MODEL_ID.test(m))) {
    return fail(400, 'invalid_model', 'Set "model" to a decision model ID, for example "jev-latest" or "inception/mercury-decide". "models" may add up to four fallbacks.');
  }
  const override = request.headers.get('X-Provider')?.toLowerCase();
  if (override && !['typesafe', 'openrouter'].includes(override)) return fail(400, 'invalid_provider', 'X-Provider must be "typesafe" or "openrouter".');
  const provider = providerFor(chain[0], override);
  if (chain.some(m => providerFor(m, override) !== provider)) {
    return fail(400, 'mixed_providers', 'All fallback models must use the same provider as your key: either all OpenRouter IDs (with a slash) or all TypeSafe IDs (without).');
  }
  if (state === undefined || state === null) return fail(400, 'missing_state', 'Set "state" to the text or JSON the questions are about.');
  if (!questions || typeof questions !== 'object' || Array.isArray(questions) || !Object.keys(questions).length || Object.keys(questions).length > 256
    || !Object.values(questions).every(q => q && typeof q === 'object' && TYPES.has(q.type) && q.instructions)) {
    return fail(400, 'invalid_questions', 'Set "questions" to an object of noul, choice or score questions, each with instructions.');
  }
  const requestId = crypto.randomUUID();
  let lastError;
  for (const [index, candidate] of chain.entries()) {
    try {
      const result = await createClient({ provider, apiKey, model: candidate, timeoutMs: 25_000 })(state, questions);
      const body = { id: requestId, provider, model: result.model, answers: result.answers, usage: result.usage ?? null,
        ...(index > 0 ? { fallback: { requested: chain[0], used: candidate, skipped: chain.slice(0, index) } } : {}) };
      return reply(200, body, { 'X-Jevtool-Provider': provider, 'X-Jevtool-Model': result.model, 'X-Jevtool-Request-Id': requestId });
    } catch (error) {
      lastError = error;
      const [status] = upstreamFailure(provider, error);
      // A bad key or empty balance fails the same way for every fallback.
      if (status === 401 || status === 402) break;
    }
  }
  const [status, code, message] = upstreamFailure(provider, lastError);
  return fail(status, code, message, { 'X-Jevtool-Request-Id': requestId });
}
