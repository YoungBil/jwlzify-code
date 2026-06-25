// enhance-prompt Cloudflare Worker — expands a customer's simple jewelry idea
// into a vivid STYLE/AESTHETIC description via the Anthropic API (Claude).
//
// Deploy (Cloudflare dashboard — no wrangler CLI needed):
//   1. Workers & Pages → Create → Worker → name it exactly:  enhance-prompt
//   2. Paste this file as the worker code and Deploy.
//   3. Settings → Variables and Secrets → Add → Encrypt (Secret):
//        Name:  ANTHROPIC_API_KEY
//        Value: <your Anthropic API key, starts with sk-ant-...>
//   Resulting URL used by ailab.html:
//        https://enhance-prompt.<your-subdomain>.workers.dev
//   (ailab.html points at https://enhance-prompt.sarkd333.workers.dev)
//
// Request  (POST JSON): { "description": "<the customer's raw typed idea>" }
// Response (JSON):      { "enhanced": "<2-4 sentence enriched description>" }
//   The API key never leaves the worker. Same CORS/proxy pattern as the other
//   jwlzify workers.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const MODEL      = 'claude-sonnet-4-6';
const MAX_TOKENS = 1000;

const SYSTEM_PROMPT =
  "You are a luxury jewelry design expert turning a customer's simple idea into a " +
  "vivid, detailed visual description for an AI image generator. Expand their idea " +
  "with rich aesthetic and stylistic detail: setting style, band/chain details, " +
  "metal finish texture, gemstone cut and arrangement aesthetics, era/style " +
  "influences, mood, lighting, and craftsmanship feel. Stay TRUE to their core idea " +
  "and jewelry type — do not change the type of jewelry or invent a totally " +
  "different piece. Keep it to 2-4 evocative sentences, suitable as an image " +
  "generation prompt. Do NOT mention the number of stones, carat sizes, metal karat, " +
  "or measurements — those are set separately via the specification selectors. Focus " +
  "only on style, shape, setting aesthetic, and mood. Output ONLY the enhanced " +
  "description, with no preamble.";

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }
    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405, headers: CORS });
    }
    if (!env.ANTHROPIC_API_KEY) {
      console.error('[enhance-prompt] ANTHROPIC_API_KEY secret not set');
      return json({ error: 'Worker misconfigured: ANTHROPIC_API_KEY not set' }, 500);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: 'Invalid JSON body' }, 400);
    }

    const description = (body.description || body.prompt || '').toString().trim();
    if (!description) {
      return json({ error: 'description is required' }, 400);
    }

    let aiRes;
    try {
      aiRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type':      'application/json',
          'x-api-key':         env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model:      MODEL,
          max_tokens: MAX_TOKENS,
          system:     SYSTEM_PROMPT,
          messages:   [{ role: 'user', content: description }],
        }),
      });
    } catch (err) {
      console.error('[enhance-prompt] upstream fetch failed:', err.message);
      return json({ error: 'Upstream request to Anthropic failed', detail: err.message }, 502);
    }

    if (!aiRes.ok) {
      const errText = await aiRes.text().catch(() => '(unreadable)');
      console.error('[enhance-prompt] Anthropic returned ' + aiRes.status + ':', errText);
      return json({ error: 'Anthropic error ' + aiRes.status, detail: errText }, aiRes.status);
    }

    let data;
    try {
      data = await aiRes.json();
    } catch (err) {
      console.error('[enhance-prompt] failed to parse Anthropic response:', err.message);
      return json({ error: 'Failed to parse Anthropic response' }, 502);
    }

    // Concatenate all text blocks in the response content array.
    const enhanced = Array.isArray(data.content)
      ? data.content.filter(b => b && b.type === 'text').map(b => b.text).join('').trim()
      : '';

    if (!enhanced) {
      console.error('[enhance-prompt] no text in response:', JSON.stringify(data));
      return json({ error: 'No enhanced description returned' }, 502);
    }

    console.log('[enhance-prompt] SUCCESS | in=' + description.length + ' chars | out=' + enhanced.length + ' chars');
    return json({ enhanced });
  },
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}
