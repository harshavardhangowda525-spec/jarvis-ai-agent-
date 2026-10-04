/**
 * Gate attempt policy — pure, so it's unit-tested.
 *
 * Every failed unlock (face not recognized, wrong PIN, wrong password) counts.
 * After MAX_FAILURES in a row the gate locks for a while, and each lockout in a
 * row doubles the wait (1 min, 2, 4 … up to 30 min). A successful unlock
 * clears the count. While locked, nothing unlocks — face, PIN or password.
 */

export const MAX_FAILURES = 5;
const BASE_LOCK_MS = 60_000;
const MAX_LOCK_MS = 30 * 60_000;

export interface AttemptState { failedCount: number; lockouts: number; lockedUntil: Date | null }

export function lockedFor(s: AttemptState | null, now = new Date()): number {
  if (!s?.lockedUntil) return 0;
  return Math.max(0, s.lockedUntil.getTime() - now.getTime());
}

export function afterFailure(s: AttemptState | null, now = new Date()): AttemptState & { justLocked: boolean } {
  const cur = s ?? { failedCount: 0, lockouts: 0, lockedUntil: null };
  const failedCount = cur.failedCount + 1;
  if (failedCount >= MAX_FAILURES) {
    const ms = Math.min(MAX_LOCK_MS, BASE_LOCK_MS * 2 ** cur.lockouts);
    return { failedCount: 0, lockouts: cur.lockouts + 1, lockedUntil: new Date(now.getTime() + ms), justLocked: true };
  }
  return { failedCount, lockouts: cur.lockouts, lockedUntil: cur.lockedUntil, justLocked: false };
}

export const afterSuccess = (): AttemptState => ({ failedCount: 0, lockouts: 0, lockedUntil: null });

/** A PIN is 6–12 digits, and not something trivially guessable. */
export function pinProblem(pin: string): string | null {
  if (!/^\d{6,12}$/.test(pin)) return "Use 6 to 12 digits.";
  if (/^(\d)\1+$/.test(pin)) return "Don't use the same digit over and over.";
  const asc = "01234567890123", desc = "98765432109876";
  if (asc.includes(pin) || desc.includes(pin)) return "Don't use a simple sequence.";
  return null;
}

export const attemptsLeft = (s: AttemptState | null) => MAX_FAILURES - (s?.failedCount ?? 0);
