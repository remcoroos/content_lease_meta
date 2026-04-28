export default async function handler(req, res) {
  const GH_TOKEN = process.env.GH_TOKEN;
  const REPO = process.env.GITHUB_REPO;
  const WORKFLOW_ID = 'daily-update.yml'; 

  if (!GH_TOKEN || !REPO) {
    // If not configured, just return false so the UI doesn't break
    return res.status(200).json({ isProcessing: false });
  }

  try {
    const response = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW_ID}/runs?status=in_progress`, {
      headers: {
        'Accept': 'application/vnd.github.v3+json',
        'Authorization': `Bearer ${GH_TOKEN}`,
        'User-Agent': 'Vercel-Serverless-Function'
      }
    });

    if (response.ok) {
      const data = await response.json();
      const isProcessing = data.total_count > 0;
      return res.status(200).json({ isProcessing });
    } else {
      return res.status(200).json({ isProcessing: false });
    }
  } catch (error) {
    return res.status(200).json({ isProcessing: false });
  }
}
