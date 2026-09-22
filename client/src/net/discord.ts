import { DiscordSDK, Events } from '@discord/embedded-app-sdk';
import { deriveActivityRoomKey } from './roomKey.ts';

export interface DiscordUser {
  id: string;
  username: string;
  globalName: string;
  avatarUrl: string;
}

export interface ActivityParticipantView {
  id: string;
  name: string;
  avatar: string;
}

const DEFAULT_AVATAR = 'https://cdn.discordapp.com/embed/avatars/0.png';

function standaloneUser(): DiscordUser {
  return {
    id: 'local-you',
    username: 'You',
    globalName: 'You',
    avatarUrl: DEFAULT_AVATAR
  };
}

function avatarUrl(userId: string, avatar?: string | null, discriminator?: string): string {
  if (avatar) {
    return `https://cdn.discordapp.com/avatars/${userId}/${avatar}.png?size=128`;
  }
  if (discriminator && discriminator !== '0') {
    return `https://cdn.discordapp.com/embed/avatars/${Number(discriminator) % 5}.png`;
  }
  try {
    const idx = Number((BigInt(userId) >> 22n) % 6n);
    return `https://cdn.discordapp.com/embed/avatars/${idx}.png`;
  } catch {
    return DEFAULT_AVATAR;
  }
}

function fromDiscordUser(user: {
  id: string;
  username?: string;
  global_name?: string | null;
  avatar?: string | null;
  discriminator?: string;
}): DiscordUser {
  const globalName = user.global_name?.trim()
    || user.username
    || 'Discord Player';
  return {
    id: user.id,
    username: user.username || globalName,
    globalName,
    avatarUrl: avatarUrl(user.id, user.avatar, user.discriminator)
  };
}

function apiPath(path: string, useProxy: boolean): string {
  return useProxy ? `/.proxy${path}` : path;
}

export class DiscordIntegration {
  public sdk: DiscordSDK | null = null;
  public isDiscordActivity: boolean = false;
  public user: DiscordUser;
  public sessionToken: string | null = null;
  public roomKey: string | null = null;
  public isBrowserMultiplayer: boolean = false;

  private participantListeners: Array<(list: ActivityParticipantView[]) => void> = [];
  private subscribedParticipants = false;

  constructor() {
    this.user = standaloneUser();
  }

  public async init(): Promise<void> {
    // Build-time Vite env (client/.env.production or VITE_DISCORD_CLIENT_ID).
    // Azure App Settings are runtime-only and do not populate this value.
    const clientId = import.meta.env.VITE_DISCORD_CLIENT_ID;
    const inIframe = window.self !== window.top;
    const urlParams = new URLSearchParams(window.location.search);
    const hasDiscordParams = urlParams.has('frame_id') || urlParams.has('instance_id');

    if (clientId && (inIframe || hasDiscordParams)) {
      try {
        console.log('[Discord SDK] Initializing Discord Embedded App SDK...');
        this.sdk = new DiscordSDK(clientId);
        await this.sdk.ready();
        this.isDiscordActivity = true;
        this.roomKey = deriveActivityRoomKey({
          instanceId: this.sdk.instanceId,
          channelId: this.sdk.channelId,
          guildId: this.sdk.guildId
        });

        const { code } = await this.sdk.commands.authorize({
          client_id: clientId,
          response_type: 'code',
          state: '',
          prompt: 'none',
          scope: ['identify', 'guilds']
        });

        const response = await fetch(apiPath('/api/token', true), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code })
        });

        if (!response.ok) {
          throw new Error(`Token exchange failed: ${response.status}`);
        }

        const payload = await response.json() as {
          access_token: string;
          sessionToken: string;
          user: DiscordUser;
        };

        const auth = await this.sdk.commands.authenticate({
          access_token: payload.access_token
        });

        this.sessionToken = payload.sessionToken;
        this.user = payload.user?.id
          ? payload.user
          : fromDiscordUser(auth.user);

