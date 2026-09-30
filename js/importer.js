// Turns what a reader found (the built-in parser or Gemini) into a class,
// and checks it. Anything that looks off becomes a warning on the review
// screen instead of a silent guess.

import { kindFor, normalizeName } from './parser.js';

const KINDS = ['exam', 'quiz', 'homework', 'project', 'paper', 'participation'];
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

// A real calendar date, not just the right shape ("2026-13-45" is not).
function isDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function singular(name) {
  return name
    .replace(/quizzes\b/i, 'Quiz')
    .replace(/ies\b/i, 'y')
    .replace(/(?<!s)s\b/i, '')
    .replace(/\s*\(.*?\)\s*/g, ' ')
    .trim();
}

function tokens(s) {
  return new Set(normalizeName(s).toLowerCase().split(/[^a-z0-9]+/).filter((t) => t && t !== 'exam'));
}

export function toCourse(found, { id, color, semester, uid }) {
  const warnings = [];
  const categories = [];
  const items = [];

  for (const c of found.categories ?? []) {
    const weight = Number(c.weight);
    if (!c.name || !Number.isFinite(weight) || weight <= 0) continue;
    const cat = { id: uid(), name: String(c.name).slice(0, 60), weight, dropLowest: Math.max(0, Math.floor(c.dropLowest || 0)) };
    categories.push(cat);
    const kind = KINDS.includes(c.kind) ? c.kind : kindFor(cat.name);
    const count = Math.min(30, Math.max(1, Math.floor(c.count || 1)));
    for (let k = 1; k <= count; k++) {
      items.push({
        id: uid(),
        category: cat.id,
        name: count > 1 ? `${singular(cat.name)} ${k}` : cat.name,
        kind,
        date: count === 1 && isDate(c.date) ? c.date : null,
        time: count === 1 && TIME_RE.test(c.time ?? '') ? c.time : undefined,
        possible: 100,
        earned: null,
      });
    }
    if (cat.dropLowest >= count && count > 1) cat.dropLowest = 0;
  }

  // Put each dated exam on the item it belongs to.
  const unmatched = [];
  for (const ex of found.items ?? []) {
    if (!isDate(ex.date)) continue;
    const want = tokens(ex.name);
    const same = items.find((i) => normalizeName(i.name).toLowerCase() === normalizeName(ex.name).toLowerCase());
    if (same?.date === ex.date) continue; // already found in the grade table
    const open = items.filter((i) => !i.date && (i.kind === (ex.kind || 'exam')));
    const exact = open.find((i) => normalizeName(i.name).toLowerCase() === normalizeName(ex.name).toLowerCase());
    const overlap = open.find((i) => [...tokens(i.name)].some((t) => want.has(t)));
    const target = exact ?? overlap ?? (want.size === 0 ? open[0] : null);
    if (target) {
      target.date = ex.date;
      if (TIME_RE.test(ex.time ?? '')) target.time = ex.time;
    } else {
      unmatched.push(ex);
    }
  }

  // "Exams 30%" with no count, and the syllabus names Exam 1 and Exam 2:
  // split the category into those exams.
  for (const cat of categories) {
    const own = items.filter((i) => i.category === cat.id);
    if (own.length !== 1 || own[0].kind !== 'exam' || own[0].date || !/s\b/i.test(cat.name) || !unmatched.length) continue;
    const idx = items.indexOf(own[0]);
    items.splice(idx, 1, ...unmatched.map((ex) => ({
      ...own[0],
      id: uid(),
      name: ex.name,
      date: ex.date,
      time: TIME_RE.test(ex.time ?? '') ? ex.time : undefined,
    })));
    unmatched.length = 0;
  }

  const meetings = (found.meetings ?? [])
    .filter((m) => Array.isArray(m.days) && m.days.length && TIME_RE.test(m.start ?? '') && TIME_RE.test(m.end ?? '') && m.start < m.end)
    .map((m) => ({ days: [...new Set(m.days.map(Number).filter((d) => d >= 0 && d <= 6))].sort(), start: m.start, end: m.end }))
    .slice(0, 3);

  // Exams with times but no time found: they're usually during class.
  for (const item of items) {
    if (item.kind === 'exam' && item.date && !item.time && meetings[0]) item.time = meetings[0].start;
  }

  const total = categories.reduce((s, c) => s + c.weight, 0);
  if (!categories.length) {
    warnings.push("I couldn't find the grade weights. Add them in My classes, or try the Gemini reader.");
  } else if (Math.abs(total - 100) > 0.6) {
    warnings.push(`The weights add up to ${Math.round(total * 10) / 10}%, not 100%. Double-check them.`);
  }
  if (!meetings.length) warnings.push("I couldn't find your class times. Add them so study blocks don't land on class.");
  const undated = items.filter((i) => i.kind === 'exam' && !i.date);
  if (undated.length) {
    warnings.push(`No date found for ${undated.map((i) => i.name).join(', ')}. Add ${undated.length === 1 ? 'it' : 'them'} to get study blocks.`);
  }
  if (semester?.start && semester?.end) {
    const outside = items.filter((i) => i.date && (i.date < semester.start || i.date > semester.end));
    if (outside.length) warnings.push(`${outside.map((i) => i.name).join(', ')} ${outside.length === 1 ? 'falls' : 'fall'} outside your semester dates.`);
  }
  for (const ex of unmatched) warnings.push(`Found "${ex.name}" on ${ex.date}, but not which grade category it belongs to.`);

  return {
    course: {
      id,
      code: String(found.code ?? '').slice(0, 20),
      name: String(found.name ?? '').slice(0, 80),
      color,
      target: 'A',
      meetings,
      categories,
      items,
    },
    warnings,
  };
}
