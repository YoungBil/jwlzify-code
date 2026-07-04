const HF_URL = 'https://hf-image.sarkd333.workers.dev/';

async function run() {
  // ── Step 1: txt2img ──────────────────────────────────────────────────────
  console.log('=== STEP 1: txt2img ===');
  console.log('POST', HF_URL);
  console.log('Body:', JSON.stringify({ inputs: 'a simple silver ring on white background', negative_prompt: 'person, human, text' }));

  let txt2imgRes;
  try {
    txt2imgRes = await fetch(HF_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        inputs: 'a simple silver ring on white background',
        negative_prompt: 'person, human, text',
      }),
    });
  } catch (err) {
    console.error('FAIL — network error:', err.message);
    process.exit(1);
  }

  console.log('Response status:', txt2imgRes.status, txt2imgRes.statusText);
  console.log('Content-Type:', txt2imgRes.headers.get('content-type'));

  if (!txt2imgRes.ok) {
    const body = await txt2imgRes.text();
    console.error('FAIL — error body:', body);
    process.exit(1);
  }

  const imgBuffer = Buffer.from(await txt2imgRes.arrayBuffer());
  console.log('OK — received', imgBuffer.length, 'bytes');

  const initImage = imgBuffer.toString('base64');
  console.log('Converted to base64 —', initImage.length, 'chars');

  // ── Step 2: img2img ──────────────────────────────────────────────────────
  console.log('\n=== STEP 2: img2img ===');
  const img2imgBody = {
    inputs: 'same design but with gold color',
    negative_prompt: 'person, human, text',
    initImage,
  };
  console.log('POST', HF_URL);
  console.log('Body (initImage truncated):', JSON.stringify({ ...img2imgBody, initImage: initImage.slice(0, 40) + '…' }));

  let img2imgRes;
  try {
    img2imgRes = await fetch(HF_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(img2imgBody),
    });
  } catch (err) {
    console.error('FAIL — network error:', err.message);
    process.exit(1);
  }

  console.log('Response status:', img2imgRes.status, img2imgRes.statusText);
  console.log('Content-Type:', img2imgRes.headers.get('content-type'));

  if (!img2imgRes.ok) {
    const body = await img2imgRes.text();
    console.error('FAIL — error body:', body);
    process.exit(1);
  }

  const img2imgBuffer = Buffer.from(await img2imgRes.arrayBuffer());
  console.log('OK — received', img2imgBuffer.length, 'bytes');

  console.log('\n=== RESULT: both calls succeeded ===');
}

run().catch(err => { console.error('Unhandled error:', err); process.exit(1); });
