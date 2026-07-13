// vision-verify Cloudflare Worker — checks a generated jewelry image against the
// paid spec using Groq's vision model (Llama 4 Scout). Called by ailab.html's
// generation verify-loop (_verifyImage → _generateVerified).
//
// Deploy (Cloudflare dashboard ONLY — never Wrangler CLI):
//   1. Create a Worker named "vision-verify" → URL https://vision-verify.sarkd333.workers.dev
//   2. Paste this file.
//   3. Settings → Variables → Add → Encrypt:
//        Name:  GROQ_API_KEY     Value: <your Groq API key>
//      Optional plain-text var:
//        Name:  GROQ_MODEL       Value: meta-llama/llama-4-scout-17b-16e-instruct
//
// Request  (POST JSON): { image: "data:image/jpeg;base64,...", expected?: {...} }
//   `expected` is logged for debugging only — it is deliberately NOT shown to the
//   model, so what it reports is unbiased.
// Response (JSON): { jewelryType: string, form: string|null, metalColor: string|null,
//                    stoneShape: string|null, stoneCount: number|null,
//                    stonesEqual: boolean|null }
//   stonesEqual: with 2+ stones visible, whether they all appear ~the same size
//   (null when fewer than 2 stones). Any upstream failure returns a 5xx — the
//   front end FAILS OPEN (accepts the image unverified) so this worker can never
//   block generation.

const GROQ_URL      = 'https://api.groq.com/openai/v1/chat/completions';
const DEFAULT_MODEL = 'meta-llama/llama-4-scout-17b-16e-instruct';

const VERIFY_PROMPT =
  'You are inspecting a product photo of a single piece of jewelry. Respond with ONLY a JSON object, ' +
  'no prose, no markdown fences, exactly this shape: ' +
  '{"jewelry_type": "<one of: ring, earring, pendant, necklace, bracelet, other>", ' +
  '"form": "<for earrings one of: stud, hoop, drop; otherwise null>", ' +
  '"metal_color": "<the color of the metal the piece is made of: one of yellow gold, white metal, ' +
  'rose gold, other; use white metal for silver/white gold/platinum>", ' +
  '"stone_shape": "<the cut/shape of the main stone(s): one of round, oval, cushion, princess, emerald, ' +
  'pear, marquise, radiant, asscher, heart, baguette, trillion, other; null if there are no stones>", ' +
  '"stone_count": <integer — count every distinct gemstone/diamond visible, including small accent ' +
  'stones; if there are clearly more than 12 stones return 13; if there are no stones return 0>, ' +
  '"stones_equal_size": <if 2 or more stones are visible: true when they all appear approximately ' +
  'the same size, false when one stone is clearly larger than the others; null if fewer than 2 stones>}';

/* ── Shared security: origin allowlist + best-effort per-IP rate limit ─────────
   The rate limiter is per-isolate (resets on worker recycle, independent per PoP)
   — it is burst protection, not a hard quota. Origin checking stops casual reuse
   from other sites; determined curl attackers are bounded by the rate limit. */
const ALLOWED_ORIGINS = ['https://jwlzify.com', 'https://www.jwlzify.com'];
function _originAllowed(origin) {
  if (!origin) return false;
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  return /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin); // local dev server
}
const RATE = { windowMs: 60000, max: 15 };          // 15 verifications / minute / IP
const _hits = new Map();
function _rateLimited(ip) {
  const now = Date.now();
  if (_hits.size > 5000) _hits.clear();             // cap memory
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
    const image = body.image || body.imageDataUrl || null;
    if (!image || !String(image).startsWith('data:image/')) {
      return new Response(JSON.stringify({ error: 'image (data URL) is required' }), {
        status: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }
    if (String(image).length > 2500000) { // front end sends a ≤1024px JPEG (~0.4MB data URL); headroom to spare
      return new Response(JSON.stringify({ error: 'image too large' }), {
        status: 413, headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }
    if (body.expected) console.log('[vision-verify] expected (not shown to model):', JSON.stringify(body.expected));

    let groqRes;
    try {
      groqRes = await fetch(GROQ_URL, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${env.GROQ_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: env.GROQ_MODEL || DEFAULT_MODEL,
          temperature: 0,
          max_completion_tokens: 180,
          response_format: { type: 'json_object' },
          messages: [{
            role: 'user',
            content: [
              { type: 'text', text: VERIFY_PROMPT },
              { type: 'image_url', image_url: { url: image } },
            ],
          }],
        }),
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: 'Upstream request to Groq failed', detail: err.message }), {
        status: 502, headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }
    if (!groqRes.ok) {
      const t = await groqRes.text();
      console.error('[vision-verify] Groq', groqRes.status, t.slice(0, 300));
      return new Response(JSON.stringify({ error: `Groq error ${groqRes.status}` }), {
        status: 502, headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    let parsed = null;
    try {
      const data = await groqRes.json();
      let text = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
      text = text.replace(/```json|```/g, '').trim();
      parsed = JSON.parse(text);
    } catch (err) {
      return new Response(JSON.stringify({ error: 'Failed to parse model response' }), {
        status: 502, headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    const out = {
      jewelryType: typeof parsed.jewelry_type === 'string' ? parsed.jewelry_type.toLowerCase() : null,
      form:        typeof parsed.form === 'string' ? parsed.form.toLowerCase() : null,
      metalColor:  typeof parsed.metal_color === 'string' ? parsed.metal_color.toLowerCase() : null,
      stoneShape:  typeof parsed.stone_shape === 'string' ? parsed.stone_shape.toLowerCase() : null,
      stoneCount:  Number.isFinite(parsed.stone_count) ? Math.max(0, Math.round(parsed.stone_count)) : null,
      stonesEqual: typeof parsed.stones_equal_size === 'boolean' ? parsed.stones_equal_size : null,
    };
    console.log('[vision-verify] seen:', JSON.stringify(out));
    return new Response(JSON.stringify(out), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  },
};
