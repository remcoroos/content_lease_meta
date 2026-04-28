export default async function handler(req, res) {
  const GH_TOKEN = process.env.GH_TOKEN;
  const REPO = process.env.GITHUB_REPO; // e.g. "remcoroos/content-lease-feed"

  if (!GH_TOKEN || !REPO) {
    return res.status(500).json({ error: 'Server misconfigured: GH_TOKEN or GITHUB_REPO missing' });
  }

  const headers = {
    'Accept': 'application/vnd.github.v3+json',
    'Authorization': `Bearer ${GH_TOKEN}`,
    'Content-Type': 'application/json',
    'User-Agent': 'Vercel-Serverless-Function'
  };

  const varName = 'FEED_URL';

  if (req.method === 'GET') {
    try {
      const response = await fetch(`https://api.github.com/repos/${REPO}/actions/variables/${varName}`, { headers });
      
      if (response.ok) {
        const data = await response.json();
        return res.status(200).json({ feedUrl: data.value });
      } else if (response.status === 404) {
        // Variable not set yet, return default or empty
        return res.status(200).json({ feedUrl: "https://googlemerchantcenter.export.dv.nl/4ea2fef4-a44b-47cc-bbff-a5363144a581-vehicles-nl.xml" });
      } else {
        const errText = await response.text();
        return res.status(response.status).json({ error: `GitHub API error: ${errText}` });
      }
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  } 
  
  else if (req.method === 'POST') {
    const { feedUrl } = req.body;
    if (!feedUrl) return res.status(400).json({ error: "feedUrl is required" });

    try {
      // Check if variable exists first
      const checkResponse = await fetch(`https://api.github.com/repos/${REPO}/actions/variables/${varName}`, { headers });
      
      let updateResponse;
      if (checkResponse.ok) {
        // Variable exists, PATCH it
        updateResponse = await fetch(`https://api.github.com/repos/${REPO}/actions/variables/${varName}`, {
          method: 'PATCH',
          headers,
          body: JSON.stringify({ name: varName, value: feedUrl })
        });
      } else if (checkResponse.status === 404) {
        // Variable doesn't exist, POST it
        updateResponse = await fetch(`https://api.github.com/repos/${REPO}/actions/variables`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ name: varName, value: feedUrl })
        });
      } else {
        const errText = await checkResponse.text();
        return res.status(checkResponse.status).json({ error: `GitHub API error during check: ${errText}` });
      }

      if (updateResponse.ok || updateResponse.status === 201 || updateResponse.status === 204) {
        return res.status(200).json({ success: true, feedUrl });
      } else {
        const errText = await updateResponse.text();
        return res.status(updateResponse.status).json({ error: `GitHub API error during update: ${errText}` });
      }
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  }

  return res.status(405).json({ error: 'Method Not Allowed' });
}
