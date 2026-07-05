// hf-image Cloudflare Worker — txt2img + img2img via Cloudflare Workers AI (SDXL).
// TERTIARY fallback generator. ("hf" name is historical — this is Workers AI.)
//
// Deploy (Cloudflare dashboard ONLY — never Wrangler CLI):
//   Worker name: hf-image  →  https://hf-image.sarkd333.workers.dev
//   Settings → Bindings: add a Workers AI binding named  AI
//
// Response contract (unchanged): raw PNG bytes.
// NOTE for generate-collection-images.js (Node batch script): it now needs an
// explicit  Origin: https://jwlzify.com  header on its requests, since this worker
// rejects origin-less callers.

/* ── Shared security: origin allowlist + best-effort per-IP rate limit ───────── */
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

    try {
      const body = await request.json();
      const prompt         = body.inputs || body.prompt || '';
      const negativePrompt = body.negative_prompt || '';
      const initImage      = body.initImage || null;   // base64 string, present on refine passes

      let result;

      if (initImage) {
        // img2img — stay close to original (strength 0.45), apply described changes
        result = await env.AI.run('@cf/stabilityai/stable-diffusion-xl-img2img', {
          prompt,
          image:           initImage,
          strength:        0.45,
          negative_prompt: negativePrompt,
        });
      } else {
        // txt2img — standard generation
        result = await env.AI.run('@cf/stabilityai/stable-diffusion-xl-lightning', {
          prompt,
          negative_prompt: negativePrompt,
        });
      }

      return new Response(result, {
        headers: { ...CORS, 'Content-Type': 'image/png' },
      });

    } catch (err) {
      console.error('[hf-image worker]', err.message);
      return new Response(JSON.stringify({ error: err.message }), {
        status: 500,
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }
  },
};
