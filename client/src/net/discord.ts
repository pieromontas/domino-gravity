import { DiscordSDK } from '@discord/embedded-app-sdk';

export interface DiscordUser {
  id: string;
  username: string;
  globalName: string;
  avatarUrl: string;
}

export class DiscordIntegration {
  public sdk: DiscordSDK | null = null;
  public isDiscordActivity: boolean = false;
  public user: DiscordUser;

  constructor() {
    // Default mock user for local development and standalone browser play
    this.user = {
      id: 'local-user-' + Math.floor(Math.random() * 10000),
      username: 'Piero',
      globalName: 'Piero',
      avatarUrl: 'https://cdn.discordapp.com/embed/avatars/0.png'
    };
  }

  public async init(): Promise<void> {
    const clientId = import.meta.env.VITE_DISCORD_CLIENT_ID;

    // Check if running inside Discord Activity iframe
    const inIframe = window.self !== window.top;
    const urlParams = new URLSearchParams(window.location.search);
    const hasDiscordParams = urlParams.has('frame_id') || urlParams.has('instance_id');

    if (clientId && (inIframe || hasDiscordParams)) {
      try {
        console.log('[Discord SDK] Initializing Discord Embedded App SDK...');
        this.sdk = new DiscordSDK(clientId);
        await this.sdk.ready();
        this.isDiscordActivity = true;

        // Authorize with Discord
        const { code } = await this.sdk.commands.authorize({
          client_id: clientId,
          response_type: 'code',
          state: '',
          prompt: 'none',
          scope: ['identify', 'guilds']
        });

        // Exchange code with backend server for access token
        const response = await fetch('/api/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code })
        });

        if (response.ok) {
          const { access_token } = await response.json();
          await this.sdk.commands.authenticate({ access_token });

          // Fetch authenticated user info
          const discordUser = await fetch('https://discord.com/api/v10/users/@me', {
            headers: { Authorization: `Bearer ${access_token}` }
          }).then(res => res.json());

          if (discordUser && discordUser.id) {
            const avatarUrl = discordUser.avatar
              ? `https://cdn.discordapp.com/avatars/${discordUser.id}/${discordUser.avatar}.png`
              : `https://cdn.discordapp.com/embed/avatars/${Number(discordUser.discriminator || 0) % 5}.png`;

            this.user = {
              id: discordUser.id,
              username: discordUser.username,
              globalName: discordUser.global_name || discordUser.username,
              avatarUrl
            };
            console.log('[Discord SDK] Authenticated as:', this.user.globalName);
          }
        }
      } catch (err) {
        console.warn('[Discord SDK] Running in standalone/fallback mode:', err);
        this.isDiscordActivity = false;
      }
    } else {
      console.log('[Discord SDK] Standalone Mode: running in standard browser.');
      this.isDiscordActivity = false;
    }
  }

  public getChannelId(): string {
    return this.sdk?.channelId || 'default-channel';
  }

  public getInstanceId(): string {
    return this.sdk?.instanceId || 'local-table';
  }
}

export const discordIntegration = new DiscordIntegration();
