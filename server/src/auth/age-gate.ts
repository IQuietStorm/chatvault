/**
 * Strict ≥18 rule — age measured at the user's MOST RECENT birthday
 * (month/day compare), never naive year subtraction.
 *
 *   born 2008-09-08, today 2026-09-07 → last birthday 2025-09-08 → 17 → REJECT
 *   born 2008-09-06, today 2026-09-07 → last birthday 2026-09-06 → 18 → ACCEPT
 *   born 2008-09-07, today 2026-09-07 → today IS the 18th birthday     → ACCEPT
 */
export function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

export function ageAtLastBirthday(dob: Date, today: Date): number {
  const y = today.getUTCFullYear();
  let day = dob.getUTCDate();
  // Feb-29 birthdays are honored on Feb-28 of non-leap years.
  if (dob.getUTCMonth() === 1 && day === 29 && !isLeapYear(y)) day = 28;
  const thisYear = new Date(Date.UTC(y, dob.getUTCMonth(), day));
  const last = thisYear <= today ? thisYear : new Date(Date.UTC(y - 1, dob.getUTCMonth(), day));
  return last.getUTCFullYear() - dob.getUTCFullYear();
}

export function verifyAge(
  dob: Date,
  minAge = 18,
  today = new Date(),
): { ok: boolean; reason?: string } {
  if (dob > today) return { ok: false, reason: 'date_of_birth cannot be in the future' };
  if (dob < new Date(Date.UTC(1900, 0, 1)))
    return { ok: false, reason: 'date_of_birth out of accepted range' };
  if (ageAtLastBirthday(dob, today) < minAge)
    return {
      ok: false,
      reason: `You must be at least ${minAge} years old (based on your last birthday) to use ChatVault`,
    };
  return { ok: true };
}

export const MIN_AGE = 18;
