export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Post required' });
  }

  const GH_TOKEN = process.env.GH_TOKEN;
  const REPO = process.env.GITHUB_REPO; // e.g. "remcoroos/content-lease-feed"
  const WORKFLOW_ID = 'daily-update.yml'; 

  if (!GH_TOKEN || !REPO) {
    return res.status(500).json({ error: 'Server misconfigured: GH_TOKEN or GITHUB_REPO missing' });
  }

  try {
    const response = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW_ID}/dispatches`, {
      method: 'POST',
      headers: {
        'Accept': 'application/vnd.github.v3+json',
        'Authorization': `Bearer ${GH_TOKEN}`,
        'Content-Type': 'application/json',
        'User-Agent': 'Vercel-Serverless-Function'
      },
      body: JSON.stringify({ ref: 'main' }),
    });

    if (response.ok) {
      return res.status(200).json({ success: true, message: 'GitHub workflow gestart!' });
    } else {
      const errText = await response.text();
      return res.status(response.status).json({ error: `GitHub API error: ${errText}` });
    }
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
