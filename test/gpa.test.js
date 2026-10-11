import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NO_GPA, adjustedPrior, combineGpa, cumulativeGpa, formatGpa, passes, pointsFor, semesterGpa, transcriptGpa } from '../js/gpa.js';

const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≈ ${b}`);

test('semester GPA is weighted by hours, and dropped or ungraded classes do not count', () => {
  const rows = [
    { hours: 3, letter: 'A' },
    { hours: 4, letter: 'B' },
    { hours: 3, letter: 'D' },
    { hours: 3, letter: 'C', dropped: true },
    { hours: 3, letter: null },
  ];
  const s = semesterGpa(rows);
  assert.equal(s.hours, 10);
  close(s.gpa, (12 + 12 + 3) / 10);
  close(semesterGpa(rows.map((r) => (r.letter === 'D' ? { ...r, dropped: true } : r))).gpa, 24 / 7);
});

test('A+ is 4.0 unless the school counts it as 4.33', () => {
  assert.equal(pointsFor('A+'), 4);
  assert.equal(pointsFor('A+', { aPlus: 4.33 }), 4.33);
  assert.equal(pointsFor('A-'), 3.67);
  assert.equal(pointsFor('nope'), null);
});

test('overall GPA folds the semester into what you already have', () => {
  const sem = semesterGpa([{ hours: 12, letter: 'B' }]);
  close(cumulativeGpa(sem, { gpa: 3.5, hours: 36 }), (3.5 * 36 + 36) / 48);
  assert.equal(cumulativeGpa(sem, {}), 3);
  assert.equal(formatGpa(3.456), '3.46');
  assert.equal(formatGpa(null), '—');
});

test('pass/fail: a pass stays out of the GPA, a fail counts as an F', () => {
  assert.equal(passes('B', 'C-', ['A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D', 'F']), true);
  assert.equal(passes('D', 'C-', ['A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D', 'F']), false);
  close(semesterGpa([{ hours: 3, letter: 'A' }, { hours: 3, letter: 'B', pass: true }]).gpa, 4);
  close(semesterGpa([{ hours: 3, letter: 'A' }, { hours: 3, letter: 'F' }]).gpa, 2);
});

test('past classes: an F turning into a P, and retakes that replace or add', () => {
  const prior = { gpa: 3, hours: 30 }; // 90 points
  // F (3 hrs) becomes a P: 90 points over 27 hours.
  close(adjustedPrior(prior, [{ hours: 3, letter: 'F', change: 'pass' }]).gpa, 90 / 27);
  // Retake a C, the new A replaces it: 90 - 6 + 12 over 30.
  close(adjustedPrior(prior, [{ hours: 3, letter: 'C', change: 'replace', newLetter: 'A' }]).gpa, 96 / 30);
  // Both count: 90 + 12 over 33.
  close(adjustedPrior(prior, [{ hours: 3, letter: 'C', change: 'both', newLetter: 'A' }]).gpa, 102 / 33);
  // Retaking this semester (already counted there): only the old grade comes out.
  const p = adjustedPrior(prior, [{ hours: 3, letter: 'F', change: 'replace', newLetter: null }]);
  close(cumulativeGpa(semesterGpa([{ hours: 3, letter: 'B' }]), p), (90 + 9) / 30);
  assert.equal(adjustedPrior({}, []), null);
});

test('transcript: P, W and retaken rows stay off the GPA, and pieces add up', () => {
  const t = transcriptGpa([
    { hours: 3, letter: 'A' }, { hours: 3, letter: 'B' },
    { hours: 3, letter: 'P' }, { hours: 3, letter: 'W' }, { hours: 3, letter: 'R' },
  ]);
  assert.equal(t.hours, 6);
  close(t.gpa, 3.5);
  const both = combineGpa(t, { hours: 6, points: 18 });
  close(both.gpa, 39 / 12);
  assert.equal(combineGpa(null, null), null);
  assert.ok(Object.keys(NO_GPA).every((k) => pointsFor(k) === null));
});
