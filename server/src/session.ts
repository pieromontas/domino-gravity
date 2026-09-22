import { randomBytes, randomUUID } from 'crypto';
import { discordAvatarUrl, displayNameFromDiscord } from './identity.js';

export type SessionSource = 'discord' | 'dev';

export interface PlayerSession {
  token: string;
  userId: string;
  username: string;
  globalName: string;
  avatarUrl: string;
  source: SessionSource;
  createdAt: number;
  expiresAt: number;
}

export interface PublicSessionUser {
  id: string;
  username: string;
  globalName: string;
  avatarUrl: string;
}

const DEFAULT_TTL_MS = 12 * 60 * 60 * 1000;

export class SessionStore {
  private sessions = new Map<string, PlayerSession>();

  constructor(private readonly ttlMs: number = DEFAULT_TTL_MS) {}

  public createFromDiscordUser(user: {
    id: string;
    username?: string;
    global_name?: string | null;
    avatar?: string | null;
    discriminator?: string;
  }): PlayerSession {
    const globalName = displayNameFromDiscord(user);
    return this.insert({
      userId: user.id,
      username: user.username || globalName,
      globalName,
      avatarUrl: discordAvatarUrl(user.id, user.avatar, user.discriminator),
      source: 'discord'
    });
  }

  public createDevSession(opts?: { displayName?: string; userId?: string }): PlayerSession {
    const name = (opts?.displayName || 'You').trim() || 'You';
    const userId = opts?.userId?.trim() || `dev:${randomUUID()}`;
    return this.insert({
      userId,
      username: name,
      globalName: name,
      avatarUrl: discordAvatarUrl(userId.replace(/\D/g, '') || '0', null, '0'),
      source: 'dev'
    });
  }

  public get(token: string | null | undefined): PlayerSession | undefined {
    if (!token) return undefined;
    const session = this.sessions.get(token);
    if (!session) return undefined;
    if (session.expiresAt <= Date.now()) {
      this.sessions.delete(token);
      return undefined;
    }
    return session;
  }

  public toPublic(session: PlayerSession): PublicSessionUser {
    return {
      id: session.userId,
      username: session.username,
      globalName: session.globalName,
      avatarUrl: session.avatarUrl
    };
  }

  public size(): number {
    return this.sessions.size;
  }

  private insert(partial: Omit<PlayerSession, 'token' | 'createdAt' | 'expiresAt'>): PlayerSession {
    const token = randomBytes(32).toString('hex');
    const now = Date.now();
    const session: PlayerSession = {
      ...partial,
      token,
      createdAt: now,
      expiresAt: now + this.ttlMs
    };
    this.sessions.set(token, session);
    return session;
  }
}
