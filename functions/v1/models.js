// Every decision model callable through /v1/decisions: TypeSafe's own IDs
// (direct, your TypeSafe key) plus OpenRouter's Decisions catalog (your
// OpenRouter key). Cached at the edge for an hour.
import { CORS, reply } from '../../lib/decisions.js';

const TYPESAFE = [
  { id: 'jev-latest', name: 'Jev (latest stable)' },
  { id: 'jev-preview', name: 'Jev (latest preview)' },
  { id: 'jev-1.13.0', name: 'Jev 1.13' },
  { id: 'jev-1.14.0', name: 'Jev 1.14' },
];

export async function onRequest({ request }) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (request.method !== 'GET') return reply(405, { error: { code: 'method_not_allowed', message: 'Use GET.' } }, { Allow: 'GET, OPTIONS' });
  let openrouter = [];
  try {
    const res = await fetch('https://openrouter.ai/api/v1/models?output_modalities=decisions', { cf: { cacheTtl: 3600, cacheEverything: true } });
    if (res.ok) openrouter = (await res.json()).data.filter(m => !m.id.startsWith('~')).map(m => ({
      id: m.id, name: m.name, provider: 'openrouter', key: 'OpenRouter',
      input_usd_per_million: m.pricing?.prompt === undefined ? null : +(Number(m.pricing.prompt) * 1e6).toFixed(6),
      context_length: m.context_length ?? null,
    }));
  } catch { /* TypeSafe models are still listed. */ }
  const data = [...TYPESAFE.map(m => ({ ...m, provider: 'typesafe', key: 'TypeSafe', input_usd_per_million: 0.042, context_length: 65536 })), ...openrouter];
  return reply(200, { object: 'list', data, note: 'Bring your own key: TypeSafe models need a TypeSafe key, the rest an OpenRouter key.' }, { 'Cache-Control': 'public, max-age=3600' });
}
