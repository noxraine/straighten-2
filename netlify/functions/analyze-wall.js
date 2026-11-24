exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }
  try {
    const { croppedImage } = JSON.parse(event.body || '{}');
    if (!croppedImage) return { statusCode: 400, body: 'Missing croppedImage' };

    const token = process.env.REPLICATE_API_TOKEN;
    if (!token) return { statusCode: 500, body: 'REPLICATE_API_TOKEN not set' };

    const prompt = `This is a cropped photo of ONE wall from a room interior.

Describe what is on this wall in ONE short phrase (5-12 words). Examples:
- a window with a radiator below
- two windows side by side
- a wooden door
- a balcony door with curtains
- an empty white wall
- a painting above a sofa

Be specific about the number and type of objects. Answer with ONLY the description, nothing else.`;

    const createRes = await fetch('https://api.replicate.com/v1/models/lucataco/qwen2-vl-7b-instruct/predictions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Prefer': 'wait=8'
      },
      body: JSON.stringify({
        input: {
          image: croppedImage,
          prompt,
          max_new_tokens: 40,
          temperature: 0.1
        }
      })
    });

    if (!createRes.ok) {
      const errText = await createRes.text();
      return { statusCode: createRes.status, body: errText };
    }

    let prediction = await createRes.json();

    if (prediction.status !== 'succeeded' && prediction.urls?.get) {
      for (let i = 0; i < 15; i++) {
        await new Promise(r => setTimeout(r, 1500));
        const poll = await fetch(prediction.urls.get, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        prediction = await poll.json();
        if (prediction.status === 'succeeded' || prediction.status === 'failed') break;
      }
    }

    if (prediction.status !== 'succeeded') {
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ object: 'empty wall', description: 'the marked wall', raw: '', error: prediction.error || 'VL failed' })
      };
    }

    let raw = prediction.output;
    if (Array.isArray(raw)) raw = raw.join('');
    raw = String(raw || '').trim().replace(/^["']|["']$/g, '');

    const object = normalizeObject(raw);
    const description = raw || 'the marked wall';

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ object, description, raw })
    };
  } catch (err) {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ object: 'empty wall', description: 'the marked wall', raw: '', error: err.message })
    };
  }
};

function normalizeObject(text) {
  const lower = text.toLowerCase();
  if (lower.includes('balcony')) return 'balcony door';
  if (lower.includes('window')) return 'window';
  if (lower.includes('door')) return 'door';
  if (lower.includes('radiator')) return 'radiator';
  if (lower.includes('painting')) return 'painting';
  if (lower.includes('mirror')) return 'mirror';
  return 'empty wall';
}
