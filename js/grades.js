// Grade math. A course has weighted categories (Exams 40%, Homework 20%…) and
// items inside them, scored in points. An item's share of the final grade is
// its category's weight split by points, so a 100-point exam counts twice as
// much as a 50-point one in the same category.

export const DEFAULT_SCALE = [
  ['A', 93], ['A-', 90], ['B+', 87], ['B', 83], ['B-', 80], ['C+', 77],
  ['C', 73], ['C-', 70], ['D+', 67], ['D', 63], ['D-', 60], ['F', 0],
];

export function isGraded(item) {
  return typeof item.earned === 'number' && Number.isFinite(item.earned);
}

function pct(item) {
  return item.possible > 0 ? item.earned / item.possible : 0;
}

/**
 * Each item's share of the final grade as a fraction of 1 (all shares add to 1).
 * "Drop the lowest n" only applies once a category is fully graded: until
 * then we don't guess which one you'll drop, so the numbers stay honest.
 */
export function itemWeights(course) {
  const totalWeight = course.categories.reduce((s, c) => s + (Number(c.weight) || 0), 0);
  const weights = new Map();
  for (const cat of course.categories) {
    const items = course.items.filter((i) => i.category === cat.id);
    const dropped = new Set();
    const n = cat.dropLowest || 0;
    if (n > 0 && items.length > n && items.every(isGraded)) {
      [...items].sort((a, b) => pct(a) - pct(b)).slice(0, n).forEach((i) => dropped.add(i.id));
    }
    const possible = items.filter((i) => !dropped.has(i.id)).reduce((s, i) => s + i.possible, 0);
    for (const item of items) {
      const share = dropped.has(item.id) || !possible || !totalWeight
        ? 0
        : (cat.weight / totalWeight) * (item.possible / possible);
      weights.set(item.id, { weight: share, dropped: dropped.has(item.id) });
    }
  }
  return weights;
}

export function letterFor(score, scale = DEFAULT_SCALE) {
  if (score === null) return null;
  return scale.find(([, cutoff]) => score >= cutoff - 1e-9)?.[0] ?? scale.at(-1)[0];
}

// ---------- syllabus rules ----------
//
// Real syllabi bend the weighted average. The rules a course can have:
//   course.rules.roundAt              "91.5% rounds up to 92%" → 0.5
//   course.rules.finalReplacesLowest  the final's score replaces your lowest exam, if it's higher
//   course.rules.passExams            your exam average must be at least this to pass (a warning)
//   course.rules.extraCreditMax       extra credit adds at most this many points (course.extraCredit)
//   category.fullCreditAt             earning this % of a category's points counts as 100%

function finalExamId(course) {
  const exams = course.items.filter((i) => i.kind === 'exam');
  return (exams.find((i) => i.id === course.rules?.finalId)
    ?? exams.find((i) => i.final)
    ?? [...exams].sort((a, b) => ((a.date ?? '') < (b.date ?? '') ? 1 : -1))[0])?.id ?? null;
}

/** Your scores as fractions (0.93), after "the final replaces your lowest exam". */
function applyReplacement(course, values) {
  if (!course.rules?.finalReplacesLowest) return values;
  const finalId = finalExamId(course);
  if (!values.has(finalId)) return values;
  const others = course.items.filter((i) => i.kind === 'exam' && i.id !== finalId && values.has(i.id));
  if (!others.length) return values;
  const lowest = others.reduce((a, b) => (values.get(b.id) < values.get(a.id) ? b : a));
  const out = new Map(values);
  if (values.get(finalId) > values.get(lowest.id)) out.set(lowest.id, values.get(finalId));
  return out;
}

/**
 * The weighted score (0–100) over the items that have a value, plus how much
 * of the course those items cover (0–1).
 */
function scoreWith(course, values) {
  const weights = itemWeights(course);
  const v = applyReplacement(course, values);
  let points = 0;
  let counted = 0;
  for (const cat of course.categories) {
    let w = 0;
    let earned = 0;
    for (const item of course.items) {
      if (item.category !== cat.id || !v.has(item.id)) continue;
      const share = weights.get(item.id)?.weight ?? 0;
      w += share;
      earned += share * v.get(item.id);
    }
    if (w < 1e-12) continue;
    let frac = earned / w;
    if (cat.fullCreditAt > 0) frac = Math.min(1, frac / (cat.fullCreditAt / 100));
    points += w * frac;
    counted += w;
  }
  return { points: points * 100, counted };
}

/** The number on your transcript: extra credit added, then the syllabus's rounding. */
export function finishGrade(course, raw) {
  if (raw === null) return null;
  const extra = Math.min(Number(course.extraCredit) || 0, course.rules?.extraCreditMax ?? Infinity);
  const score = raw + Math.max(0, extra);
  const at = course.rules?.roundAt;
  if (at === undefined || at === null) return score;
  const floor = Math.floor(score + 1e-9);
  return score - floor >= at - 1e-9 ? floor + 1 : score;
}

