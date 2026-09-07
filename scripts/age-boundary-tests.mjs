#!/usr/bin/env node
/**
 * Age-gate boundary tests — strict ≥ 18 rule measured at the LAST BIRTHDAY.
 * These exact cases must pass before shipping (mirrors server/src/auth/age-gate.ts).
 *
 * Run: node scripts/age-boundary-tests.mjs
 */

function isLeapYear(y) { return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0; }

function ageAtLastBirthday(dob, today) {
  const y = today.getUTCFullYear();
  let day = dob.getUTCDate();
  if (dob.getUTCMonth() === 1 && day === 29 && !isLeapYear(y)) day = 28; // Feb-29 → Feb-28
  const thisYear = new Date(Date.UTC(y, dob.getUTCMonth(), day));
  const last = thisYear <= today ? thisYear : new Date(Date.UTC(y - 1, dob.getUTCMonth(), day));
  return last.getUTCFullYear() - dob.getUTCFullYear();
}

function verify(dob, minAge = 18, today = new Date()) {
  if (dob > today) return { ok: false, reason: 'future_dob' };
  if (dob < new Date(Date.UTC(1900, 0, 1))) return { ok: false, reason: 'out_of_range' };
  if (ageAtLastBirthday(dob, today) < minAge) return { ok: false, reason: 'too_young' };
  return { ok: true };
}

const cases = [
  { name: 'born 2008-09-08 / today 2026-09-07 → last birthday 2025 → age 17 → REJECT', dob: '2008-09-08', today: '2026-09-07', expect: false },
  { name: 'born 2008-09-06 / today 2026-09-07 → 18th birthday passed → ACCEPT',       dob: '2008-09-06', today: '2026-09-07', expect: true },
  { name: 'born 2008-09-07 / today 2026-09-07 → TODAY is the 18th birthday → ACCEPT', dob: '2008-09-07', today: '2026-09-07', expect: true },
  { name: 'born 2009-12-30 / today 2026-01-05 → last birthday 2025-12-30 → age 16 → REJECT', dob: '2009-12-30', today: '2026-01-05', expect: false },
  { name: 'born 1995-01-15 / today 2026-09-07 → adult → ACCEPT',                       dob: '1995-01-15', today: '2026-09-07', expect: true },
  { name: 'born 2008-02-29 (leap) / today 2026-03-01 (non-leap) → 18th on Feb 28 → ACCEPT', dob: '2008-02-29', today: '2026-03-01', expect: true },
  { name: 'future DOB 2030-01-01 → REJECT',                                            dob: '2030-01-01', today: '2026-09-07', expect: false },
  { name: 'born 1900-01-01 / today 2026-09-07 → 126 → ACCEPT (boundary)',              dob: '1900-01-01', today: '2026-09-07', expect: true },
];

let pass = 0;
for (const c of cases) {
  const res = verify(new Date(c.dob), 18, new Date(c.today));
  const ok = res.ok === c.expect;
  if (ok) pass++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${c.name}  → got ${res.ok ? 'ACCEPT' : `REJECT (${res.reason})`}`);
}
console.log(`\n${pass}/${cases.length} age-gate boundary tests passed`);
process.exit(pass === cases.length ? 0 : 1);
