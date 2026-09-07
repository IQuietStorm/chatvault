/**
 * Client mirror of the server age gate (server/src/auth/age-gate.ts).
 * Strict ≥18 measured at the user's LAST BIRTHDAY (month/day compare).
 * Client check is UX sugar only — the server is authoritative.
 */

export function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

export function ageAtLastBirthday(dob: Date, now = new Date()): number {
  const y = now.getUTCFullYear();
  let day = dob.getUTCDate();
  if (dob.getUTCMonth() === 1 && day === 29 && !isLeapYear(y)) day = 28; // Feb-29 → Feb-28
  const thisYear = new Date(Date.UTC(y, dob.getUTCMonth(), day));
  const last = thisYear <= now ? thisYear : new Date(Date.UTC(y - 1, dob.getUTCMonth(), day));
  return last.getUTCFullYear() - dob.getUTCFullYear();
}

export function isAtLeast18(dobISO: string, now = new Date()): boolean {
  const dob = new Date(dobISO);
  return !Number.isNaN(dob.getTime()) && dob <= now && ageAtLastBirthday(dob, now) >= 18;
}
