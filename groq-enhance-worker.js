// groq-enhance Cloudflare Worker — expands a raw jewelry idea into a vivid
// STYLE/AESTHETIC description for the generation prompt (Step 1 "Enhanced by AI"
// panel in ailab.html).
//
// ⚠ IMPORTANT BEFORE PASTING: the deployed worker at
//   https://groq-enhance.sarkd333.workers.dev predates this repo copy (there was no
//   source in the repo). Compare against the dashboard version and keep its system
//   prompt if it differs meaningfully. The response contract must not change:
//     POST { idea, jewelryType, earringStyle?, earringStyleDescriptor? } → { enhanced }
//
// Deploy (Cloudflare dashboard ONLY — never Wrangler CLI):
//   Worker name: groq-enhance
//   Settings → Variables → Add → Encrypt:
//     GROQ_API_KEY = <your Groq API key>
//   Optional plain-text var:
//     GROQ_MODEL   = llama-3.3-70b-versatile

const GROQ_URL      = 'https://api.groq.com/openai/v1/chat/completions';
const DEFAULT_MODEL = 'llama-3.3-70b-versatile';

/* ── Shared security: origin allowlist + best-effort per-IP rate limit ───────── */
const ALLOWED_ORIGINS = ['https://jwlzify.com', 'https://www.jwlzify.com'];
function _originAllowed(origin) {
  if (!origin) return false;
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  return /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
}
const RATE = { windowMs: 60000, max: 20 };   // enhancement is debounced client-side: 20 / min / IP
const _hits = new Map();
function _rateLimited(ip) {
  const now = Date.now();
  if (_hits.size > 5000) _hits.clear();
  const h = _hits.get(ip);
  if (!h || now - h.t0 > RATE.windowMs) { _hits.set(ip, { t0: now, n: 1 }); return false; }
  h.n++;
  return h.n > RATE.max;
}
function _cors(origin) {
  return {
    'Access-Control-Allow-Origin': _originAllowed(origin) ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
  };
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const CORS = _cors(origin);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (request.method !== 'POST')    return new Response('Method not allowed', { status: 405, headers: CORS });
    if (!_originAllowed(origin)) {
      return new Response(JSON.stringify({ error: 'Origin not allowed' }), {
        status: 403, headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    if (_rateLimited(ip)) {
      return new Response(JSON.stringify({ error: 'rate_limited' }), {
        status: 429, headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }
    if (!env.GROQ_API_KEY) {
      return new Response(JSON.stringify({ error: 'Worker misconfigured: GROQ_API_KEY not set' }), {
        status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    let body;
    try { body = await request.json(); }
    catch {
      return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
        status: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }
    const idea = String(body.idea || '').slice(0, 2000);
    const jewelryType = String(body.jewelryType || 'jewelry').slice(0, 40);
    const earringStyleDescriptor = String(body.earringStyleDescriptor || '').slice(0, 300);
    if (!idea) {
      return new Response(JSON.stringify({ error: 'idea is required' }), {
        status: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    // The structured specs (stone count/size, metal, lengths) are the front end's
    // source of truth and get stripped/re-injected there — the enhancement must add
    // AESTHETIC detail only, never quantities, sizes, or metals.
    const system =
      'You are a luxury jewelry copywriter. Expand the user\'s idea into a vivid, concrete visual ' +
      'description of a ' + jewelryType + ' design in 2–4 sentences. Describe silhouette, setting style, ' +
      'surface finish, mood, and design details. HARD RULES: describe a ' + jewelryType + ' and nothing ' +
      'else; do NOT mention stone counts or quantities; do NOT mention carats, sizes, or dimensions; ' +
      'do NOT name a metal or metal color; do NOT use gendered language' +
      (earringStyleDescriptor ? ('; respect this style direction: ' + earringStyleDescriptor) : '') +
      '. Output only the description text, no preamble.';

    let res;
    try {
      res = await fetch(GROQ_URL, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${env.GROQ_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: env.GROQ_MODEL || DEFAULT_MODEL,
          temperature: 0.7,
          max_completion_tokens: 220,
          messages: [
            { role: 'system', content: system },
            { role: 'user',   content: idea },
          ],
        }),
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: 'Upstream request to Groq failed', detail: err.message }), {
        status: 502, headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }
    if (!res.ok) {
      const t = await res.text();
      console.error('[groq-enhance] Groq', res.status, t.slice(0, 300));
      return new Response(JSON.stringify({ error: `Groq error ${res.status}` }), {
        status: 502, headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    let enhanced = '';
    try {
      const data = await res.json();
      enhanced = ((data.choices && data.choices[0] && data.choices[0].message
                   && data.choices[0].message.content) || '').trim();
    } catch (err) {
      return new Response(JSON.stringify({ error: 'Failed to parse Groq response' }), {
        status: 502, headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    console.log('[groq-enhance] ok | type=' + jewelryType + ' | chars=' + enhanced.length);
    return new Response(JSON.stringify({ enhanced: enhanced }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  },
};
