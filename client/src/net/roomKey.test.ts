import { describe, expect, it } from 'vitest';
import { deriveActivityRoomKey, isForbiddenGlobalRoom } from './roomKey.ts';
import { RoomClient } from './roomClient.ts';

describe('client room identity', () => {
  it('matches the server discord:guild:channel:instance scheme', () => {
    expect(deriveActivityRoomKey({
      instanceId: 'i-9',
      channelId: 'c-1',
      guildId: 'g-1'
    })).toBe('discord:g-1:c-1:i-9');
    expect(deriveActivityRoomKey({ instanceId: '  ' })).toBeNull();
    expect(isForbiddenGlobalRoom('default-room')).toBe(true);
  });

  it('uses a neutral You identity in standalone lobby, not a hardcoded host name', () => {
    const room = new RoomClient({ onStateUpdate: () => undefined });
    expect(room.getState().players[0].name).toBe('You');
    expect(room.getState().players[0].id).toBe('local-you');
    room.setLocalPlayer('You', 'https://cdn.discordapp.com/embed/avatars/0.png', 'local-you');
    expect(room.getState().players[0].name).toBe('You');
  });
});
