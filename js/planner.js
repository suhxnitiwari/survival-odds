// Study blocks that plan themselves. Works backward from each exam and
// scores every open half-hour slot in the days before it, the same way
// Saturday in Austin scores stops: every rule is a cost, lowest cost wins.

import { addDays, daysBetween, weekday } from './dates.js';
import { isGraded, itemWeights } from './grades.js';

export const DEFAULT_PREFS = {
  dayStart: 9 * 60, // earliest a block can start
  dayEnd: 22 * 60, // latest a block can end
  blockMinutes: 90,
  maxBlocksPerDay: 3,
  windowDays: 10, // how far before an exam studying can start
};

const STEP = 30;
const BUFFER = 15; // breathing room around classes and plans

// Every rule is data: a name, a cost, and the reason it exists.
export const RULES = {
  tooEarly: { cost: 30, why: 'Starting early is great, but most sessions should land in the last four days.' },
  sameExamTwice: { cost: 40, why: 'Spacing beats cramming: one session per exam per day when possible.' },
  busyDay: { cost: 12, why: 'Each block already on a day makes the next one there cost more.' },
  lateNight: { cost: 10, why: 'After 9 PM, retention and vibes both go down.' },
  earlyMorning: { cost: 6, why: 'Before 9:30 is allowed, but nobody is thrilled.' },
  saturdayBrunch: { cost: 25, why: "It's Saturday. We're getting brunch." },
  nightBefore: { cost: -4, why: 'A review session the day before is actually good for you.' },
};

/** Default hours: 2, plus about one hour for every 4% of the course grade. */
export function defaultHours(weightPct) {
  return Math.min(10, Math.max(2, Math.round(2 + weightPct / 4)));
}

export function upcomingExams(courses, today) {
  const out = [];
  for (const course of courses) {
    const weights = itemWeights(course);
    for (const item of course.items) {
      if (item.kind !== 'exam' || isGraded(item) || !item.date || item.date < today) continue;
      const weightPct = (weights.get(item.id)?.weight ?? 0) * 100;
      out.push({
        course,
        item,
        weightPct,
        hours: item.studyHours ?? defaultHours(weightPct),
      });
    }
  }
  return out.sort((a, b) => (a.item.date + (a.item.time ?? '')).localeCompare(b.item.date + (b.item.time ?? '')));
}

function toMin(t) {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

/** Classes, weekly plans and the exams themselves on one date. */
export function fixedEvents(date, courses, busy, semester) {
  const events = [];
  const wd = weekday(date);
  const inSemester = !semester || (date >= semester.start && date <= semester.end);
  for (const course of courses) {
    if (inSemester) {
      for (const m of course.meetings ?? []) {
        if (m.days.includes(wd)) events.push({ start: toMin(m.start), end: toMin(m.end), label: course.code });
      }
    }
    for (const item of course.items) {
      if (item.kind === 'exam' && item.date === date && item.time) {
        const start = toMin(item.time);
        events.push({ start, end: start + (item.minutes ?? 90), label: `${course.code} ${item.name}` });
      }
    }
  }
  for (const b of busy ?? []) {
    if (b.days.includes(wd)) events.push({ start: toMin(b.start), end: toMin(b.end), label: b.label });
  }
  return events;
}

function overlaps(start, end, events) {
  return events.some((e) => start < e.end + BUFFER && end + BUFFER > e.start);
}

/**
 * Returns { blocks, shortfalls }. Exams are planned soonest first, since they
 * have the fewest days to work with.
 */
export function planStudy({ courses, busy = [], prefs = {}, today, nowMinutes = 0, semester }) {
  const p = { ...DEFAULT_PREFS, ...prefs };
  const blocks = [];
  const shortfalls = [];
  const fixedCache = new Map();
  const fixed = (date) => {
    if (!fixedCache.has(date)) fixedCache.set(date, fixedEvents(date, courses, busy, semester));
    return fixedCache.get(date);
  };

  for (const exam of upcomingExams(courses, today)) {
    const needed = Math.ceil((exam.hours * 60) / p.blockMinutes);
    const examStart = exam.item.time ? toMin(exam.item.time) : null;
    let placed = 0;

    for (let n = 0; n < needed; n++) {
      let best = null;
      for (let back = 0; back <= p.windowDays; back++) {
        const date = addDays(exam.item.date, -back);
        if (date < today) break;
        const onDay = blocks.filter((b) => b.date === date);
        if (onDay.length >= p.maxBlocksPerDay) continue;
        const sameExam = onDay.filter((b) => b.itemId === exam.item.id).length;
        if (sameExam >= 2) continue;
        const busyToday = [...fixed(date), ...onDay];

        for (let start = p.dayStart; start + p.blockMinutes <= p.dayEnd; start += STEP) {
          const end = start + p.blockMinutes;
          // On exam day, only a warm-up that finishes before the exam.
          if (back === 0 && (examStart === null || end + 60 > examStart)) continue;
          if (date === today && start < nowMinutes) continue;
          if (overlaps(start, end, busyToday)) continue;

          let cost = start / 1440; // tiny nudge toward earlier in the day
          if (back > 4) cost += RULES.tooEarly.cost * ((back - 4) / 3);
          if (back === 1) cost += RULES.nightBefore.cost;
          cost += RULES.sameExamTwice.cost * sameExam;
          cost += RULES.busyDay.cost * onDay.length;
          if (start >= 21 * 60) cost += RULES.lateNight.cost;
          if (start < 9 * 60 + 30) cost += RULES.earlyMorning.cost;
          if (weekday(date) === 6 && start < 13 * 60 + 30 && end > 9 * 60 + 30) cost += RULES.saturdayBrunch.cost;

          if (!best || cost < best.cost) best = { date, start, end, cost };
        }
      }
      if (!best) break;
      placed++;
      blocks.push({
        date: best.date,
        start: best.start,
        end: best.end,
        itemId: exam.item.id,
        courseId: exam.course.id,
        label: `${exam.course.code}: ${exam.item.name}`,
      });
    }

    if (placed < needed) {
      shortfalls.push({
        itemId: exam.item.id,
        courseId: exam.course.id,
        label: `${exam.course.code}: ${exam.item.name}`,
        missingMinutes: (needed - placed) * p.blockMinutes,
      });
    }
  }

  // Number each exam's sessions in the order they happen.
  blocks.sort((a, b) => (a.date === b.date ? a.start - b.start : a.date < b.date ? -1 : 1));
  const counts = new Map();
  const totals = new Map();
  for (const b of blocks) totals.set(b.itemId, (totals.get(b.itemId) ?? 0) + 1);
  for (const b of blocks) {
    const k = (counts.get(b.itemId) ?? 0) + 1;
    counts.set(b.itemId, k);
    b.session = k;
    b.sessions = totals.get(b.itemId);
    b.daysBefore = daysBetween(b.date, courses.flatMap((c) => c.items).find((i) => i.id === b.itemId).date);
  }
  return { blocks, shortfalls };
}
