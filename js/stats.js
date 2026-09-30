// The numbers behind Semester Wrapped.

import { shortDate, weekStart, addDays } from './dates.js';
import { DEFAULT_SCALE, isGraded, itemWeights, neededOnRemaining, summarize } from './grades.js';

function targetCutoff(course) {
  const scale = course.scale ?? DEFAULT_SCALE;
  return scale.find(([l]) => l === (course.target ?? 'A'))?.[1] ?? 93;
}

/** How much a class asks of you: every deadline, plus extra for exam weight. */
export function workload(course) {
  const weights = itemWeights(course);
  const examWeight = course.items
    .filter((i) => i.kind === 'exam')
    .reduce((s, i) => s + (weights.get(i.id)?.weight ?? 0) * 100, 0);
  return course.items.length + examWeight / 5;
}

/** The week with the most riding on it: grade weight due, plus a little for every deadline. */
export function worstWeek(courses) {
  const weeks = new Map();
  for (const course of courses) {
    const weights = itemWeights(course);
    for (const item of course.items) {
      if (!item.date) continue;
      const key = weekStart(item.date);
      const w = weeks.get(key) ?? { start: key, weight: 0, count: 0, exams: 0 };
      w.weight += (weights.get(item.id)?.weight ?? 0) * 100;
      w.count += 1;
      if (item.kind === 'exam') w.exams += 1;
      weeks.set(key, w);
    }
  }
  return [...weeks.values()].sort((a, b) => b.weight + 6 * b.count - (a.weight + 6 * a.count))[0] ?? null;
}

export function survivalOdds(courses) {
  const needs = courses
    .map((c) => neededOnRemaining(c, targetCutoff(c)))
    .filter((n) => n !== null);
  if (!needs.length) return { label: 'good', line: 'Nothing graded yet. Pure potential.' };
  const worst = Math.max(...needs);
  if (worst <= 75) return { label: 'excellent', line: 'Every target is comfortably in reach.' };
  if (worst <= 88) return { label: 'good', line: 'Every target is in reach with steady work.' };
  if (worst <= 100) return { label: 'tight but real', line: "One class needs you to lock in. You can." };
  return { label: 'character development', line: "Not every target is possible, but a great semester still is." };
}

export function wrapped({ semester, courses, blocks = [] }) {
  const items = courses.flatMap((c) => c.items.map((i) => ({ ...i, course: c })));
  const summaries = courses.map((c) => ({ course: c, ...summarize(c) }));
  const graded = summaries.filter((s) => s.current !== null);
  const week = worstWeek(courses);
  const hardest = [...courses].sort((a, b) => workload(b) - workload(a))[0] ?? null;
  const carrying = [...graded].sort((a, b) => b.current - a.current)[0] ?? null;
  const studyMinutes = blocks.reduce((s, b) => s + (b.end - b.start), 0);
  const totalWeight = summaries.reduce((s, x) => s + x.graded + x.remaining, 0);
  const stillAhead = totalWeight ? summaries.reduce((s, x) => s + x.remaining, 0) / totalWeight : 0;

  return {
    semester: semester?.name ?? 'This semester',
    classes: courses.length,
    deadlines: items.filter((i) => i.date).length,
    exams: items.filter((i) => i.kind === 'exam').length,
    graded: items.filter(isGraded).length,
    hardest: hardest?.code ?? null,
    carrying: carrying ? { code: carrying.course.code, score: carrying.current } : null,
    worstWeek: week && {
      start: week.start,
      label: `${shortDate(week.start)}–${shortDate(addDays(week.start, 6))}`,
      short: shortDate(week.start),
      weight: week.weight,
      count: week.count,
      exams: week.exams,
    },
    studyHours: Math.round(studyMinutes / 60),
    stillAhead,
    odds: survivalOdds(courses),
  };
}
