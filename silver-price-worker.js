// silver-price Cloudflare Worker — live silver spot price proxy (metals.dev).
//
// Contract (what ailab.html + pricing.js consume):
//   GET → JSON { price: <pure silver, USD per GRAM> }
//   The front end applies the 925 purity factor (×0.925) itself.
//
// Deploy (Cloudflare dashboard ONLY — never Wrangler CLI):
//   Worker name: silver-price  →  https://silver-price.sarkd333.workers.dev
//   Settings → Variables → Add → Encrypt:
//     METALS_API_KEY = <your metals.dev API key>
//   (The old repo copy hardcoded a placeholder key and requested CAD — this
//    version requests USD/gram and reads the key from a secret.)

/* ── Shared security: origin allowlist + best-effort per-IP rate limit ───────── */
const ALLOWED_ORIGINS = ['https://jwlzify.com', 'https://www.jwlzify.com'];
function _originAllowed(origin) {
  if (!origin) return false;
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  return /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
}
const RATE = { windowMs: 60000, max: 30 };   // price checks: 30 / min / IP
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
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
  };
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const CORS = _cors(origin);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
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

    // Fallback: sensible pure-silver USD/g so pricing still works if metals.dev is down.
    const FALLBACK = 1.05;
    if (!env.METALS_API_KEY) {
      console.error('[silver-price] METALS_API_KEY not set — serving fallback');
      return new Response(JSON.stringify({ price: FALLBACK, source: 'fallback' }), {
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    try {
      const response = await fetch(
        `https://metals.dev/api/latest?api_key=${env.METALS_API_KEY}&currency=USD&unit=g`,
        { cf: { cacheTtl: 60 } }
      );
      const data  = await response.json();
      const price = data && data.metals && data.metals.silver;
      if (!(price > 0)) throw new Error('no silver price in response');
      return new Response(JSON.stringify({ price: price }), {
        headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'max-age=60' },
      });
    } catch (e) {
      console.warn('[silver-price] upstream failed:', e.message, '— serving fallback');
      return new Response(JSON.stringify({ price: FALLBACK, source: 'fallback' }), {
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }
  },
};
