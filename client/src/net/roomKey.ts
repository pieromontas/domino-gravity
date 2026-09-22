/**
 * Stable room identity for a Discord Activity launch.
 * Must stay aligned with server/src/roomKey.ts.
 *
 * @see https://docs.discord.com/developers/activities/development-guides/multiplayer-experience
 */
export function deriveActivityRoomKey(ctx: {
  instanceId?: string | null;
  channelId?: string | null;
  guildId?: string | null;
}): string | null {
  const instanceId = ctx.instanceId?.trim();
  if (!instanceId) return null;
  const guild = ctx.guildId?.trim() || 'noguild';
  const channel = ctx.channelId?.trim() || 'nochannel';
  return `discord:${guild}:${channel}:${instanceId}`;
}

export function isForbiddenGlobalRoom(roomId: string | null | undefined): boolean {
  if (!roomId) return true;
  const id = roomId.trim().toLowerCase();
  return id === '' || id === 'default-room' || id === 'default';
}
