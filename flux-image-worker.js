// flux-image Cloudflare Worker — text-to-image + image-to-image via fal.ai.
// SOLE image generator for the live app (ailab.html): txt2img + the img2img refine
// path. (Gemini and HuggingFace/SDXL were removed from generation — Flux only.)
//
// Deploy (Cloudflare dashboard ONLY — never Wrangler CLI):
//   Worker name: flux-image  →  https://flux-image.sarkd333.workers.dev
//   Settings → Variables → Add → Encrypt:
//     FAL_KEY = <your fal.ai API key>
//
// Response contract (unchanged): raw image bytes + image/jpeg (or png) Content-Type
// — matches what ailab.html consumes; no front-end changes needed.

const FAL_MODEL_GEN  = 'fal-ai/flux-2-pro';         // txt2img — swap model here
const FAL_MODEL_EDIT = 'fal-ai/flux-2-pro/edit';    // img2img (refine) — swap independently

/* ── Shared security: origin allowlist + best-effort per-IP rate limit ─────────
   In-memory limiter is per-isolate/per-PoP (resets on recycle) — burst protection,
   not a hard quota. Local dev must be served from localhost, not file://.
   NOTE: generate-collection-images.js (the one-time Node batch script) has no
   browser Origin — if it is ever re-run against this worker, temporarily add its
   use or run it with an explicit  Origin: https://jwlzify.com  header. */
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

    if (!env.FAL_KEY) {
      console.error('[JWLZIFY] flux-image: FAL_KEY secret not set');
      return new Response(JSON.stringify({ error: 'Worker misconfigured: FAL_KEY not set' }), {
        status: 500,
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
        status: 400,
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    const prompt    = body.inputs || body.prompt || '';
    const imageSize = body.image_size || 'portrait_4_3';
    const initImage = body.initImage || null;  // raw base64 string; presence triggers edit endpoint
    // Output format: default jpeg (unchanged for generation). PNG is requested for
    // transparent cutouts where alpha must survive.
    const outputFormat = (body.output_format === 'png') ? 'png' : 'jpeg';

    if (!prompt) {
      return new Response(JSON.stringify({ error: 'prompt is required' }), {
        status: 400,
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    // Branch: img2img edit vs. txt2img generation
    const isEdit      = !!initImage;
    const falModel    = isEdit ? FAL_MODEL_EDIT : FAL_MODEL_GEN;
    const falEndpoint = `https://fal.run/${falModel}`;
    const falBody     = isEdit
      ? {
          prompt,
          image_url:             `data:image/png;base64,${initImage}`,
          image_size:            imageSize,
          output_format:         outputFormat,
          enable_safety_checker: true,
        }
      : {
          prompt,
          image_size:            imageSize,
          output_format:         outputFormat,
          enable_safety_checker: true,
        };

    console.log(`[JWLZIFY] flux-image: calling ${falModel} | mode=${isEdit ? 'edit' : 'gen'}`);

    let falRes;
    try {
      falRes = await fetch(falEndpoint, {
        method: 'POST',
        headers: {
          'Authorization': `Key ${env.FAL_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(falBody),
      });
    } catch (err) {
      console.error('[JWLZIFY] flux-image: upstream fetch failed:', err.message);
      return new Response(JSON.stringify({ error: 'Upstream request to fal.ai failed', detail: err.message }), {
        status: 502,
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    if (!falRes.ok) {
      const errText = await falRes.text();
      console.error(`[JWLZIFY] flux-image: fal returned ${falRes.status} (${falModel}):`, errText);
      return new Response(JSON.stringify({ error: `fal.ai error ${falRes.status}`, detail: errText }), {
        status: falRes.status,
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    let falJson;
    try {
      falJson = await falRes.json();
    } catch (err) {
      console.error('[JWLZIFY] flux-image: failed to parse fal response:', err.message);
      return new Response(JSON.stringify({ error: 'Failed to parse fal.ai response' }), {
        status: 502,
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    const imageUrl = falJson?.images?.[0]?.url;
    if (!imageUrl) {
      console.error('[JWLZIFY] flux-image: no image URL in fal response:', JSON.stringify(falJson));
      return new Response(JSON.stringify({ error: 'No image returned by fal.ai', raw: falJson }), {
        status: 502,
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    // Fetch image bytes from fal CDN and pipe back — same contract as before (raw bytes)
    let imgRes;
    try {
      imgRes = await fetch(imageUrl);
    } catch (err) {
      console.error('[JWLZIFY] flux-image: CDN fetch failed:', err.message);
      return new Response(JSON.stringify({ error: 'Failed to fetch generated image from CDN', detail: err.message }), {
        status: 502,
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    if (!imgRes.ok) {
      console.error(`[JWLZIFY] flux-image: CDN returned ${imgRes.status}`);
      return new Response(JSON.stringify({ error: `Image CDN returned ${imgRes.status}` }), {
        status: 502,
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    console.log(`[JWLZIFY] flux-image: SUCCESS | mode=${isEdit ? 'edit' : 'gen'} | format=${outputFormat}`);
    return new Response(imgRes.body, {
      headers: { ...CORS, 'Content-Type': outputFormat === 'png' ? 'image/png' : 'image/jpeg' },
    });
  },
};
