exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }
  try {
    const { image, prompt } = JSON.parse(event.body || '{}');
    if (!image) return { statusCode: 400, body: 'Missing image' };

    const token = process.env.REPLICATE_API_TOKEN;
    if (!token) return { statusCode: 500, body: 'REPLICATE_API_TOKEN not set' };

    const createRes = await fetch('https://api.replicate.com/v1/models/qwen/qwen-edit-multiangle/predictions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Prefer': 'wait=8'
      },
      body: JSON.stringify({
        input: {
          image,
          prompt: prompt || 'Rotate the camera until the wall is perfectly frontal, centered and perpendicular. Keep existing content. No new objects.',
          rotate_degrees: 0,
          vertical_tilt: 0,
          move_forward: 0,
          use_wide_angle: false,
          use_multiple_angles: true,
          go_fast: true,
          multiple_angles_strength: 1,
          aspect_ratio: 'match_input_image',
          output_format: 'png'
        }
      })
    });

    if (!createRes.ok) {
      const errText = await createRes.text();
      return { statusCode: createRes.status, body: errText };
    }

    const prediction = await createRes.json();
    let result = prediction;
    if (result.status !== 'succeeded' && result.urls?.get) {
      for (let i = 0; i < 30; i++) {
        await new Promise(r => setTimeout(r, 2000));
        const poll = await fetch(result.urls.get, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        result = await poll.json();
        if (result.status === 'succeeded' || result.status === 'failed') break;
      }
    }

    if (result.status !== 'succeeded') {
      return { statusCode: 500, body: JSON.stringify({ error: result.error || 'Prediction failed' }) };
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ output: result.output })
    };
  } catch (err) {
    return { statusCode: 500, body: err.message };
  }
};