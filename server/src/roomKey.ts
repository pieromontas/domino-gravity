/**
 * Stable room identity for a Discord Activity launch.
 *
 * Discord's `instanceId` is unique per Activity launch and is shared by
 * everyone who joins that same instance. Channel + guild are mixed in so a
 * key is scoped to the place the Activity was started, and so two launches
 * never collapse onto a global fallback like `default-room`.
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

export function assertExplicitRoomId(roomId: string | null | undefined): string {
  if (isForbiddenGlobalRoom(roomId)) {
    throw new Error('An explicit room id is required; default-room is not allowed');
  }
  return roomId!.trim();
}
