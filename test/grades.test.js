import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  categoryPace, finalTable, itemWeights, letterFor, neededOnItem, neededOnRemaining, pickFinal, projectGrade, summarize, verdict,
} from '../js/grades.js';

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

// 40% homework (two 50-pt assignments), 60% final (one 100-pt exam).
function course(overrides = {}) {
  return {
    id: 'c',
    categories: [
      { id: 'hw', name: 'Homework', weight: 40 },
      { id: 'fin', name: 'Final', weight: 60 },
    ],
    items: [
      { id: 'h1', category: 'hw', kind: 'homework', possible: 50, earned: 45 },
      { id: 'h2', category: 'hw', kind: 'homework', possible: 50, earned: 50 },
      { id: 'f', category: 'fin', kind: 'exam', possible: 100, earned: null, date: '2026-12-10' },
    ],
    ...overrides,
  };
}

test('item weights split each category by points and add to 1', () => {
  const w = itemWeights(course());
  close(w.get('h1').weight, 0.2);
  close(w.get('h2').weight, 0.2);
  close(w.get('f').weight, 0.6);
});

test('weights that do not add to 100 are scaled so they do', () => {
  const c = course();
  c.categories = [{ id: 'hw', weight: 20 }, { id: 'fin', weight: 30 }];
  const w = itemWeights(c);
  close(w.get('h1').weight + w.get('h2').weight + w.get('f').weight, 1);
  close(w.get('f').weight, 0.6);
});

test('current grade only counts what has been graded', () => {
  const s = summarize(course());
  close(s.current, 95);
  close(s.locked, 38);
  close(s.remaining, 0.6);
  assert.equal(s.letter, 'A');
});

test('what you need on the final', () => {
  // 93 = 38 + 0.6x  →  x = 91.666…
  close(neededOnRemaining(course(), 93), 55 / 0.6);
  close(neededOnItem(course(), 'f', 93), 55 / 0.6);
  // A 90 needs 86.666…
  close(neededOnItem(course(), 'f', 90), 52 / 0.6);
});

test('other ungraded work is projected at that category average', () => {
  const c = course();
  c.items.push({ id: 'h3', category: 'hw', kind: 'homework', possible: 50, earned: null });
  // Homework so far is 95/100, so h3 is projected at 95%.
  // Weights: each hw 40/3 %, final 60 %.
  const hwEach = 0.4 / 3;
  const banked = hwEach * 0.9 + hwEach * 1 + hwEach * 0.95;
  close(neededOnItem(c, 'f', 93), ((0.93 - banked) / 0.6) * 100);
});

test('drop lowest waits until the category is fully graded', () => {
  const c = course();
  c.categories[0].dropLowest = 1;
  c.items.push({ id: 'h3', category: 'hw', kind: 'homework', possible: 50, earned: null });
  assert.equal(itemWeights(c).get('h1').dropped, false);

  c.items[3].earned = 20;
  const w = itemWeights(c);
  assert.equal(w.get('h3').dropped, true);
  close(w.get('h3').weight, 0);
  close(w.get('h1').weight, 0.2);
  close(summarize(c).current, 95);
});

test('the final is your pick, then one marked final, then the last exam', () => {
  const c = course();
  c.items.push({ id: 'm', category: 'fin', kind: 'exam', possible: 100, earned: null, date: '2026-10-10' });
  assert.equal(pickFinal(c).id, 'f');
  c.items[3].final = true;
  assert.equal(pickFinal(c).id, 'm');
  c.finalId = 'f';
  assert.equal(pickFinal(c).id, 'f');
});

test('letters use the plus/minus scale', () => {
  assert.equal(letterFor(93), 'A');
  assert.equal(letterFor(92.99), 'A-');
  assert.equal(letterFor(87), 'B+');
  assert.equal(letterFor(59.9), 'F');
  assert.equal(letterFor(null), null);
});

test('the letter table goes from A down to D-', () => {
  const t = finalTable(course());
  assert.equal(t[0].letter, 'A');
  assert.equal(t.at(-1).letter, 'D-');
  assert.ok(t.every((r, i) => i === 0 || r.needed <= t[i - 1].needed));
});

test('verdicts', () => {
  assert.match(verdict(-5, 'A'), /already locked in an A/);
  assert.match(verdict(61, 'A'), /Go to Cosmic/);
  assert.match(verdict(95, 'B+'), /for a B\+/);
  assert.match(verdict(120, 'A', 'A-'), /An A- is still on the table/);
  assert.match(verdict(null), /Everything's graded/);
});

test('a fully graded course needs nothing', () => {
  const c = course();
  c.items[2].earned = 80;
  assert.equal(neededOnRemaining(c, 93), null);
  close(summarize(c).current, 86);
});

test('what-if: assuming a different average on the rest changes what the final needs', () => {
  // 40% homework (h1 graded 90%, h2 open), 60% final (open).
  const c = course();
  c.items[1].earned = null;
  const onPace = neededOnItem(c, 'f', 90); // h2 projected at 90%
  const worse = neededOnItem(c, 'f', 90, 50); // h2 at 50%
  const perfect = neededOnItem(c, 'f', 90, 100);
  close(onPace, 90, 1e-6);
  close(worse, (90 - 18 - 10) / 0.6, 1e-6);
  close(perfect, (90 - 18 - 20) / 0.6, 1e-6);
  assert.equal(finalTable(c, 100).find((r) => r.letter === 'A-').needed, perfect);
});

test('what-if per category, and the projected grade with a score on the final', () => {
  // 40% homework (h1 90%, h2 open), 60% final (open).
  const c = course();
  c.items[1].earned = null;
  close(neededOnItem(c, 'f', 90, { hw: 50 }), (90 - 18 - 10) / 0.6);
  close(neededOnItem(c, 'f', 90, { other: 50 }), 90); // categories left out keep their pace
  const p = projectGrade(c, { hw: 100 }, 'f', 80);
  close(p.grade, 18 + 20 + 48);
  assert.equal(p.letter, 'B');
  close(categoryPace(c, 'hw'), 90);
  assert.equal(categoryPace(c, 'fin'), null);
});
