export default {
  async fetch(request) {
    const apiKey = 'PASTE_NEW_METALS_DEV_KEY_HERE';
    const url = `https://metals.dev/api/latest?api_key=${apiKey}&currency=CAD&unit=g`;

    try {
      const response = await fetch(url);
      const data = await response.json();
      const price = data.metals.gold;

      return new Response(JSON.stringify({ price }), {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': 'https://jwlzify.com',
          'Cache-Control': 'max-age=60'
        }
      });
    } catch (e) {
      return new Response(JSON.stringify({ price: 120.00 }), {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': 'https://jwlzify.com'
        }
      });
    }
  }
};
