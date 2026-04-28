async function getAlertEmail(repo, token) {
  const res = await fetch(`https://api.github.com/repos/${repo}/actions/variables/ALERT_EMAIL`, {
    headers: {
      'Accept': 'application/vnd.github.v3+json',
      'Authorization': `Bearer ${token}`,
      'User-Agent': 'Vercel-Serverless-Function'
    }
  });
  if (res.ok) return (await res.json()).value;
  return null;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { secret, run_url } = req.body ?? {};

  if (!process.env.NOTIFY_SECRET || secret !== process.env.NOTIFY_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  const GH_TOKEN = process.env.GH_TOKEN;
  const REPO = process.env.GITHUB_REPO;

  if (!RESEND_API_KEY) {
    return res.status(500).json({ error: 'RESEND_API_KEY not configured' });
  }

  const alertEmail = await getAlertEmail(REPO, GH_TOKEN);
  if (!alertEmail) {
    return res.status(200).json({ message: 'No alert email configured — skipped' });
  }

  const fromAddress = process.env.RESEND_FROM ?? 'onboarding@resend.dev';

  const emailRes = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: `Content Lease Feed <${fromAddress}>`,
      to: alertEmail,
      subject: 'Feed synchronisatie mislukt',
      html: `
        <div style="font-family:Arial,sans-serif;max-width:480px;color:#38485F">
          <div style="background:#E73E1D;padding:16px 24px;border-radius:8px 8px 0 0">
            <span style="color:white;font-weight:700;font-size:16px">Content Lease Feed</span>
          </div>
          <div style="border:1px solid #E2E8F0;border-top:none;padding:24px;border-radius:0 0 8px 8px">
            <p style="margin:0 0 12px;font-size:15px;font-weight:600">Synchronisatie mislukt</p>
            <p style="margin:0 0 20px;font-size:14px;color:#807E7D;line-height:1.5">
              Er is een fout opgetreden bij het automatisch genereren van de Meta product feed.
              De vorige versie van de feed is nog actief, maar er zijn geen nieuwe wijzigingen verwerkt.
            </p>
            ${run_url ? `<a href="${run_url}" style="display:inline-block;background:#38485F;color:white;padding:10px 20px;border-radius:6px;text-decoration:none;font-size:13px;font-weight:600">Bekijk foutmelding op GitHub</a>` : ''}
          </div>
        </div>
      `
    })
  });

  if (emailRes.ok) return res.status(200).json({ success: true });
  return res.status(500).json({ error: await emailRes.text() });
}
