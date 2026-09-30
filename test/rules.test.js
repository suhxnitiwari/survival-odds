import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findFullCredit, findRules, findScale, parseSyllabus } from '../js/parser.js';
import { toCourse } from '../js/importer.js';
import {
  describeRules, examAverage, finalTable, finishGrade, neededOnItem, summarize,
} from '../js/grades.js';

// Made-up fine print, phrased the ways real syllabi phrase it.

test('finds rounding, and respects "no rounding"', () => {
  assert.equal(findRules('NOTE: Decimals will be rounded up at 0.5% (e.g., 91.5% = 92%)').rules.roundAt, 0.5);
  assert.equal(findRules('A 89.5% becomes 90%.').rules.roundAt, 0.5);
  assert.equal(findRules('Final grades are rounded to the nearest whole number.').rules.roundAt, 0.5);
  const none = findRules('Grades will not be rounded. An 89.99 is a B+.');
  assert.equal(none.rules.roundAt, undefined);
  assert.match(none.sources.noRounding, /not be rounded/);
});

test('finds "the final replaces your lowest exam"', () => {
  const { rules, sources } = findRules('If it helps you, your final exam score will replace your lowest midterm.');
  assert.equal(rules.finalReplacesLowest, true);
  assert.match(sources.finalReplacesLowest, /replace your lowest midterm/);
  assert.equal(findRules('We replace the lowest exam score with the final.').rules.finalReplacesLowest, true);
});

test('finds exam minimums and extra credit caps', () => {
  assert.equal(findRules('You must earn an average of at least 60% on the exams to pass the course.').rules.passExams, 60);
  assert.equal(findRules('Extra credit is worth a 1% increase to your final grade.').rules.extraCreditMax, 1);
  assert.equal(findRules('You can earn up to 2 points of extra credit.').rules.extraCreditMax, 2);
});

test('finds "85% of the points counts as full credit"', () => {
  const [a] = findFullCredit("You're allowed to miss up to 15% of the points (i.e. you only need to get at least 85% of the daily participation points) to receive full credit for participation.");
  assert.equal(a.threshold, 85);
  assert.match(a.about, /participation/);
  const [b] = findFullCredit('You only need to earn 80% of the poll points to get full credit.');
  assert.equal(b.threshold, 80);
  assert.equal(findFullCredit('You only need 90% of the participation points to get full credit.')[0].threshold, 90);
});

test('full credit applies only to the category it names', () => {
  const text = 'Participation 10%\nQuizzes 20%\nHomework 30%\nExams 40%\nYou only need 85% of the participation points to get full credit.';
  let n = 0;
  const { course: c } = toCourse(parseSyllabus(text, { ref: '2026-08-26' }), { id: 'c', color: '#000', uid: () => `u${++n}`, text });
  assert.deepEqual(c.categories.map((k) => k.fullCreditAt ?? null), [85, null, null, null]);
  assert.equal(c.categories[0].source.fullCreditAt, 'You only need 85% of the participation points to get full credit.');
});

test('reads printed grading scales in both directions', () => {
  const forward = findScale(['A 93-100  A- 90-92', 'B+ 87-89  B 83-86  B- 80-82', 'C+ 77 – 79 F Below 60%']);
  assert.deepEqual(forward.scale.slice(0, 3), [['A', 93], ['A-', 90], ['B+', 87]]);
  assert.deepEqual(forward.scale.at(-1), ['F', 0]);
  const backward = findScale(['92.5-100% A', '89.5-92.4% A-', '86.5-89.4% B+', '82.5-86.4% B']);
  assert.deepEqual(backward.scale.slice(0, 2), [['A', 92.5], ['A-', 89.5]]);
  const simple = findScale(['A: 90+', 'B: 80+', 'C: 70+', 'D: 60+']);
  assert.deepEqual(simple.scale, [['A', 90], ['B', 80], ['C', 70], ['D', 60], ['F', 0]]);
  assert.equal(findScale(['Top 25% of class: A', 'Next 25%: A-']), null);
});

// 50% homework (graded, 90%), 50% final.
function course(extra = {}) {
  return {
    categories: [{ id: 'hw', name: 'Homework', weight: 50 }, { id: 'fin', name: 'Final', weight: 50 }],
    items: [
      { id: 'h', category: 'hw', kind: 'homework', possible: 100, earned: 90 },
      { id: 'f', category: 'fin', kind: 'exam', possible: 100, earned: null, date: '2026-12-10' },
    ],
    ...extra,
  };
}

test('rounding changes what you need', () => {
  // Without rounding, a 93 needs 96 on the final. Rounding at .5 means 92.5 is enough → 95.
  assert.ok(Math.abs(neededOnItem(course(), 'f', 93) - 96) < 1e-6);
  assert.ok(Math.abs(neededOnItem(course({ rules: { roundAt: 0.5 } }), 'f', 93) - 95) < 1e-6);
  assert.equal(finishGrade({ rules: { roundAt: 0.5 } }, 92.5), 93);
  assert.equal(finishGrade({ rules: { roundAt: 0.5 } }, 92.49), 92.49);
});

