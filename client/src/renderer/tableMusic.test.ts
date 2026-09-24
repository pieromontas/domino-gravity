import { describe, expect, it } from 'vitest';
import { CROSSFADE_SECONDS, fadeLeadIn, nextTrackIndex, PATIO_TRACKS } from './tableMusic.ts';

describe('patio playlist helpers', () => {
  it('lists both Pixabay tracks as public /audio URLs', () => {
    expect(PATIO_TRACKS).toHaveLength(2);
    expect(PATIO_TRACKS[0].url).toBe('/audio/bachata-street.mp3');
    expect(PATIO_TRACKS[1].url).toBe('/audio/bajo-la-luna-bailando.mp3');
  });

  it('alternates A ↔ B forever', () => {
    expect(nextTrackIndex(0)).toBe(1);
    expect(nextTrackIndex(1)).toBe(0);
    expect(nextTrackIndex(3, 2)).toBe(0);
  });

  it('starts the crossfade a few seconds before the end', () => {
    expect(fadeLeadIn(177)).toBe(CROSSFADE_SECONDS);
    expect(fadeLeadIn(200)).toBe(CROSSFADE_SECONDS);
    expect(fadeLeadIn(4)).toBe(2);
    expect(fadeLeadIn(0)).toBe(0);
  });
});
