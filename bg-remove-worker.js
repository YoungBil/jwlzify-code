// bg-remove Cloudflare Worker — dedicated jewelry background removal (matting) via fal.ai.
// Returns a clean transparent PNG (alpha by design), including enclosed inner regions
// such as the hole in the centre of a bracelet loop.
//
// Deploy (Cloudflare dashboard): create a Worker named "bg-remove", paste this code,
// then add an encrypted secret:
//     Settings → Variables → "Add variable" → Encrypt
//     Name:  FAL_KEY
//     Value: <your fal.ai API key>
// Resulting URL used by ailab.html:  https://bg-remove.<your-subdomain>.workers.dev
//
// Request  (POST JSON): { initImage: "<base64>" }  OR  { image_url: "<https url>" }
// Response: raw PNG bytes, Content-Type: image/png  (same proxy/CORS pattern as the
//           other workers — fal key never leaves the worker).

const FAL_MODEL_PRIMARY  = 'fal-ai/birefnet';            // dedicated matting → clean alpha
const FAL_MODEL_FALLBACK = 'fal-ai/imageutils/rembg';    // used only if birefnet errors

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }
    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405, headers: CORS });
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
      console.warn('[bg-remove] birefnet failed:', e1.message);
      try {
        outUrl = await callModel(FAL_MODEL_FALLBACK);
        used = 'rembg';
      } catch (e2) {
        console.error('[bg-remove] rembg failed:', e2.message);
        return new Response(JSON.stringify({ error: 'fal background removal failed', birefnet: e1.message, rembg: e2.message }), {
          status: 502, headers: { ...CORS, 'Content-Type': 'application/json' },
        });
      }
    }

    let imgRes;
    try { imgRes = await fetch(outUrl); }
    catch (err) {
      return new Response(JSON.stringify({ error: 'Failed to fetch matte from fal CDN', detail: err.message }), {
        status: 502, headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }
    if (!imgRes.ok) {
      return new Response(JSON.stringify({ error: `fal CDN returned ${imgRes.status}` }), {
        status: 502, headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    console.log(`[bg-remove] SUCCESS via ${used}`);
    return new Response(imgRes.body, {
      headers: { ...CORS, 'Content-Type': 'image/png', 'X-Cutout-Model': used },
    });
  },
};