function graded(course) {
  return new Map(course.items.filter(isGraded).map((i) => [i.id, pct(i)]));
}

/** Where each ungraded item is headed: that category's average so far, else `fallback`. */
function projected(course, fallback) {
  const values = graded(course);
  for (const item of course.items) {
    if (isGraded(item)) continue;
    const done = course.items.filter((i) => i.category === item.category && isGraded(i));
    const possible = done.reduce((sum, i) => sum + i.possible, 0);
    values.set(item.id, possible > 0 ? done.reduce((sum, i) => sum + i.earned, 0) / possible : fallback);
  }
  return values;
}

/**
 * current:  your grade on what's been graded so far (0–100), before rounding
 * final:    that grade with extra credit and rounding, the one the letter uses
 * locked:   points of the final grade you've already banked (0–100)
 * graded / remaining: share of the course that is graded / still ahead (0–1)
 */
export function summarize(course) {
  const weights = itemWeights(course);
  const { points, counted } = scoreWith(course, graded(course));
  let remaining = 0;
  for (const item of course.items) {
    if (!isGraded(item)) remaining += weights.get(item.id)?.weight ?? 0;
  }
  const current = counted > 0 ? points / counted : null;
  const final = finishGrade(course, current);
  return { current, final, letter: letterFor(final, course.scale), locked: points, graded: counted, remaining };
}

/** Your exam average so far (0–100), for "you must pass the exams" rules. */
export function examAverage(course) {
  const values = applyReplacement(course, graded(course));
  const exams = course.items.filter((i) => i.kind === 'exam' && values.has(i.id));
  const possible = exams.reduce((s, i) => s + i.possible, 0);
  return possible ? (exams.reduce((s, i) => s + values.get(i.id) * i.possible, 0) / possible) * 100 : null;
}

// Every rule keeps "a higher score never lowers your grade" true, so the
// smallest score that reaches the target can be found by bisection.
function smallestScore(gradeAt, target) {
  if (gradeAt(0) >= target - 1e-9) return 0;
  let hi = 100;
  while (gradeAt(hi) < target - 1e-9) {
    hi *= 2;
    if (hi > 1e4) return Infinity;
  }
  let lo = 0;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (gradeAt(mid) >= target - 1e-9) hi = mid;
    else lo = mid;
  }
  return hi;
}

function totalGrade(course, values) {
  const { points, counted } = scoreWith(course, values);
  return finishGrade(course, counted > 0 ? points / counted : 0);
}

/** The average you need on everything not graded yet to finish at `target`. */
export function neededOnRemaining(course, target) {
  if (summarize(course).remaining < 1e-9) return null;
  const open = course.items.filter((i) => !isGraded(i));
  return smallestScore((x) => {
    const values = graded(course);
    for (const item of open) values.set(item.id, x / 100);
    return totalGrade(course, values);
  }, target);
}

/** The item treated as "the final": your pick, one marked final, else the last ungraded exam. */
export function pickFinal(course) {
  const open = course.items.filter((i) => !isGraded(i));
  return open.find((i) => i.id === course.finalId)
    ?? open.find((i) => i.final)
    ?? open.filter((i) => i.kind === 'exam').sort((a, b) => (a.date < b.date ? 1 : -1))[0]
    ?? null;
}

/** Your average so far in one category (0–100), or null if nothing in it is graded. */
export function categoryPace(course, categoryId) {
  const done = course.items.filter((i) => i.category === categoryId && isGraded(i));
  const possible = done.reduce((sum, i) => sum + i.possible, 0);
  return possible > 0 ? (done.reduce((sum, i) => sum + i.earned, 0) / possible) * 100 : null;
}

/**
 * What-if: what the ungraded work averages (0–100). A number applies to
 * everything left; an object sets it per category ({ hw: 90, quizzes: 70 }),
 * and categories it leaves out keep their pace.
 */
function assumeFor(assume, item) {
  if (typeof assume === 'number') return assume;
  const v = assume?.[item.category];
  return typeof v === 'number' ? v : null;
}

/**
 * The score you need on one item to finish at `target`, assuming everything
 * else still ungraded goes the way that category has gone so far (or your
 * overall average, or your target if nothing is graded yet). `assume`
 * overrides that, per the what-if sliders.
 */
export function neededOnItem(course, itemId, target, assume = null) {
  if ((itemWeights(course).get(itemId)?.weight ?? 0) < 1e-9) return null;
  const s = summarize(course);
  const base = projected(course, s.current !== null ? s.current / 100 : target / 100);
  for (const item of course.items) {
    const v = isGraded(item) ? null : assumeFor(assume, item);
    if (v !== null) base.set(item.id, v / 100);
  }
  return smallestScore((x) => {
    const values = new Map(base);
    values.set(itemId, x / 100);
    return totalGrade(course, values);
  }, target);
}

