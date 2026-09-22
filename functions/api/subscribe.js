const MAX_BYTES = 2048;

function reply(request, status, message) {
  const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
  if (request.headers.get('Accept')?.includes('text/html')) {
    headers['Content-Type'] = 'text/html; charset=utf-8';
    return new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>jevtool — Early access</title><body style="background:#f386a1;color:#1e1e1e;font:18px/1.6 system-ui;padding:32px"><main><h1>${status === 200 ? "You're on the list." : 'Please try again.'}</h1><p>${message}</p><a href="/#early-access">Back to jevtool</a></main></body></html>`, { status, headers });
  }
  headers['Content-Type'] = 'application/json; charset=utf-8';
  return new Response(JSON.stringify(status === 200 ? { ok: true } : { error: message }), { status, headers });
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

export async function onRequest({ request, env }) {
  if (request.method !== 'POST') {
    const response = reply(request, 405, 'Please submit the signup form.');
    response.headers.set('Allow', 'POST');
    return response;
  }
  const origin = request.headers.get('Origin');
  if ((origin && origin !== new URL(request.url).origin) || request.headers.get('Sec-Fetch-Site') === 'cross-site') {
    return reply(request, 403, 'Please submit the form on jevtool.dev.');
  }
  const type = request.headers.get('Content-Type')?.split(';')[0].trim();
  if (!['application/json', 'application/x-www-form-urlencoded'].includes(type)) {
    return reply(request, 415, 'Please submit a valid signup form.');
  }
  let data;
  try {
    const body = await readBody(request);
    data = type === 'application/json' ? JSON.parse(body) : Object.fromEntries(new URLSearchParams(body));
  } catch (error) {
    return reply(request, error.message === 'size' ? 413 : 400, 'Please submit a valid email address.');
  }
  if (!data || typeof data !== 'object') return reply(request, 400, 'Please submit a valid email address.');
  if (data.website) return reply(request, 200, 'Thanks for your interest.');
  const email = typeof data.email === 'string' ? data.email.trim().toLowerCase() : '';
  if (email.length > 254 || !/^[^\s@<>\x00-\x1f\x7f]+@[^\s@<>\x00-\x1f\x7f]+\.[^\s@<>\x00-\x1f\x7f]+$/.test(email)) {
    return reply(request, 400, 'Please enter a valid email address.');
  }
  if (!env.SUBSCRIBERS) return reply(request, 503, 'Signups are temporarily unavailable. Please try again later.');
  try {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(email));
    const key = 'subscriber:' + Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
    // Deterministic keys deduplicate signups without exposing emails in key names.
    if (!await env.SUBSCRIBERS.get(key)) {
      await env.SUBSCRIBERS.put(key, JSON.stringify({ email, subscribedAt: new Date().toISOString(), source: 'jevtool.dev' }));
    }
    return reply(request, 200, "We'll let you know when jevtool is ready.");
  } catch {
    // Never log submitted emails or KV values.
    return reply(request, 503, 'Could not save your email. Please try again shortly.');
  }
}
