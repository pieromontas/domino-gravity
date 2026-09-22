import { AIDifficulty } from './types.ts';

export const AI_DIFFICULTIES: readonly AIDifficulty[] = ['easy', 'normal', 'hard'];

export function isAIDifficulty(value: unknown): value is AIDifficulty {
  return value === 'easy' || value === 'normal' || value === 'hard';
}

export function parseAIDifficulty(value: unknown, fallback: AIDifficulty = 'easy'): AIDifficulty {
  return isAIDifficulty(value) ? value : fallback;
}

export function cycleAIDifficulty(current: AIDifficulty | undefined): AIDifficulty {
  const idx = AI_DIFFICULTIES.indexOf(parseAIDifficulty(current));
  return AI_DIFFICULTIES[(idx + 1) % AI_DIFFICULTIES.length];
}

export function formatAIDifficultyLabel(current: AIDifficulty | undefined): string {
  return parseAIDifficulty(current).toUpperCase();
}
