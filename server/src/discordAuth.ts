import { Request, Response } from 'express';

export async function handleDiscordTokenExchange(req: Request, res: Response) {
  const { code } = req.body;
  const clientId = process.env.VITE_DISCORD_CLIENT_ID;
  const clientSecret = process.env.DISCORD_CLIENT_SECRET;

  if (!code) {
    return res.status(400).json({ error: 'Missing code in request body' });
  }

  if (!clientId || !clientSecret) {
    console.warn('[Discord Auth] VITE_DISCORD_CLIENT_ID or DISCORD_CLIENT_SECRET not set in environment.');
    return res.status(500).json({
      error: 'Discord credentials not configured in server environment (.env)'
    });
  }

  try {
    const params = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'authorization_code',
      code
    });

    const response = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString()
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[Discord Auth] Discord token exchange failed:', errorText);
      return res.status(response.status).send(errorText);
    }

    const data = (await response.json()) as { access_token: string };
    return res.json({ access_token: data.access_token });
  } catch (err) {
    console.error('[Discord Auth] Error exchanging token:', err);
    return res.status(500).json({ error: 'Internal token exchange failure' });
  }
}
