// GPA math. Letters become grade points on the usual 4.0 scale, weighted by
// credit hours. A+ is 4.0 at most schools and 4.33 at some, so it's a choice.

export const POINTS = {
  'A+': 4, A: 4, 'A-': 3.67, 'B+': 3.33, B: 3, 'B-': 2.67, 'C+': 2.33,
  C: 2, 'C-': 1.67, 'D+': 1.33, D: 1, 'D-': 0.67, F: 0,
};

export function pointsFor(letter, { aPlus = 4 } = {}) {
  if (!letter || !(letter in POINTS)) return null;
  return letter === 'A+' ? aPlus : POINTS[letter];
}

/**
 * rows: [{ hours, letter, dropped }]. Dropped classes and ones without a
 * letter yet don't count, same as a W on a transcript.
 */
export function semesterGpa(rows, opts = {}) {
  let hours = 0;
  let points = 0;
  for (const r of rows) {
    const p = pointsFor(r.letter, opts);
    const h = Number(r.hours) || 0;
    if (r.dropped || p === null || h <= 0) continue;
    hours += h;
    points += p * h;
  }
  return { gpa: hours ? points / hours : null, hours, points };
}

/** This semester folded into the GPA you already have. */
export function cumulativeGpa(semester, prior) {
  const priorHours = Number(prior?.hours) || 0;
  const priorGpa = Number(prior?.gpa);
  if (!priorHours || !Number.isFinite(priorGpa)) return semester.gpa;
  const hours = priorHours + semester.hours;
  return hours ? (priorGpa * priorHours + semester.points) / hours : null;
}

export function formatGpa(g) {
  return g === null || g === undefined ? '—' : (Math.round(g * 100) / 100).toFixed(2);
}
