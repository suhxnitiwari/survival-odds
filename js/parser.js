// Reads a syllabus without AI. Syllabi are messy, so each rule looks for the
// shape the information usually takes, and everything it finds goes to a
// review screen before it is saved:
//
//   weights   a run of "Label … 20%" lines that adds up to 100
//   meetings  the first class-time line ("MW 11:00am - 12:15pm"), never office hours
//   exams     lines that name an exam and a date ("Exam 1 - Oct. 12")

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MONTH_RE = /\b(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b/i;
const NUMERIC_DATE_RE = /(?<![\d/.])(\d{1,2})\/(\d{1,2})(?![\d/])/;
const TIME_RE = /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i;
const RANGE_RE = /(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:-|–|—|to)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i;
const WEEKDAY_WORDS = /\b(mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)(day)?s?\b,?/gi;
const LETTER_GRADE = /^[A-F][+-]?$/;
const NOT_A_WEIGHT = /penalty|\blate\b|deduct|reduction|off your|extra credit|bonus|curve|\b(top|next|last)\s+\d+\s*%|of the points|receive|round/i;

export function kindFor(name) {
  const n = name.toLowerCase();
  if (/participation|attendance|engagement/.test(n)) return 'participation';
  if (/project|presentation|client/.test(n)) return 'project';
  if (/quiz|poll/.test(n)) return 'quiz';
  if (/paper|essay|reflection|write-?up|case|journal|report|notes/.test(n)) return 'paper';
  if (/midterm|final|exam|test\b/.test(n)) return 'exam';
  return 'homework';
}

function clean(line) {
  return line.replace(/\s+/g, ' ').trim();
}

/** Picks a year for "Oct 12" so it lands closest to the reference date. */
export function inferDate(month, day, ref) {
  const [ry, rm] = ref.split('-').map(Number);
  let year = ry;
  const diff = month - rm;
  if (diff < -5) year += 1;
  if (diff > 6) year -= 1;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function findDate(line, ref) {
  const m = line.match(MONTH_RE);
  if (m) {
    const month = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()) + 1;
    const day = Number(m[2]);
    if (day >= 1 && day <= 31) return inferDate(month, day, ref);
  }
  const n = line.match(NUMERIC_DATE_RE);
  if (n) {
    const month = Number(n[1]);
    const day = Number(n[2]);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) return inferDate(month, day, ref);
  }
  return null;
}

function to24(h, m, suffix) {
  let hour = Number(h) % 12;
  if (suffix.toLowerCase() === 'pm') hour += 12;
  return hour * 60 + Number(m || 0);
}

function hhmm(min) {
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
}

export function findTime(line) {
  const t = line.match(TIME_RE);
  return t ? hhmm(to24(t[1], t[2], t[3])) : null;
}

// ---------- class times ----------

/** "MW", "TTh", "T/Th", "Mon/Wed", "Mondays & Wednesdays" → [1, 3] etc. */
export function parseDays(text) {
  const days = new Set();
  const words = text.toLowerCase().match(/\b(mon|tue|wed|thu|fri)[a-z]*/g);
  if (words) {
    for (const w of words) days.add({ mon: 1, tue: 2, wed: 3, thu: 4, fri: 5 }[w.slice(0, 3)]);
    return [...days].sort();
  }
  const compact = text.match(/\b(?:M|T|W|Th|TH|R|F)(?:\s*\/?\s*(?:M|T|W|Th|TH|R|F))*\b/g);
  if (!compact) return [];
  const token = compact.at(-1).replace(/[\s/]/g, '');
  for (let i = 0; i < token.length; i++) {
    const c = token[i];
    if (c === 'T' && /[hH]/.test(token[i + 1] ?? '')) { days.add(4); i++; continue; }
    const d = { M: 1, T: 2, W: 3, R: 4, F: 5 }[c];
    if (d) days.add(d);
  }
  return [...days].sort();
}

export function findMeeting(lines) {
  const scored = [];
  lines.forEach((line, index) => {
    if (/office|zoom|hours|tutoring|review session|exam/i.test(line)) return;
    const r = line.match(RANGE_RE);
    if (!r) return;
    const before = line.slice(Math.max(0, r.index - 50), r.index);
    const days = parseDays(before);
    if (!days.length) return;
    let end = to24(r[4], r[5], r[6]);
    let start = to24(r[1], r[2], r[3] ?? r[6]);
    if (!r[3] && start >= end) start -= 12 * 60;
    if (start < 7 * 60 || end <= start) return;
    const hint = /class|meet|day ?& ?time|lecture|section|\b\d{5}\b/i.test(line) ? 0 : 1;
    scored.push({ hint, index, meeting: { days, start: hhmm(start), end: hhmm(end), source: line } });
  });
  scored.sort((a, b) => a.hint - b.hint || a.index - b.index);
  return scored[0]?.meeting ?? null;
}

