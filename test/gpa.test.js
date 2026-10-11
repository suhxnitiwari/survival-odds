import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cumulativeGpa, formatGpa, pointsFor, semesterGpa } from '../js/gpa.js';

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
