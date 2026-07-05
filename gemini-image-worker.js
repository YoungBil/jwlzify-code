// gemini-image Cloudflare Worker — PRIMARY image generation (Gemini image model).
//
// ⚠ IMPORTANT BEFORE PASTING: the deployed worker at
//   https://gemini-image.sarkd333.workers.dev predates this repo copy (there was no
//   source in the repo). Open the currently-deployed code in the dashboard FIRST and
//   carry over its model name / any response tweaks if they differ from GEMINI_MODEL
//   below. The response contract the front end depends on must not change:
//     POST { prompt, negativePrompt } → JSON { imageData: <base64>, mimeType }
//     rate limit → HTTP 429 and/or JSON { error: "rate_limited" }
//     other errors → JSON { error: "..." }
//
// Deploy (Cloudflare dashboard ONLY — never Wrangler CLI):
//   Worker name: gemini-image
//   Settings → Variables → Add → Encrypt:
//     GEMINI_API_KEY = <your Google AI Studio key>
//   Optional plain-text var:
//     GEMINI_MODEL   = gemini-2.5-flash-image   (or whatever the deployed one used)

const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash-image';

/* ── Shared security: origin allowlist + best-effort per-IP rate limit ─────────
   In-memory limiter is per-isolate/per-PoP (resets on recycle) — burst protection,
   not a hard quota. Origin checking blocks other sites' browsers from spending our
   API budget; curl-level abuse is bounded by the rate limit. Local dev must be
   served from localhost (e.g. `python -m http.server`), not file://. */
const ALLOWED_ORIGINS = ['https://jwlzify.com', 'https://www.jwlzify.com'];
function _originAllowed(origin) {
  if (!origin) return false;
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  return /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
}
const RATE = { windowMs: 60000, max: 15 };   // image generation: 15 req / min / IP
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
    if (!env.GEMINI_API_KEY) {
      return new Response(JSON.stringify({ error: 'Worker misconfigured: GEMINI_API_KEY not set' }), {
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
    const prompt = body.prompt || '';
    if (!prompt) {
      return new Response(JSON.stringify({ error: 'prompt is required' }), {
        status: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    const model = env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
    const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + model
              + ':generateContent?key=' + env.GEMINI_API_KEY;

    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
        }),
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: 'Upstream request to Gemini failed', detail: err.message }), {
        status: 502, headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    if (res.status === 429) {
      // Pass rate limiting through in the exact shape ailab.html expects.
      return new Response(JSON.stringify({ error: 'rate_limited' }), {
        status: 429, headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }
    if (!res.ok) {
      const t = await res.text();
      console.error('[gemini-image] upstream', res.status, t.slice(0, 300));
      return new Response(JSON.stringify({ error: 'Gemini error ' + res.status }), {
        status: 502, headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    let imageData = null, mimeType = 'image/png';
    try {
      const data  = await res.json();
      const parts = (data.candidates && data.candidates[0] && data.candidates[0].content
                     && data.candidates[0].content.parts) || [];
      for (const p of parts) {
        const inline = p.inlineData || p.inline_data;
        if (inline && inline.data) {
          imageData = inline.data;
          mimeType  = inline.mimeType || inline.mime_type || 'image/png';
          break;
        }
      }
    } catch (err) {
      return new Response(JSON.stringify({ error: 'Failed to parse Gemini response' }), {
        status: 502, headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }
    if (!imageData) {
      return new Response(JSON.stringify({ error: 'No image data in Gemini response' }), {
        status: 502, headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    console.log('[gemini-image] SUCCESS | model=' + model + ' | bytes(base64)=' + imageData.length);
    return new Response(JSON.stringify({ imageData: imageData, mimeType: mimeType }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  },
};
