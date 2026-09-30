// A made-up semester, built relative to today so the demo always has a few
// weeks behind it (with grades) and the scary part still ahead.

import { addDays, weekStart } from './dates.js';

function seeded(seed) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

export function sampleSemester(today) {
  // Monday of week 1 is five weeks back, so "today" is in week 6.
  const start = addDays(weekStart(today), -35);
  const on = (week, day) => addDays(start, (week - 1) * 7 + (day - 1)); // day: 1 = Mon … 7 = Sun
  const rand = seeded(333);
  let n = 0;

  function course(code, name, color, target, meetings, vibe, categories, items, rules = {}) {
    return {
      id: code.replace(/\W/g, '').toLowerCase(),
      code,
      name,
      color,
      target,
      rules,
      meetings,
      categories: categories.map(([id, label, weight, dropLowest = 0]) => ({ id, name: label, weight, dropLowest })),
      items: items.map(([category, itemName, kind, week, day, possible, extra = {}]) => {
        const date = on(week, day);
        const score = Math.min(1, vibe + (rand() - 0.55) * 0.16);
        return {
          id: `i${++n}`,
          category,
          name: itemName,
          kind,
          date,
          possible,
          earned: date < today ? Math.round(possible * score * 2) / 2 : null,
          ...extra,
        };
      }),
    };
  }

  const hw = (cat, label, kind, weeks, day, possible) =>
    weeks.map((w, i) => [cat, `${label} ${i + 1}`, kind, w, day, possible]);

  return {
    semester: { name: 'Sample Semester', start, end: on(17, 7) },
    courses: [
      course('WEB 210', 'Building Web Apps', '#d6336c', 'A-',
        [{ days: [1, 3], start: '15:30', end: '17:00' }], 0.93,
        [['hw', 'Homework', 20, 1], ['quiz', 'Quizzes', 10, 2], ['e1', 'Exam 1', 20], ['e2', 'Exam 2', 20], ['proj', 'Final Project', 30]],
        [
          ...hw('hw', 'HW', 'homework', [2, 3, 5, 7, 9, 11, 13], 7, 100),
          ...hw('quiz', 'Quiz', 'quiz', [2, 4, 6, 8, 10, 12], 3, 10),
          ['e1', 'Exam 1', 'exam', 5, 3, 100, { time: '15:30' }],
          ['e2', 'Exam 2', 'exam', 12, 3, 100, { time: '15:30' }],
          ['proj', 'Final Project', 'project', 15, 5, 100, { final: true }],
        ], { roundAt: 0.5 }),
      course('MKT 150', 'Marketing Basics', '#7048e8', 'B',
        [{ days: [2, 4], start: '11:00', end: '12:30' }], 0.9,
        [['exams', 'Exams', 60], ['cases', 'Case write-ups', 25], ['part', 'Participation', 15]],
        [
          ['exams', 'Exam 1', 'exam', 5, 2, 100, { time: '11:00' }],
          ['exams', 'Exam 2', 'exam', 9, 4, 100, { time: '11:00' }],
          ['exams', 'Exam 3', 'exam', 16, 2, 100, { time: '11:00', final: true }],
          ...hw('cases', 'Case', 'paper', [4, 8, 13], 5, 50),
          ['part', 'Participation', 'participation', 16, 4, 100],
        ], { finalReplacesLowest: true }),
      course('PSY 101', 'Intro to Psychology', '#0c8599', 'B-',
        [{ days: [1, 3], start: '10:00', end: '11:30' }], 0.9,
        [['mid', 'Midterm', 25], ['final', 'Final', 30], ['refl', 'Reflections', 20], ['team', 'Team project', 25]],
        [
          ['mid', 'Midterm', 'exam', 8, 1, 100, { time: '10:00' }],
          ['final', 'Final', 'exam', 17, 3, 100, { time: '14:00' }],
          ...hw('refl', 'Reflection', 'paper', [3, 6, 9, 12, 14], 5, 20),
          ['team', 'Team presentation', 'project', 14, 3, 100],
        ]),
      course('STAT 120', 'Business Statistics', '#e8590c', 'B+',
        [{ days: [2, 4], start: '14:00', end: '15:30' }], 0.87,
        [['labs', 'Labs', 25, 1], ['mid', 'Midterms', 45], ['final', 'Final', 30]],
        [
          ...hw('labs', 'Lab', 'homework', [2, 3, 4, 6, 7, 10, 11, 13], 5, 20),
          ['mid', 'Midterm 1', 'exam', 6, 2, 100, { time: '14:00' }],
          ['mid', 'Midterm 2', 'exam', 9, 2, 100, { time: '14:00' }],
          ['final', 'Final', 'exam', 17, 5, 100, { time: '09:00' }],
        ]),
    ],
    busy: [{ id: 'b1', label: 'Work shift', days: [5], start: '12:00', end: '17:00' }],
    prefs: {},
  };
}
