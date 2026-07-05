// fal-bg-remove Cloudflare Worker — dedicated jewelry background removal (matting)
// via fal.ai birefnet (fallback: rembg).
//
// ⚠ CONTRACT (matches what ailab.html's falCutout() actually consumes):
//   Request  (POST JSON): { image_url: "<https-or-data url>" }  or  { initImage: "<base64>" }
//   Response (JSON):      { image: { url: "<fal CDN png url>" }, model: "birefnet"|"rembg" }
//   The front end fetches the PNG from the returned fal CDN URL itself.
//   (An older repo copy of this file returned raw PNG bytes — that never matched the
//   deployed worker; this version is aligned to the real front-end contract.)
//
// Deploy (Cloudflare dashboard ONLY — never Wrangler CLI):
//   Worker name: fal-bg-remove  →  https://fal-bg-remove.sarkd333.workers.dev
//   Settings → Variables → Add → Encrypt:
//     FAL_KEY = <your fal.ai API key>

const FAL_MODEL_PRIMARY  = 'fal-ai/birefnet';            // dedicated matting → clean alpha
const FAL_MODEL_FALLBACK = 'fal-ai/imageutils/rembg';    // used only if birefnet errors

/* ── Shared security: origin allowlist + best-effort per-IP rate limit ───────── */
const ALLOWED_ORIGINS = ['https://jwlzify.com', 'https://www.jwlzify.com'];
function _originAllowed(origin) {
  if (!origin) return false;
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  return /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
}
const RATE = { windowMs: 60000, max: 10 };   // matting: 10 req / min / IP
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
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }
    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405, headers: CORS });
    }
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
    if (!env.FAL_KEY) {
      return new Response(JSON.stringify({ error: 'Worker misconfigured: FAL_KEY not set' }), {
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

    const b64 = body.initImage || body.image_base64 || null;
    const url = body.image_url || body.imageUrl || null;
    const src = b64 ? `data:image/png;base64,${b64}` : url;
    if (!src) {
      return new Response(JSON.stringify({ error: 'initImage (base64) or image_url is required' }), {
        status: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    async function callModel(model) {
      const res = await fetch(`https://fal.run/${model}`, {
        method: 'POST',
        headers: { 'Authorization': `Key ${env.FAL_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_url: src }),
      });
      if (!res.ok) {
        const t = await res.text();
        throw new Error(`${model} ${res.status}: ${t}`);
      }
      const j = await res.json();
      const out = (j && j.image && j.image.url) || (j && j.images && j.images[0] && j.images[0].url);
      if (!out) throw new Error(`${model}: no image url in response`);
      return out;
    }

    let outUrl, used;
    try {
      outUrl = await callModel(FAL_MODEL_PRIMARY);
      used = 'birefnet';
    } catch (e1) {
      console.warn('[fal-bg-remove] birefnet failed:', e1.message);
      try {
        outUrl = await callModel(FAL_MODEL_FALLBACK);
        used = 'rembg';
      } catch (e2) {
        console.error('[fal-bg-remove] rembg failed:', e2.message);
        return new Response(JSON.stringify({ error: 'fal background removal failed', birefnet: e1.message, rembg: e2.message }), {
          status: 502, headers: { ...CORS, 'Content-Type': 'application/json' },
        });
      }
    }

    console.log(`[fal-bg-remove] SUCCESS via ${used}`);
    // JSON contract — the front end fetches the PNG from the fal CDN itself.
    return new Response(JSON.stringify({ image: { url: outUrl }, model: used }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  },
};
