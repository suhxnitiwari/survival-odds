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

/**
 * current:  your grade on what's been graded so far (0–100)
 * locked:   points of the final grade you've already banked (0–100)
 * graded / remaining: share of the course that is graded / still ahead (0–1)
 */
export function summarize(course) {
  const weights = itemWeights(course);
  let locked = 0;
  let graded = 0;
  let remaining = 0;
  for (const item of course.items) {
    const { weight } = weights.get(item.id) ?? { weight: 0 };
    if (isGraded(item)) {
      locked += weight * pct(item);
      graded += weight;
    } else {
      remaining += weight;
    }
  }
  const current = graded > 0 ? (locked / graded) * 100 : null;
  return {
    current,
    letter: letterFor(current, course.scale),
    locked: locked * 100,
    graded,
    remaining,
  };
}

/** The average you need on everything not graded yet to finish at `target`. */
export function neededOnRemaining(course, target) {
  const s = summarize(course);
  if (s.remaining < 1e-9) return null;
  return (target - s.locked) / s.remaining;
}

/** The item treated as "the final": your pick, one marked final, else the last ungraded exam. */
export function pickFinal(course) {
  const open = course.items.filter((i) => !isGraded(i));
  return open.find((i) => i.id === course.finalId)
    ?? open.find((i) => i.final)
    ?? open.filter((i) => i.kind === 'exam').sort((a, b) => (a.date < b.date ? 1 : -1))[0]
    ?? null;
}

/**
 * The score you need on one item to finish at `target`, assuming everything
 * else still ungraded goes the way that category has gone so far (or your
 * overall average, or your target if nothing is graded yet).
 */
export function neededOnItem(course, itemId, target) {
  const weights = itemWeights(course);
  const s = summarize(course);
  const fallback = s.current !== null ? s.current / 100 : target / 100;
  let banked = 0;
  for (const item of course.items) {
    if (item.id === itemId) continue;
    const { weight } = weights.get(item.id) ?? { weight: 0 };
    if (isGraded(item)) {
      banked += weight * pct(item);
    } else {
      const done = course.items.filter((i) => i.category === item.category && isGraded(i));
      const possible = done.reduce((sum, i) => sum + i.possible, 0);
      const avg = possible > 0 ? done.reduce((sum, i) => sum + i.earned, 0) / possible : fallback;
      banked += weight * avg;
    }
  }
  const own = weights.get(itemId)?.weight ?? 0;
  if (own < 1e-9) return null;
  return ((target / 100 - banked) / own) * 100;
}

/** "What do I need on the final?" for every letter on the scale. */
export function finalTable(course) {
  const final = pickFinal(course);
  const scale = course.scale ?? DEFAULT_SCALE;
  return scale
    .filter(([, cutoff]) => cutoff > 0)
    .map(([letter, cutoff]) => ({
      letter,
      cutoff,
      needed: final ? neededOnItem(course, final.id, cutoff) : neededOnRemaining(course, cutoff),
    }));
}

function article(letter) {
  return /^[AEF]/.test(letter) ? 'an' : 'a';
}

export function formatScore(n) {
  return Number.isInteger(Math.round(n * 10) / 10) ? String(Math.round(n)) : n.toFixed(1);
}

/** The one-liner under the big number. */
export function verdict(needed, letter, nextLetter) {
  if (needed === null) return "Everything's graded. It is what it is ✦";
  const n = formatScore(Math.max(0, Math.ceil(needed * 10) / 10));
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
