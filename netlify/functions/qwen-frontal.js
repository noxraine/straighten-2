exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }
  try {
    const { image, prompt } = JSON.parse(event.body || '{}');
    if (!image) return { statusCode: 400, body: 'Missing image' };

    const token = process.env.REPLICATE_API_TOKEN;
    if (!token) return { statusCode: 500, body: 'REPLICATE_API_TOKEN not set' };

    const input = {
      image,
      prompt: prompt || 'Rotate the camera until the wall is perfectly frontal, centered and perpendicular. Keep all existing walls, doors and windows exactly as they are. No new objects.',
      use_wide_angle: false,
      use_multiple_angles: true,
      go_fast: true,
      multiple_angles_strength: 1,
      aspect_ratio: 'match_input_image',
      output_format: 'png'
    };

    const createRes = await fetch('https://api.replicate.com/v1/models/qwen/qwen-edit-multiangle/predictions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ input })
    });

    if (!createRes.ok) {
      const errText = await createRes.text();
      return { statusCode: createRes.status, body: errText };
    }

    const prediction = await createRes.json();

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: prediction.id,
        status: prediction.status,
        getUrl: prediction.urls?.get || null,
        output: prediction.output || null
      })
    };
  } catch (err) {
    return { statusCode: 500, body: err.message };
  }
};
