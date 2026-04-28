export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const token = process.env.GH_TOKEN;
  const repo = process.env.GITHUB_REPO; // format: "owner/repo"

  if (!token || !repo) {
    return res.status(500).json({ error: 'Missing GH_TOKEN or GITHUB_REPO environment variables.' });
  }

  try {
    const response = await fetch(`https://api.github.com/repos/${repo}/actions/runs?per_page=10`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'Vercel-Serverless-Function'
      },
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`GitHub API error: ${response.status} ${err}`);
    }

    const data = await response.json();
    const runs = data.workflow_runs.map(run => ({
      id: run.id,
      name: run.name,
      status: run.status,
      conclusion: run.conclusion,
      created_at: run.created_at,
      updated_at: run.updated_at,
      html_url: run.html_url,
    }));

    return res.status(200).json({ runs });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
