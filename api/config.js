const GH_HEADERS = (token) => ({
  'Accept': 'application/vnd.github.v3+json',
  'Authorization': `Bearer ${token}`,
  'Content-Type': 'application/json',
  'User-Agent': 'Vercel-Serverless-Function'
});

async function getVar(repo, token, name) {
  const res = await fetch(`https://api.github.com/repos/${repo}/actions/variables/${name}`, {
    headers: GH_HEADERS(token)
  });
  if (res.ok) return (await res.json()).value;
  if (res.status === 404) return null;
  throw new Error(`GitHub API ${res.status}`);
}

async function setVar(repo, token, name, value) {
  const headers = GH_HEADERS(token);
  const check = await fetch(`https://api.github.com/repos/${repo}/actions/variables/${name}`, { headers });
  const method = check.ok ? 'PATCH' : 'POST';
  const url = check.ok
    ? `https://api.github.com/repos/${repo}/actions/variables/${name}`
    : `https://api.github.com/repos/${repo}/actions/variables`;

  const res = await fetch(url, {
    method,
    headers,
    body: JSON.stringify({ name, value })
  });

  if (!res.ok && res.status !== 201 && res.status !== 204) {
    throw new Error(`GitHub API ${res.status}: ${await res.text()}`);
  }
}

export default async function handler(req, res) {
  const GH_TOKEN = process.env.GH_TOKEN;
  const REPO = process.env.GITHUB_REPO;

  if (!GH_TOKEN || !REPO) {
    return res.status(500).json({ error: 'Server misconfigured: GH_TOKEN or GITHUB_REPO missing' });
  }

  if (req.method === 'GET') {
    try {
      const [feedUrl, alertEmail] = await Promise.all([
        getVar(REPO, GH_TOKEN, 'FEED_URL'),
        getVar(REPO, GH_TOKEN, 'ALERT_EMAIL')
      ]);
      return res.status(200).json({
        feedUrl: feedUrl ?? 'https://googlemerchantcenter.export.dv.nl/4ea2fef4-a44b-47cc-bbff-a5363144a581-vehicles-nl.xml',
        alertEmail: alertEmail ?? ''
      });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  if (req.method === 'POST') {
    const { feedUrl, alertEmail } = req.body ?? {};
    try {
      if (feedUrl !== undefined) await setVar(REPO, GH_TOKEN, 'FEED_URL', feedUrl);
      if (alertEmail !== undefined) await setVar(REPO, GH_TOKEN, 'ALERT_EMAIL', alertEmail);
      return res.status(200).json({ success: true });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: 'Method Not Allowed' });
}
