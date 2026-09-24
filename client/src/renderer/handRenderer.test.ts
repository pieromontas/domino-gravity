import { describe, it, expect } from 'vitest';
import { LOCAL_HAND_FACE_TILT, localHandSlot } from './handRenderer.ts';

describe('Local hand faces the seated player', () => {
  it('tilts the pip face toward +Z (camera / local seat), not the table center', () => {
    expect(LOCAL_HAND_FACE_TILT).toBeGreaterThan(0);
    const center = localHandSlot(3, 7);
    expect(center.rotX).toBeCloseTo(LOCAL_HAND_FACE_TILT);
    expect(center.rotX).toBeGreaterThan(Math.PI / 4);
    expect(center.y).toBeGreaterThan(0.5);
    expect(center.z).toBeGreaterThan(3.4);

    const inspect = localHandSlot(3, 7, 'inspect');
    expect(inspect.z).toBeGreaterThan(center.z);
    expect(inspect.y).toBeGreaterThan(center.y);
    expect(inspect.rotY).toBe(0);
  });

  it('fans left and right tiles while keeping the same face-toward-player tilt', () => {
    const left = localHandSlot(0, 7);
    const right = localHandSlot(6, 7);
    expect(left.x).toBeLessThan(0);
    expect(right.x).toBeGreaterThan(0);
    expect(left.rotX).toBe(right.rotX);
    expect(left.rotX).toBe(LOCAL_HAND_FACE_TILT);
  });
});