// ---------- course code ----------

export function findCode(lines) {
  for (const line of lines.slice(0, 40)) {
    const m = line.match(/\b([A-Z]{1,3}(?: [A-Z])?)\s?(\d{3}[A-Z]?)\b/);
    if (m && !/^(UTC|RRH|GSB|CBA|SZB|PAR|WAG|ROOM|FAC)$/.test(m[1])) {
      const code = `${m[1]} ${m[2]}`;
      let name = line.slice(m.index + m[0].length)
        .replace(/\b\d{5}\b/g, '')
        .replace(/[-–:|,]+/g, ' ')
        .replace(/\s+/g, ' ')
        .replace(/simple syllabus|syllabus|spring|fall|summer|\b20\d\d\b/gi, '')
        .trim();
      if (name.length < 4 || name.length > 60 || /\d{1,2}:\d{2}|#/.test(name) || !/\s/.test(name)) name = '';
      if (name && name === name.toUpperCase()) {
        name = name.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
      }
      return { code, name };
    }
  }
  return { code: '', name: '' };
}

// ---------- weights ----------

function meaningful(label) {
  const stripped = label
    .replace(MONTH_RE, ' ')
    .replace(WEEKDAY_WORDS, ' ')
    .replace(/\b\d{1,2}(:\d{2})?\s*(am|pm)\b/gi, ' ')
    .replace(/\b(at|varies|pts?|points|each|total|of grade|weight)\b/gi, ' ')
    .replace(/[^a-z]/gi, '');
  return stripped.length >= 3;
}

function tidyLabel(label) {
  return clean(label
    .replace(/^(?:[^\w(]|o\s)+/, '')
    .replace(MONTH_RE, ' ')
    .replace(WEEKDAY_WORDS, ' ')
    .replace(/\bat\s+\d{1,2}(:\d{2})?\s*(am|pm)\b/gi, ' ')
    .replace(/\b\d+\s*\(\s*\d+\s*pts?\s*each\s*\)/gi, ' ')
    .replace(/\bvaries\b/gi, ' ')
    .replace(/(\s\d{2,}(\.\d+)?)+\s*$/, '') // points columns, not "Exam 1"
    .replace(/[\s:=.\-–([]+$/, '')
    .replace(/\((?:during|in) class(?: time)?\)/gi, '')
    .replace(/\(\s*\)/g, ''));
}

/** Every line that looks like "Label … 20%" (or "20% Label"). */
export function weightCandidates(lines, ref) {
  const out = [];
  lines.forEach((raw, index) => {
    const line = clean(raw);
    if (!line.includes('%')) return;
    if (/\d+(\.\d+)?\s*%?\s*[-–]\s*\d+(\.\d+)?\s*%/.test(line)) return; // a grade-scale range
    let label;
    let value;
    let m = line.match(/^(.*?)[\s:=\-–.([]*(\d{1,3}(?:\.\d+)?)\s*%\s*[)\]]?\s*$/);
    if (m) {
      label = m[1];
      value = Number(m[2]);
    } else if ((m = line.match(/^(?:[^\w%]|o\s)*(\d{1,3}(?:\.\d+)?)\s*%\s+(.+)$/))) {
      value = Number(m[1]);
      label = m[2];
    } else {
      return;
    }
    if (value <= 0 || value > 100) return;
    const isTotal = /^\s*total\b/i.test(label);
    const tidy = tidyLabel(label);
    if (!isTotal && (LETTER_GRADE.test(tidy) || NOT_A_WEIGHT.test(line))) return;
    const each = raw.match(/(\d+)\s*\(\s*(\d+)\s*pts?\s*each\s*\)/i);
    const count = each ? Number(each[1]) / Number(each[2]) : Number(tidy.match(/\((\d+)\)/)?.[1] ?? 0) || null;
    out.push({
      index,
      value,
      isTotal,
      label: tidy.replace(/\s*\(\d+\)\s*/, ' ').trim(),
      hasLabel: meaningful(label),
      count,
      date: findDate(label, ref),
      time: findTime(label),
    });
  });
  return out;
}

/**
 * Finds the grade breakdown: consecutive weight lines (a few lines apart at
 * most) that add up to 100.
 */
export function findWeights(lines, ref) {
  const cands = weightCandidates(lines, ref);
  const runs = [];
  let run = [];
  for (const c of cands) {
    if (run.length && (c.index - run.at(-1).index > 4 || run.at(-1).isTotal)) {
      runs.push(run);
      run = [];
    }
    run.push(c);
  }
  if (run.length) runs.push(run);

  // The first stretch that adds up to exactly 100 wins. Starting anywhere in
  // the run also handles "40% Participation" followed by its 10 + 15 + 15.
  for (const r of runs) {
    const flat = r.filter((c) => !c.isTotal);
    for (let i = 0; i < flat.length; i++) {
      let sum = 0;
      for (let j = i; j < flat.length; j++) {
        sum += flat[j].value;
        if (Math.abs(sum - 100) < 0.6 && j > i) return withLabels(flat.slice(i, j + 1), lines);
        if (sum > 100.6) break;
      }
    }
  }
  return [];
}

// A table row can wrap: "Weekly group activities" / "Most Thursdays…" / "90 (10 pts each) 22.5%".
// When the % line has no real label, use the first line after the previous row.
// When none of them have labels, the PDF split the table into columns: the
// labels are the lines right after the percentages, in the same order.
function withLabels(found, lines) {
  if (found.every((c) => !c.hasLabel)) {
    const labels = [];
    for (let i = found.at(-1).index + 1; i < lines.length && labels.length < found.length; i++) {
      const l = clean(lines[i]);
      if (!l || l.includes('%') || /^(assignment|category|item|weight|total|component)s?$/i.test(l) || /^_?bonus_?$/i.test(l)) continue;
      if (!meaningful(l)) continue;
      labels.push(tidyLabel(l));
    }
    return labels.length === found.length ? found.map((c, k) => ({ ...c, label: labels[k], guessedLabel: true })) : found;
  }
  return found.map((c, k) => {
    if (c.hasLabel) return c;
    const from = k > 0 ? found[k - 1].index + 1 : Math.max(0, c.index - 2);
    for (let i = from; i < c.index; i++) {
      const l = clean(lines[i]);
      if (l && meaningful(l) && !l.includes('%')) return { ...c, label: tidyLabel(l), guessedLabel: true };
    }
    return c;
  });
}

// ---------- exams with dates ----------

const EXAM_RE = /\b(mid-?term(?:\s+exam)?(?:\s+(?:\d|I{1,3}|IV))?|final(?:\s+exam)?|exam(?:\s+(?:\d|I{1,3}|IV))?|test\s+\d)\b/i;

export function normalizeName(name) {
  return clean(name)
    .replace(/\bIII\b/, '3').replace(/\bII\b/, '2').replace(/\bIV\b/, '4').replace(/\bI\b/, '1')
    .replace(/^./, (c) => c.toUpperCase());
}

export function findExams(lines, ref) {
  const exams = new Map();
  for (const raw of lines) {
    const line = clean(raw);
    if (/review|catch up|study guide|office|posted|policy|makeup|make-up|conflict/i.test(line)) continue;
    const m = line.match(EXAM_RE);
    if (!m) continue;
    const date = findDate(line, ref);
    if (!date) continue;
    const name = normalizeName(m[1].replace(/-/g, ''));
    if (/^Final$/i.test(name) && !/exam/i.test(line)) continue;
    const key = name.toLowerCase();
    if (!exams.has(key)) exams.set(key, { name, kind: 'exam', date, time: findTime(line), source: line });
  }
  return [...exams.values()];
}

// ---------- drop lowest ----------

const WORD_NUM = { one: 1, two: 2, three: 3, four: 4 };

export function findDrops(text) {
  const drops = [];
  const re = /drop(?:s|ped)?\s+(?:your|the|each\s+student'?s?)?\s*(?:(\w+)\s+)?lowest\s+(?:(\w+)\s+)?(quiz|quizzes|lab|labs|homework|assignment|assignments|poll|polls|reflection|reflections|exercise|exercises|exam|exams|midterm|midterms|test|tests)/gi;
  for (const m of text.matchAll(re)) {
    const word = (m[1] ?? m[2] ?? 'one').toLowerCase();
    drops.push({ kind: kindFor(m[3]), what: m[3].toLowerCase(), n: WORD_NUM[word] ?? (Number(word) || 1), source: quoteAround(text, m.index) });
  }
  return drops;
}

// ---------- the fine print ----------

/** The sentence around a position, to show as "from your syllabus". */
export function quoteAround(text, index) {
  const before = text.slice(Math.max(0, index - 200), index);
  const boundary = Math.max(before.lastIndexOf('. '), before.lastIndexOf('! '), before.lastIndexOf('? '));
  let start;
  if (boundary >= 0) {
    start = index - before.length + boundary + 2;
  } else {
    // No sentence start nearby (a table right above, say): back up to the
    // capitalized word that opens this phrase, and no further.
    const cap = before.slice(-30).search(/[A-Z][a-z']*\s[^A-Z]*$/);
    start = cap >= 0 ? index - Math.min(30, before.length) + cap : index;
  }
  const endDot = text.indexOf('. ', index);
  const ends = [endDot + 1, index + 240, text.length].filter((e) => e > index);
  return clean(text.slice(start, Math.min(...ends)));
}

const RULES = [
  {
    key: 'noRounding',
    re: /\b(?:not|no|never|won'?t|will not)\s+(?:be\s+)?round(?:ed|ing)?\b|\bno rounding\b/i,
  },
  {
    key: 'roundAt',
    re: /decimals?\s+(?:will\s+be\s+|are\s+)?rounded\s+up\s+at\s+0?\.5|(\d{2})\.5\s*%?\s*(?:=|→|->|becomes|will be|rounds?(?: up)? to)\s*(\d{2})\s*%?|\brounded?\s+(?:up\s+)?to\s+the\s+nearest\s+(?:whole|integer)|\bround(?:s|ed)?\s+up\s+(?:at|from)\s+(?:0?\.5|\d+\.5)/i,
    value: () => 0.5,
  },
  {
    key: 'finalReplacesLowest',
    re: /final(?:\s+exam)?(?:\s+score|\s+grade)?\s+(?:will|can|may)?\s*(?:replace|substitute\s+for|count\s+in\s+place\s+of)s?\s+(?:your|the)?\s*lowest|(?:replace|drop)s?\s+(?:your|the)\s+lowest\s+(?:midterm|exam|test)(?:\s+score)?\s+with\s+(?:your|the)\s+final/i,
    value: () => true,
  },
  {
    key: 'passExams',
    re: /(?:must|need\s+to)\s+(?:earn|have|achieve|get|maintain|pass\s+with)\s+(?:an?\s+)?(?:average\s+(?:of\s+)?)?(?:at\s+least\s+)?(\d{2})\s*%?\s*(?:or\s+(?:higher|better|above)\s+)?(?:average\s+)?on\s+(?:the\s+|your\s+)?(?:exams|tests)|exam\s+average\s+(?:of|must\s+be)\s+(?:at\s+least\s+)?(\d{2})/i,
    value: (m) => Number(m[1] ?? m[2]),
  },
  {
    key: 'extraCreditMax',
    re: /extra\s+credit\s+(?:is\s+|will\s+be\s+)?(?:worth\s+)?(?:up\s+to\s+|a\s+maximum\s+of\s+|at\s+most\s+)?(?:an?\s+)?(\d+(?:\.\d+)?)\s*(?:%|percent|points?)|(?:earn|receive)\s+up\s+to\s+(\d+(?:\.\d+)?)\s*(?:%|percent|points?)\s+(?:of\s+)?extra\s+credit/i,
    value: (m) => Number(m[1] ?? m[2]),
  },
];

/** Syllabus rules that change the math, each with the sentence it came from. */
export function findRules(text) {
  const flat = text.replace(/\s+/g, ' ');
  const rules = {};
  const sources = {};
  for (const rule of RULES) {
    const m = flat.match(rule.re);
    if (!m) continue;
    if (rule.key === 'noRounding') {
      sources.noRounding = quoteAround(flat, m.index);
      continue;
    }
    rules[rule.key] = rule.value(m);
    sources[rule.key] = quoteAround(flat, m.index);
  }
  if (sources.noRounding) delete rules.roundAt;
  return { rules, sources };
}

/**
 * "You only need 85% of the participation points to receive full credit" or
 * "you can miss up to 15% of the points": returns [{ threshold, about, source }].
 */
export function findFullCredit(text) {
  const flat = text.replace(/\s+/g, ' ');
  const out = [];
  const re = /(?:only\s+need\s+(?:to\s+(?:get|earn)\s+)?(?:at\s+least\s+)?(\d{2})\s*%\s+of\s+the|(?:allowed\s+to\s+)?miss\s+up\s+to\s+(\d{1,2})\s*%\s+of\s+the)\s+([^.]{0,80}?)points?[^.]{0,80}?full\s+credit(?:\s+for\s+([a-z/ -]+))?/gi;
  for (const m of flat.matchAll(re)) {
    const threshold = m[1] ? Number(m[1]) : 100 - Number(m[2]);
    const about = `${m[3] ?? ''} ${m[4] ?? ''}`.toLowerCase();
    out.push({ threshold, about, source: quoteAround(flat, m.index) });
  }
  return out;
}

const LETTERS = ['A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D+', 'D', 'D-'];

/** A grading scale printed in the syllabus ("A 93–100", "92.5–100% A", "A: 90+"). */
export function findScale(lines) {
  const found = new Map();
  let source = null;
  const forward = /(?<![A-Za-z0-9+-])([A-D][+-]?)\s*[:=]?\s*\(?(\d{2}(?:\.\d+)?)\s*%?\s*(?:[-–—]\s*\d{2,3}(?:\.\d+)?\s*%?|\+|and above|or (?:higher|above|more))/g;
  const backward = /(\d{2}(?:\.\d+)?)\s*%?\s*[-–—]\s*\d{2,3}(?:\.\d+)?\s*%?\s*[:=]?\s*([A-D][+-]?)(?=\s|$|[|,;)])/g;
  for (const raw of lines) {
    const line = clean(raw);
    for (const m of line.matchAll(forward)) {
      if (!found.has(m[1])) found.set(m[1], Number(m[2]));
      source ??= line;
    }
    for (const m of line.matchAll(backward)) {
      if (!found.has(m[2])) found.set(m[2], Number(m[1]));
      source ??= line;
    }
  }
  const letters = LETTERS.filter((l) => found.has(l));
  if (!letters.includes('A') || letters.length < 4) return null;
  const mins = letters.map((l) => found.get(l));
  if (mins.some((v, i) => v < 50 || v > 100 || (i > 0 && v >= mins[i - 1]))) return null;
  return { scale: [...letters.map((l) => [l, found.get(l)]), ['F', 0]], source };
}

// ---------- all together ----------

/**
 * Returns the same shape the AI reader returns, so both go through the same
 * checks in toCourse():
 * { code, name, meetings: [{days, start, end}], categories: [{name, weight, count, dropLowest, kind, date, time}],
 *   items: [{name, kind, date, time}] }
 */
export function parseSyllabus(text, { ref }) {
  const lines = text.split(/\r?\n/);
  const cleaned = lines.map(clean);
  const { code, name } = findCode(cleaned.filter(Boolean));
  const meeting = findMeeting(cleaned);
  const drops = findDrops(text.replace(/\s+/g, ' '));
  const fullCredit = findFullCredit(text);
  const { rules, sources } = findRules(text);
  const scale = findScale(lines);
  if (scale) sources.scale = scale.source;
  if (meeting) sources.meetings = meeting.source;

  const categories = findWeights(lines, ref).map((c) => {
    const kind = kindFor(c.label);
    const lower = c.label.toLowerCase();
    const drop = drops.find((d) => d.kind === kind || lower.includes(d.what.replace(/s$/, '')));
    const full = fullCredit.find((f) => lower.split(/[^a-z]+/).some((w) => w.length > 3 && f.about.includes(w))
      || (kind === 'participation' && /participation|attendance/.test(f.about)));
    return {
      name: c.label,
      weight: c.value,
      count: c.count,
      dropLowest: drop?.n ?? 0,
      fullCreditAt: full?.threshold,
      kind,
      date: c.date,
      time: c.time,
      check: c.guessedLabel || undefined,
      source: { weight: clean(lines[c.index]), dropLowest: drop?.source, fullCreditAt: full?.source },
    };
  });
  return {
    code,
    name,
    meetings: meeting ? [{ days: meeting.days, start: meeting.start, end: meeting.end }] : [],
    categories,
    items: findExams(lines, ref),
    rules,
    sources,
    scale: scale?.scale,
  };
}
