import { TableId } from './types.ts';

export const TABLE_IDS: readonly TableId[] = ['classic', 'dominican'];
export const DEFAULT_TABLE_ID: TableId = 'classic';

export function isTableId(value: unknown): value is TableId {
  return value === 'classic' || value === 'dominican';
}

export function parseTableId(value: unknown, fallback: TableId = DEFAULT_TABLE_ID): TableId {
  return isTableId(value) ? value : fallback;
}

export function formatTableLabel(tableId: TableId | undefined): string {
  return parseTableId(tableId) === 'dominican' ? 'República Dominicana' : 'Classic';
}
