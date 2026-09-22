import { Request, Response } from 'express';
import { SessionStore } from './session.js';

interface DiscordTokenResponse {
  access_token: string;
  token_type?: string;
  expires_in?: number;
  scope?: string;
}

interface DiscordUser {
  id: string;
  username?: string;
  global_name?: string | null;
  avatar?: string | null;
  discriminator?: string;
}

export function createTokenHandler(sessions: SessionStore) {
  return async function handleDiscordTokenExchange(req: Request, res: Response) {
    const { code } = req.body as { code?: string };
    const clientId = process.env.VITE_DISCORD_CLIENT_ID;
    const clientSecret = process.env.DISCORD_CLIENT_SECRET;

    if (!code) {
      return res.status(400).json({ error: 'Missing code in request body' });
    }

    if (!clientId || !clientSecret) {
      console.warn('[Discord Auth] VITE_DISCORD_CLIENT_ID or DISCORD_CLIENT_SECRET not set.');
      return res.status(500).json({
        error: 'Discord credentials not configured in server environment'
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

      const data = (await response.json()) as DiscordTokenResponse;
      const meRes = await fetch('https://discord.com/api/v10/users/@me', {
        headers: { Authorization: `Bearer ${data.access_token}` }
      });

      if (!meRes.ok) {
        const errorText = await meRes.text();
        console.error('[Discord Auth] users/@me failed:', errorText);
        return res.status(502).json({ error: 'Failed to verify Discord user' });
      }

      const discordUser = (await meRes.json()) as DiscordUser;
      if (!discordUser?.id) {
        return res.status(502).json({ error: 'Discord user payload missing id' });
      }

      const session = sessions.createFromDiscordUser(discordUser);

      // access_token is required by DiscordSDK.commands.authenticate().
      // DISCORD_CLIENT_SECRET never leaves this process.
      return res.json({
        access_token: data.access_token,
        sessionToken: session.token,
        user: sessions.toPublic(session)
      });
    } catch (err) {
      console.error('[Discord Auth] Error exchanging token:', err);
      return res.status(500).json({ error: 'Internal token exchange failure' });
    }
  };
}

export function createDevSessionHandler(sessions: SessionStore, allowDev: () => boolean) {
  return function handleDevSession(req: Request, res: Response) {
    if (!allowDev()) {
      return res.status(403).json({ error: 'Dev sessions are disabled in production' });
    }
    const { displayName, userId } = (req.body || {}) as { displayName?: string; userId?: string };
    const session = sessions.createDevSession({ displayName, userId });
    return res.json({
      sessionToken: session.token,
      user: sessions.toPublic(session)
    });
  };
}