test('extra credit is added and capped', () => {
  const c = course({ rules: { extraCreditMax: 1 }, extraCredit: 3 });
  assert.equal(finishGrade(c, 90), 91);
  assert.ok(Math.abs(neededOnItem(c, 'f', 93) - 94) < 1e-6);
});

test('full credit at 85% of the points', () => {
  const c = course();
  c.categories[0].fullCreditAt = 85;
  c.items[0].earned = 85;
  assert.equal(summarize(c).current, 100);
  c.items[0].earned = 68; // 68 / 85 = 80%
  assert.ok(Math.abs(summarize(c).current - 80) < 1e-9);
});

test('the final replaces your lowest exam when it helps', () => {
  const c = {
    rules: { finalReplacesLowest: true },
    categories: [{ id: 'm', name: 'Midterms', weight: 50 }, { id: 'f', name: 'Final', weight: 50 }],
    items: [
      { id: 'm1', category: 'm', kind: 'exam', possible: 100, earned: 60, date: '2026-10-01' },
      { id: 'm2', category: 'm', kind: 'exam', possible: 100, earned: 90, date: '2026-11-01' },
      { id: 'fx', category: 'f', kind: 'exam', possible: 100, earned: null, date: '2026-12-10' },
    ],
  };
  // Without the rule: 0.25·60 + 0.25·90 + 0.5x = 90 → x = 105.
  // With it, x replaces the 60: 0.25x + 22.5 + 0.5x = 90 → x = 90.
  assert.ok(Math.abs(neededOnItem(c, 'fx', 90) - 90) < 1e-6);
  const table = finalTable(c);
  assert.ok(table.every((r, i) => i === 0 || r.needed <= table[i - 1].needed));
  c.items[2].earned = 50; // a lower final doesn't replace anything
  assert.ok(Math.abs(summarize(c).current - 62.5) < 1e-9);
  assert.ok(Math.abs(examAverage(c) - (60 + 90 + 50) / 3) < 1e-9);
});

test('the whole fine print flows from syllabus to class', () => {
  const text = `
ABC 123 Intro to Everything
Class: MW 10:00 - 11:15 AM
Participation 10%
Quizzes 20%
Midterm 30%
Final Exam 40%
You only need to get at least 90% of the participation points to receive full credit for participation.
We'll drop your lowest quiz. Decimals will be rounded up at 0.5%.
Your final exam score will replace your lowest midterm if it is higher.
A 92-100  A- 89-91  B+ 86-88  B 82-85  B- 79-81
Midterm: Oct 14
Final Exam: Dec 9 at 9:00am
`;
  let n = 0;
  const { course: c, warnings } = toCourse(parseSyllabus(text, { ref: '2026-08-26' }), { id: 'c', color: '#000', uid: () => `u${++n}`, text });
  assert.deepEqual(warnings, []);
  assert.equal(c.rules.roundAt, 0.5);
  assert.equal(c.rules.finalReplacesLowest, true);
  assert.equal(c.categories.find((k) => k.name === 'Participation').fullCreditAt, 90);
  assert.equal(c.categories.find((k) => k.name === 'Quizzes').dropLowest, 1);
  assert.deepEqual(c.scale[0], ['A', 92]);
  assert.match(c.categories[0].source.weight, /Participation 10%/);
  assert.match(c.items.find((i) => i.name === 'Midterm').source, /Midterm: Oct 14/);
  const rules = describeRules(c).map((r) => r.text).join(' | ');
  assert.match(rules, /Rounds up at \.5/);
  assert.match(rules, /replaces your lowest exam/);
  assert.match(rules, /90% of the points counts as full credit/);
  assert.match(rules, /an A starts at 92/);
  assert.ok(describeRules(c).every((r) => r.source));
});

test("an AI reader's quotes are checked against the syllabus", async () => {
  const { fromGemini } = await import('../js/ai.js');
  const text = 'ABC 123\nHomework 40%\nExams 60%\nDecimals will be rounded up at 0.5%.';
  const found = fromGemini({
    code: 'ABC 123',
    categories: [
      { name: 'Homework', weight: 40, kind: 'homework', quote: 'Homework 40%' },
      { name: 'Exams', weight: 60, kind: 'exam', quote: 'Exams are worth sixty percent' },
    ],
    rules: {
      roundAt: 0.5, roundAtQuote: 'Decimals will be rounded up at 0.5%.',
      finalReplacesLowest: true, finalReplacesLowestQuote: 'The final replaces your lowest exam.',
    },
    scale: [{ letter: 'A', min: 90 }, { letter: 'B', min: 80 }, { letter: 'C', min: 70 }],
  });
  let n = 0;
  const { course: c, warnings } = toCourse(found, { id: 'c', color: '#000', uid: () => `u${++n}`, text });
  assert.equal(c.rules.roundAt, 0.5);
  assert.equal(c.rules.finalReplacesLowest, undefined); // made up, so dropped
  assert.equal(c.categories[1].check, true);
  assert.ok(warnings.some((w) => /Exams 60%/.test(w)));
  assert.ok(warnings.some((w) => /couldn't point to/.test(w)));
  assert.deepEqual(c.scale, [['A', 90], ['B', 80], ['C', 70], ['F', 0]]);
});