/**
 * Where the class ends up if the rest goes like the what-if sliders say:
 * `assume` per category (as above), and `finalScore` (0–100) on the final.
 * Returns the grade with extra credit and rounding, and its letter.
 */
export function projectGrade(course, assume = null, finalId = null, finalScore = null) {
  const s = summarize(course);
  const values = projected(course, s.current !== null ? s.current / 100 : 0.85);
  for (const item of course.items) {
    const v = isGraded(item) ? null : assumeFor(assume, item);
    if (v !== null) values.set(item.id, v / 100);
  }
  if (finalId && finalScore !== null) values.set(finalId, finalScore / 100);
  const grade = totalGrade(course, values);
  return { grade, letter: letterFor(grade, course.scale) };
}

/** "What do I need on the final?" for every letter on the scale. */
export function finalTable(course, assume = null) {
  const final = pickFinal(course);
  const scale = course.scale ?? DEFAULT_SCALE;
  return scale
    .filter(([, cutoff]) => cutoff > 0)
    .map(([letter, cutoff]) => ({
      letter,
      cutoff,
      needed: final ? neededOnItem(course, final.id, cutoff, assume) : neededOnRemaining(course, cutoff),
    }));
}

/** The rules in effect, in plain English, with where each came from. */
export function describeRules(course) {
  const out = [];
  const r = course.rules ?? {};
  const src = course.sources ?? {};
  if (r.roundAt !== undefined && r.roundAt !== null) out.push({ key: 'roundAt', text: `Rounds up at .${String(r.roundAt).split('.')[1] ?? '5'} (a ${90 + r.roundAt} becomes a 91)`, source: src.roundAt });
  if (r.finalReplacesLowest) out.push({ key: 'finalReplacesLowest', text: 'Your final replaces your lowest exam if it’s higher', source: src.finalReplacesLowest });
  if (r.passExams) out.push({ key: 'passExams', text: `Exam average must be at least ${r.passExams}% to pass`, source: src.passExams });
  if (r.extraCreditMax) out.push({ key: 'extraCreditMax', text: `Up to ${r.extraCreditMax} point${r.extraCreditMax === 1 ? '' : 's'} of extra credit`, source: src.extraCreditMax });
  for (const cat of course.categories) {
    if (cat.fullCreditAt) out.push({ key: `full-${cat.id}`, text: `${cat.name}: ${cat.fullCreditAt}% of the points counts as full credit`, source: cat.source?.fullCreditAt });
    if (cat.dropLowest) out.push({ key: `drop-${cat.id}`, text: `${cat.name}: lowest ${cat.dropLowest === 1 ? 'one' : cat.dropLowest} dropped`, source: cat.source?.dropLowest });
  }
  if (course.scale && course.scale !== DEFAULT_SCALE) {
    const a = course.scale.find(([l]) => l === 'A');
    if (a && a[1] !== 93) out.push({ key: 'scale', text: `Grading scale from the syllabus (an A starts at ${a[1]})`, source: src.scale });
  }
  return out;
}

function article(letter) {
  return /^[AEF]/.test(letter) ? 'an' : 'a';
}

export function formatScore(n) {
  if (n > 150) return '150+';
  return Number.isInteger(Math.round(n * 10) / 10) ? String(Math.round(n)) : n.toFixed(1);
}

/** How the score you need feels: the bands on the survival gauge. */
export const ODDS = [
  { max: 65, key: 'chill', label: 'Chill' },
  { max: 85, key: 'doable', label: 'Doable' },
  { max: 100, key: 'clutch', label: 'Clutch' },
  { max: Infinity, key: 'out', label: 'Out of reach' },
];

export function oddsFor(needed) {
  return ODDS.find((b) => needed <= b.max);
}

/** The one-liner under the big number. */
export function verdict(needed, letter, nextLetter) {
  if (needed === null) return "Everything's graded. It is what it is ✦";
  const n = formatScore(Math.max(0, Math.ceil(needed * 10 - 1e-6) / 10));
  const grade = `${article(letter)} ${letter}`;
  if (needed <= 0) return `You've already locked in ${grade}. Show up anyway.`;
  if (needed <= 65) return `You need a ${n} for ${grade}. You're fine. Go to Cosmic.`;
  if (needed <= 80) return `You need a ${n} for ${grade}. Very doable. One focused weekend.`;
  if (needed <= 90) return `You need a ${n} for ${grade}. Lock in, but it's there.`;
  if (needed <= 100) return `You need a ${n} for ${grade}. It's giving PCL until close.`;
  return nextLetter
    ? `You'd need a ${n} for ${grade}. Not happening, and that's okay. ${article(nextLetter)[0].toUpperCase()}${article(nextLetter).slice(1)} ${nextLetter} is still on the table.`
    : `You'd need a ${n} for ${grade}. Not happening, and that's okay.`;
}
