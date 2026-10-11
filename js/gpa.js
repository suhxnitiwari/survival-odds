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
    // A pass in a pass/fail class doesn't count; a fail comes in as letter F.
    if (r.dropped || r.pass || p === null || h <= 0) continue;
    hours += h;
    points += p * h;
  }
  return { gpa: hours ? points / hours : null, hours, points };
}

/**
 * The GPA you had, after changes to past classes. Each change is
 * { hours, letter, change, newLetter }:
 *   'pass'    the old grade turns into a P, so it comes out of the GPA
 *   'replace' retaking it and the new grade replaces the old one
 *   'both'    retaking it and both grades count
 * newLetter is null when the retake is one of this semester's classes,
 * which already counts there.
 */
export function adjustedPrior(prior, changes = [], opts = {}) {
  let hours = Number(prior?.hours) || 0;
  const gpa = Number(prior?.gpa);
  if (!hours || !Number.isFinite(gpa)) return null;
  let points = gpa * hours;
  for (const c of changes) {
    const h = Number(c.hours) || 0;
    const old = pointsFor(c.letter, opts);
    const neu = pointsFor(c.newLetter, opts);
    if (!h || old === null) continue;
    if (c.change === 'pass' || c.change === 'replace') {
      hours -= h;
      points -= old * h;
    }
    if ((c.change === 'replace' || c.change === 'both') && neu !== null) {
      hours += h;
      points += neu * h;
    }
  }
  return { gpa: hours > 0 ? points / hours : null, hours: Math.max(0, hours), points };
}

/** This semester folded into the GPA you already have. */
export function cumulativeGpa(semester, prior) {
  const priorHours = Number(prior?.hours) || 0;
  const priorPoints = prior?.points ?? Number(prior?.gpa) * priorHours;
  if (!priorHours || !Number.isFinite(priorPoints)) return semester.gpa;
  const hours = priorHours + semester.hours;
  return hours ? (priorPoints + semester.points) / hours : null;
}

/** Pass/fail: does `letter` clear `passAt` on this scale (letters best first)? */
export function passes(letter, passAt, letters) {
  const i = letters.indexOf(letter);
  const j = letters.indexOf(passAt);
  return i >= 0 && j >= 0 && i <= j;
}

export function formatGpa(g) {
  return g === null || g === undefined ? '—' : (Math.round(g * 100) / 100).toFixed(2);
}

/** Transcript grades that stay out of the GPA: they keep the class on your record, with no points. */
export const NO_GPA = { P: 'P · pass', W: 'W · dropped', R: 'Retaken · replaced' };

/** GPA over transcript rows ({ hours, letter }); P, W and retaken rows don't count. */
export function transcriptGpa(rows, opts = {}) {
  return semesterGpa(rows, opts);
}

/** Two pieces of GPA (hours + points) added together. Either can be null. */
export function combineGpa(a, b) {
  const hours = (a?.hours ?? 0) + (b?.hours ?? 0);
  const points = (a?.points ?? 0) + (b?.points ?? 0);
  return hours ? { gpa: points / hours, hours, points } : null;
}
