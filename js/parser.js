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
    scored.push({ hint, index, meeting: { days, start: hhmm(start), end: hhmm(end) } });
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
    return labels.length === found.length ? found.map((c, k) => ({ ...c, label: labels[k] })) : found;
  }
  return found.map((c, k) => {
    if (c.hasLabel) return c;
    const from = k > 0 ? found[k - 1].index + 1 : Math.max(0, c.index - 2);
    for (let i = from; i < c.index; i++) {
      const l = clean(lines[i]);
      if (l && meaningful(l) && !l.includes('%')) return { ...c, label: tidyLabel(l) };
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
    if (!exams.has(key)) exams.set(key, { name, kind: 'exam', date, time: findTime(line) });
  }
  return [...exams.values()];
}

// ---------- drop lowest ----------

const WORD_NUM = { one: 1, two: 2, three: 3, four: 4 };

export function findDrops(text) {
  const drops = [];
  const re = /drop(?:s|ped)?\s+(?:your|the|each\s+student'?s?)?\s*(?:(\w+)\s+)?lowest\s+(?:(\w+)\s+)?(quiz|quizzes|lab|labs|homework|assignment|assignments|poll|polls|reflection|reflections|exercise|exercises)/gi;
  for (const m of text.matchAll(re)) {
    const word = (m[1] ?? m[2] ?? 'one').toLowerCase();
    drops.push({ kind: kindFor(m[3]), what: m[3].toLowerCase(), n: WORD_NUM[word] ?? (Number(word) || 1) });
  }
  return drops;
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
  const { code, name } = findCode(lines.map(clean).filter(Boolean));
  const meeting = findMeeting(lines.map(clean));
  const drops = findDrops(text.replace(/\s+/g, ' '));
  const categories = findWeights(lines, ref).map((c) => {
    const kind = kindFor(c.label);
    const drop = drops.find((d) => d.kind === kind || c.label.toLowerCase().includes(d.what.replace(/s$/, '')));
    return {
      name: c.label,
      weight: c.value,
      count: c.count,
      dropLowest: drop?.n ?? 0,
      kind,
      date: c.date,
      time: c.time,
    };
  });
  return {
    code,
    name,
    meetings: meeting ? [meeting] : [],
    categories,
    items: findExams(lines, ref),
  };
}
