// flux-image Cloudflare Worker — text-to-image + image-to-image via fal.ai
// Deploy: wrangler deploy --config flux-image-wrangler.toml
//
// Required secret (never hardcoded here):
//   wrangler secret put FAL_KEY --config flux-image-wrangler.toml
//
// Response contract: raw image bytes + image/jpeg Content-Type
// — matches hf-image-worker.js so ailab.html needs no changes on this side

const FAL_MODEL_GEN  = 'fal-ai/flux-2-pro';        // txt2img — swap to flux-2-max etc. here
const FAL_MODEL_EDIT = 'fal-ai/flux-2-pro/edit';    // img2img (refine) — swap independently here

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
    // transparent cutouts (e.g. bracelet try-on isolation) where alpha must survive.
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

    // Fetch image bytes from fal CDN and pipe back — same contract as hf-image (raw bytes)
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
