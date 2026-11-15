/**
 * Vision vs API validation — pure scoring/reporting.
 *
 * The API value is always treated as the truth. This module only records
 * whether vision agreed, so it never returns or stores a corrected value.
 */

export interface FieldAccuracy {
  checks: number;
  agree: number;
  disagree: number;
  accuracy: number | null;
  lastDisagreement: { vision: number | string; api: number | string; gameTime: number } | null;
}

export interface VisionValidator {
  check(
    field: string,
    vision: number | string | null | undefined,
    api: number | string | null | undefined,
    gameTime: number,
    tolerance?: number,
  ): 'agree' | 'disagree' | 'skipped';
  report(): Record<string, FieldAccuracy>;
  resetMatch(): void;
}

interface FieldEntry {
  checks: number;
  agree: number;
  disagree: number;
  lastDisagreement: { vision: number | string; api: number | string; gameTime: number } | null;
}

function isPresent(value: number | string | null | undefined): value is number | string {
  return value !== null && value !== undefined && !(typeof value === 'number' && !Number.isFinite(value));
}

function formatGameTime(gameTime: number): string {
  const totalSeconds = Number.isFinite(gameTime) ? Math.max(0, Math.floor(gameTime)) : 0;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function accuracyFor(entry: FieldEntry): number | null {
  if (entry.checks === 0) return null;
  return Math.round((entry.agree / entry.checks) * 1000) / 1000;
}

export function createVisionValidator(log: (line: string) => void = () => {}): VisionValidator {
  let entries = new Map<string, FieldEntry>();
  let loggedFields = new Set<string>();

  return {
    check(field, vision, api, gameTime, tolerance = 0) {
      if (!isPresent(vision) || !isPresent(api)) {
        return 'skipped';
      }

      let agree: boolean;
      if (typeof vision === 'number' && typeof api === 'number') {
        agree = Math.abs(vision - api) <= tolerance;
      } else if (typeof vision === 'string' && typeof api === 'string') {
        agree = vision.trim().toLowerCase() === api.trim().toLowerCase();
      } else {
        agree = false;
      }

      let entry = entries.get(field);
      if (!entry) {
        entry = { checks: 0, agree: 0, disagree: 0, lastDisagreement: null };
        entries.set(field, entry);
      }

      entry.checks += 1;
      if (agree) {
        entry.agree += 1;
        return 'agree';
      }

      entry.disagree += 1;
      entry.lastDisagreement = { vision, api, gameTime };

      if (!loggedFields.has(field)) {
        loggedFields.add(field);
        log(
          `[vision] ${field} mismatch: vision=${vision} api=${api} at ${formatGameTime(gameTime)}`,
        );
      }

      return 'disagree';
    },

    report() {
      const result: Record<string, FieldAccuracy> = {};
      for (const [field, entry] of entries) {
        result[field] = {
          checks: entry.checks,
          agree: entry.agree,
          disagree: entry.disagree,
          accuracy: accuracyFor(entry),
          lastDisagreement: entry.lastDisagreement
            ? { ...entry.lastDisagreement }
            : null,
        };
      }
      return result;
    },

    resetMatch() {
      entries = new Map<string, FieldEntry>();
      loggedFields = new Set<string>();
    },
  };
}
