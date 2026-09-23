import { describe, expect, it } from 'vitest';
import { formatTableLabel, isTableId, parseTableId, TABLE_IDS } from './tableId.ts';

describe('tableId helpers', () => {
  it('accepts only the registered maps and defaults to classic', () => {
    expect(TABLE_IDS).toEqual(['classic', 'dominican']);
    expect(isTableId('classic')).toBe(true);
    expect(isTableId('dominican')).toBe(true);
    expect(isTableId('oval')).toBe(false);
    expect(parseTableId(undefined)).toBe('classic');
    expect(parseTableId('dominican')).toBe('dominican');
    expect(parseTableId('unknown')).toBe('classic');
  });

  it('labels maps for lobby copy', () => {
    expect(formatTableLabel('classic')).toBe('Classic');
    expect(formatTableLabel('dominican')).toBe('República Dominicana');
    expect(formatTableLabel(undefined)).toBe('Classic');
  });
});
