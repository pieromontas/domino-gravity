import { describe, expect, it } from 'vitest';
import { formatTableLabel, isTableId, parseTableId, TABLE_IDS } from './tableId.js';

describe('tableId helpers', () => {
  it('accepts only the registered maps and defaults to classic', () => {
    expect(TABLE_IDS).toEqual(['classic', 'dominican']);
    expect(isTableId('classic')).toBe(true);
    expect(isTableId('dominican')).toBe(true);
    expect(isTableId('oval')).toBe(false);
    expect(parseTableId(undefined)).toBe('classic');
    expect(parseTableId('dominican')).toBe('dominican');
    expect(formatTableLabel('dominican')).toBe('República Dominicana');
  });
});
