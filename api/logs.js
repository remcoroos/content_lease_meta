// api/logs.js
/**
 * Simple log retrieval endpoint for Vercel deployments.
 *
 * This endpoint expects the following environment variables to be set:
 *   - VERCEL_TOKEN: A personal token with access to the Vercel API.
 *   - VERCEL_PROJECT_ID: The ID of the Vercel project (can be obtained from the Vercel dashboard).
 *
 * It runs `vercel logs` via the CLI and returns the output as a JSON array.
 * In a serverless environment the CLI may not be available; this is a fallback placeholder.
 */

import { exec } from 'child_process';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const token = process.env.VERCEL_TOKEN;
  const projectId = process.env.VERCEL_PROJECT_ID;

  if (!token || !projectId) {
    res.status(500).json({
      error: 'Missing VERCEL_TOKEN or VERCEL_PROJECT_ID environment variables.'
    });
    return;
  }

  try {
    const { stdout } = await new Promise((resolve, reject) => {
      exec(
        `npx -y vercel logs ${projectId} --token=${token} --since=1h --limit=200`,
        { maxBuffer: 1024 * 1024 },
        (error, stdout, stderr) => {
          if (error) reject(stderr);
          else resolve({ stdout });
        }
      );
    });
    const logs = stdout.split('\n').filter(line => line.trim().length > 0);
    res.status(200).json({ logs });
  } catch (err) {
    res.status(500).json({ error: err.toString() });
  }
}
