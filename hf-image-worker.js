// hf-image Cloudflare Worker — txt2img + img2img
// Deploy: wrangler deploy hf-image-worker.js --name hf-image
//
// Bindings required in wrangler.toml:
//   [ai]
//   binding = "AI"

const CORS = {
  'Access-Control-Allow-Origin': '*',
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
