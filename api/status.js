export default async function handler(req, res) {
  const GH_TOKEN = process.env.GH_TOKEN;
  const REPO = process.env.GITHUB_REPO;
  const WORKFLOW_ID = 'daily-update.yml';

  if (!GH_TOKEN || !REPO) {
    return res.status(200).json({ isProcessing: false, lastRunFailed: false, runStartedAt: null });
  }

  const headers = {
    'Accept': 'application/vnd.github.v3+json',
    'Authorization': `Bearer ${GH_TOKEN}`,
    'User-Agent': 'Vercel-Serverless-Function'
  };

  try {
    const [inProgressRes, runsRes] = await Promise.all([
      fetch(`https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW_ID}/runs?status=in_progress&per_page=1`, { headers }),
      fetch(`https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW_ID}/runs?per_page=1`, { headers })
    ]);

    let isProcessing = false;
    let runStartedAt = null;

    if (inProgressRes.ok) {
      const data = await inProgressRes.json();
      if (data.total_count > 0) {
        isProcessing = true;
        runStartedAt = data.workflow_runs[0].run_started_at;
      }
    }

    let lastRunFailed = false;
    if (runsRes.ok) {
      const data = await runsRes.json();
      const last = data.workflow_runs?.[0];
      lastRunFailed = last && last.status === 'completed' && last.conclusion === 'failure';
    }

    return res.status(200).json({ isProcessing, lastRunFailed, runStartedAt });
  } catch {
    return res.status(200).json({ isProcessing: false, lastRunFailed: false, runStartedAt: null });
  }
}
