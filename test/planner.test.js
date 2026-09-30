import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultHours, planStudy } from '../js/planner.js';
import { weekday } from '../js/dates.js';
import { sampleSemester } from '../js/sample.js';

const TODAY = '2026-09-30'; // a Wednesday

function oneExam(extra = {}) {
  return [{
    id: 'c', code: 'WEB 210',
    meetings: [{ days: [1, 3], start: '15:30', end: '17:00' }],
    categories: [{ id: 'e', weight: 100 }],
    items: [{ id: 'x', category: 'e', kind: 'exam', name: 'Exam 2', date: '2026-10-12', time: '15:30', possible: 100, earned: null, ...extra }],
  }];
}

const toMin = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));

test('default hours grow with how much the exam is worth', () => {
  assert.equal(defaultHours(0), 2);
  assert.equal(defaultHours(20), 7);
  assert.equal(defaultHours(100), 10);
});

test('plans the requested hours before the exam', () => {
  const { blocks, shortfalls } = planStudy({ courses: oneExam({ studyHours: 6 }), today: TODAY });
  assert.equal(blocks.length, 4); // 6 hours of 90-minute sessions
  assert.deepEqual(shortfalls, []);
  for (const b of blocks) {
    assert.ok(b.date >= TODAY && b.date <= '2026-10-12');
    assert.ok(b.start >= 9 * 60 && b.end <= 22 * 60);
  }
  assert.deepEqual(blocks.map((b) => b.session), [1, 2, 3, 4]);
});

test('spreads sessions out instead of cramming one day', () => {
  const { blocks } = planStudy({ courses: oneExam({ studyHours: 6 }), today: TODAY });
  assert.equal(new Set(blocks.map((b) => b.date)).size, 4);
});

test('never overlaps a class or a busy block', () => {
  const busy = [{ label: 'Work', days: [0, 1, 2, 3, 4, 5, 6], start: '12:00', end: '17:00' }];
  const { blocks } = planStudy({ courses: oneExam({ studyHours: 9 }), busy, today: TODAY });
  for (const b of blocks) {
    assert.ok(b.end <= toMin('12:00') - 15 || b.start >= toMin('17:00') + 15, `${b.date} ${b.start}`);
  }
});

test('keeps Saturday mornings for brunch when it can', () => {
  const { blocks } = planStudy({ courses: oneExam({ studyHours: 6 }), today: TODAY });
  const saturdayMorning = blocks.filter((b) => weekday(b.date) === 6 && b.start < 13.5 * 60 && b.end > 9.5 * 60);
  assert.equal(saturdayMorning.length, 0);
});

test('on exam day only a warm-up that ends an hour before', () => {
  const { blocks } = planStudy({
    courses: oneExam({ studyHours: 12, date: '2026-10-01', time: '18:00' }),
    today: TODAY,
    prefs: { maxBlocksPerDay: 5 },
  });
  for (const b of blocks.filter((x) => x.date === '2026-10-01')) assert.ok(b.end + 60 <= 18 * 60);
});

test('reports a shortfall when there is not enough time', () => {
  const { shortfalls } = planStudy({ courses: oneExam({ studyHours: 20, date: '2026-10-01' }), today: TODAY });
  assert.equal(shortfalls.length, 1);
  assert.ok(shortfalls[0].missingMinutes > 0);
});

test('skips slots earlier today that already passed', () => {
  const { blocks } = planStudy({
    courses: oneExam({ studyHours: 3, date: '2026-10-01', time: '10:00' }),
    today: TODAY,
    nowMinutes: 20 * 60,
  });
  for (const b of blocks.filter((x) => x.date === TODAY)) assert.ok(b.start >= 20 * 60);
});

test('the whole sample semester plans without collisions', () => {
  const s = sampleSemester(TODAY);
  const { blocks } = planStudy({ ...s, today: TODAY });
  const byDay = Map.groupBy(blocks, (b) => b.date);
  for (const day of byDay.values()) {
    assert.ok(day.length <= 3);
    const sorted = day.sort((a, b) => a.start - b.start);
    for (let i = 1; i < sorted.length; i++) assert.ok(sorted[i].start >= sorted[i - 1].end);
  }
});
