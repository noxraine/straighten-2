exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }
  try {
    const { getUrl, id } = JSON.parse(event.body || '{}');
    const token = process.env.REPLICATE_API_TOKEN;
    if (!token) return { statusCode: 500, body: 'REPLICATE_API_TOKEN not set' };

    let url = getUrl;
    if (!url && id) {
      url = `https://api.replicate.com/v1/predictions/${id}`;
    }
    if (!url) return { statusCode: 400, body: 'Missing getUrl or id' };

    const poll = await fetch(url, {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    if (!poll.ok) {
      const errText = await poll.text();
      return { statusCode: poll.status, body: errText };
    }

    const result = await poll.json();

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: result.id,
        status: result.status,
        output: result.output || null,
        error: result.error || null
      })
    };
  } catch (err) {
    return { statusCode: 500, body: err.message };
  }
};
