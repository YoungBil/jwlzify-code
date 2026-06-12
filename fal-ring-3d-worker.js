export default {
  async fetch(request, env) {
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);
    const falUrl = 'https://queue.fal.run' + url.pathname + url.search;

    const outboundHeaders = {
      'Authorization': `Key ${env.FAL_KEY}`,
    };
    if (request.method !== 'GET') {
      outboundHeaders['Content-Type'] = 'application/json';
    }

    let falResponse;
    try {
      falResponse = await fetch(falUrl, {
        method: request.method,
        headers: outboundHeaders,
        body: request.method !== 'GET' ? request.body : undefined,
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: 'Worker upstream error', detail: err.message }), {
        status: 502,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    // Stream the response body rather than buffering it
    return new Response(falResponse.body, {
      status: falResponse.status,
      headers: {
        'Content-Type': falResponse.headers.get('Content-Type') || 'application/json',
        ...corsHeaders,
      },
    });
  }
}