        await this.subscribeParticipants();
        console.log('[Discord SDK] Authenticated as:', this.user.globalName, 'room', this.roomKey);
        return;
      } catch (err) {
        console.warn('[Discord SDK] Discord Activity init failed, staying standalone:', err);
        this.sdk = null;
        this.isDiscordActivity = false;
        this.sessionToken = null;
        this.roomKey = null;
        this.user = standaloneUser();
      }
    }

    await this.maybeInitBrowserMultiplayer(urlParams);
    if (!this.isBrowserMultiplayer) {
      console.log('[Discord SDK] Standalone Mode: local identity is You.');
    }
  }

  public canConnectMultiplayer(): boolean {
    return !!this.sessionToken && !!this.roomKey;
  }

  public useDiscordProxy(): boolean {
    return this.isDiscordActivity;
  }

  public onParticipantsChanged(listener: (list: ActivityParticipantView[]) => void) {
    this.participantListeners.push(listener);
  }

  public async refreshParticipants(): Promise<ActivityParticipantView[]> {
    if (!this.sdk) return [];
    const result = await this.sdk.commands.getInstanceConnectedParticipants();
    const list = this.normalizeParticipants(result.participants || []);
    this.emitParticipants(list);
    return list;
  }

  public getChannelId(): string {
    return this.sdk?.channelId || '';
  }

  public getInstanceId(): string {
    return this.sdk?.instanceId || '';
  }

  public getGuildId(): string {
    return this.sdk?.guildId || '';
  }

  public getRoomKey(): string {
    if (this.roomKey) return this.roomKey;
    if (this.sdk) {
      const key = deriveActivityRoomKey({
        instanceId: this.sdk.instanceId,
        channelId: this.sdk.channelId,
        guildId: this.sdk.guildId
      });
      if (key) return key;
    }
    throw new Error('No Activity room key available');
  }

  private async maybeInitBrowserMultiplayer(urlParams: URLSearchParams): Promise<void> {
    const wantMp = urlParams.get('mp') === '1' || urlParams.has('room');
    if (!wantMp) return;

    const room = urlParams.get('room')?.trim();
    if (!room || room.toLowerCase() === 'default-room') {
      console.warn('[Multiplayer] Explicit ?room= is required for browser multiplayer.');
      return;
    }

    try {
      const displayName = urlParams.get('name')?.trim() || 'You';
      const response = await fetch('/api/dev-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName })
      });
      if (!response.ok) {
        throw new Error(`dev-session failed: ${response.status}`);
      }
      const payload = await response.json() as { sessionToken: string; user: DiscordUser };
      this.sessionToken = payload.sessionToken;
      this.user = payload.user;
      this.roomKey = room.startsWith('browser:') ? room : `browser:${room}`;
      this.isBrowserMultiplayer = true;
      console.log('[Multiplayer] Browser session as', this.user.globalName, 'room', this.roomKey);
    } catch (err) {
      console.warn('[Multiplayer] Could not create a local session:', err);
    }
  }

  private async subscribeParticipants(): Promise<void> {
    if (!this.sdk || this.subscribedParticipants) return;

    const handleUpdate = (payload: { participants?: Array<Record<string, unknown>> }) => {
      this.emitParticipants(this.normalizeParticipants(payload.participants || []));
    };

    // Official SDK event: Events.ACTIVITY_INSTANCE_PARTICIPANTS_UPDATE
    // https://docs.discord.com/developers/activities/development-guides/multiplayer-experience
    await this.sdk.subscribe(Events.ACTIVITY_INSTANCE_PARTICIPANTS_UPDATE, handleUpdate);
    this.subscribedParticipants = true;
    await this.refreshParticipants();
  }

  private normalizeParticipants(raw: Array<Record<string, unknown>>): ActivityParticipantView[] {
    const seen = new Set<string>();
    const list: ActivityParticipantView[] = [];
    for (const row of raw) {
      const id = String(row.id || '');
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const username = String(row.username || '');
      const globalName = String(row.global_name || row.globalName || username || 'Discord Player');
      list.push({
        id,
        name: globalName,
        avatar: avatarUrl(id, (row.avatar as string | null) ?? null, row.discriminator as string | undefined)
      });
    }
    return list;
  }

  private emitParticipants(list: ActivityParticipantView[]) {
    for (const listener of this.participantListeners) listener(list);
  }
}

export const discordIntegration = new DiscordIntegration();
