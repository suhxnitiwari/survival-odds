import { WEEKDAYS, addDays, formatTime, parseTime, prettyDate, shortDate, todayLocal, toTimeInput } from './dates.js';
import {
  DEFAULT_SCALE, ODDS, categoryPace, describeRules, examAverage, finalTable, formatScore, isGraded, itemWeights, oddsFor, pickFinal,
  projectGrade, summarize, verdict,
} from './grades.js';
import { DEFAULT_PREFS, RULES, planStudy, upcomingExams } from './planner.js';
import { buildCalendar } from './ics.js';
import { wrapped } from './stats.js';
import { drawCard } from './card.js';
import { sampleSemester } from './sample.js';
import { load, save, clear, loadReader, saveReader } from './store.js';
import { parseSyllabus } from './parser.js';
import { toCourse } from './importer.js';
import { DEFAULT_MODEL, readWithGemini } from './ai.js';
import { pdfText } from './pdf.js';
import { POINTS, cumulativeGpa, formatGpa, pointsFor, semesterGpa } from './gpa.js';

const PALETTE = ['#d6336c', '#7048e8', '#0c8599', '#e8590c', '#2f9e44', '#1971c2', '#ae3ec9', '#f08c00'];
const KINDS = ['exam', 'quiz', 'homework', 'project', 'paper', 'participation'];
const TABS = ['grades', 'gpa', 'plan', 'wrapped', 'classes'];

const app = document.getElementById('app');
const today = todayLocal();
// ?example shows the made-up semester without touching anything you saved.
const exampleMode = new URLSearchParams(location.search).has('example');
let state = exampleMode ? sampleSemester(today) : load() ?? { courses: [], busy: [], prefs: {}, semester: null };
let tab = TABS.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'grades';
let reader = { mode: 'builtin', apiKey: '', model: DEFAULT_MODEL, ...loadReader() };
let imports = []; // syllabi being read or waiting for review (not saved)
let pasteText = '';
let draft = null; // the quick "type your categories in" form, before it becomes a class

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const uid = () => Math.random().toString(36).slice(2, 9);
const courseById = (id) => state.courses.find((c) => c.id === id);

function persist() {
  if (!exampleMode) save(state);
}

// ---------- rendering ----------

function render() {
  // Keep focus and cursor on the same field across re-renders.
  const active = document.activeElement;
  const focusPath = active?.dataset?.path;
  const caret = active && 'selectionStart' in active ? safe(() => active.selectionStart) : null;
  const opened = new Map([...app.querySelectorAll('details[data-key]')].map((d) => [d.dataset.key, d.open]));

  document.querySelectorAll('#tabs button').forEach((b) => b.setAttribute('aria-current', b.dataset.tab === tab ? 'page' : 'false'));
  renderTopActions();

  if (!state.courses.length && tab !== 'classes') {
    app.innerHTML = emptyState();
  } else {
    app.innerHTML = { grades: renderGrades, gpa: renderGpa, plan: renderPlan, wrapped: renderWrapped, classes: renderClasses }[tab]();
  }
  if (tab === 'wrapped' && state.courses.length) paintCard();
  app.querySelectorAll('details[data-key]').forEach((d) => {
    if (opened.has(d.dataset.key)) d.open = opened.get(d.dataset.key);
  });

  if (focusPath) {
    const el = app.querySelector(`[data-path="${CSS.escape(focusPath)}"]`);
    if (el) {
      el.focus();
      if (caret !== null) safe(() => el.setSelectionRange(caret, caret));
    }
  }
}

function safe(fn) {
  try { return fn(); } catch { return null; }
}

function renderTopActions() {
  if (exampleMode) {
    document.getElementById('top-actions').innerHTML = '<span class="tiny muted">Made-up example · nothing is saved</span> <a class="primary" href="./">Use my own classes</a>';
    return;
  }
  document.getElementById('top-actions').innerHTML = state.courses.length
    ? `<button class="ghost" data-action="sample">Example</button>
       <button class="ghost" data-action="reset">Start over</button>`
    : '';
}

function emptyState() {
  return `
    <section class="hero">
      <p class="hero-kicker">✦ for the week-before-finals version of you</p>
      <h2>What do I need on the final?</h2>
      <p>Upload your syllabi and I'll pull out the grade weights, class times and exam dates. Then enter grades as they come back, and I'll tell you exactly what you need, plan your studying around your schedule, and wrap up the whole semester in one card.</p>
      ${dropzone('hero-drop')}
      <div class="hero-actions">
        <button class="ghost" data-action="sample">Try it with a made-up semester</button>
        <button class="ghost" data-action="start">Type in my grade weights</button>
      </div>
    </section>`;
}

/** The upload box: drop or click, what it takes, and where the file goes. */
function dropzone(extra = '') {
  return `<label class="drop ${extra}" data-role="drop">
      <input type="file" accept="application/pdf,.pdf,.txt,text/plain" multiple data-role="syllabus-file">
      <span class="drop-main"><b>Drop your syllabus PDFs here</b> or click to choose</span>
      <span class="drop-meta">PDF or .txt, as many as you have · or paste the text</span>
    </label>
    <p class="privacy">${reader.mode === 'gemini'
      ? '<b>Gemini is on:</b> the syllabus text goes to Google to be read. Your grades still stay here.'
      : '<b>Private:</b> read right here in your browser. Nothing is uploaded, no account.'}</p>`;
}

// ---------- sources ----------

/** "from your syllabus": the exact line a number came from, one tap away. */
function sourceTag(quote, check = false) {
  if (!quote) return check ? '<span class="check">check this</span>' : '';
  return `<details class="src"><summary>${check ? '<span class="check">check this</span> ' : ''}from your syllabus</summary><q>${esc(quote)}</q></details>`;
}

function rulesList(course) {
  const rules = describeRules(course);
  if (!rules.length) return '';
  return `<ul class="rules-list">${rules.map((r) => `<li><span>✦ ${esc(r.text)}</span>${sourceTag(r.source)}</li>`).join('')}</ul>`;
}

// ---------- The final ----------

function passWarning(course) {
  const min = course.rules?.passExams;
  const avg = examAverage(course);
  if (!min || avg === null || avg >= min) return '';
  return `<p class="warn">Your exam average is ${formatScore(avg)}, and this class needs ${min} on the exams to pass. That matters more than the letter above.</p>`;
}

function renderGrades() {
  return `<div class="stack">${state.courses.map(gradeCard).join('')}</div>`;
}

function gradeCard(course) {
  const ci = state.courses.indexOf(course);
  const s = summarize(course);
  const scale = course.scale ?? DEFAULT_SCALE;
  const target = course.target ?? 'A';
  const table = finalTable(course, whatIfOf(course));
  const final = pickFinal(course);
  const open = course.items.filter((i) => !isGraded(i));
  const weights = itemWeights(course);

  return `
  <article class="card" style="--c:${course.color}" data-card="${course.id}">
    <header class="card-head">
      <div>
        <h2><span class="dot"></span>${esc(course.code)}</h2>
        <p class="muted">${esc(course.name)}</p>
      </div>
      <div class="now">
        <span class="now-num">${s.current === null ? '—' : formatScore(s.current)}</span>
        <span class="now-letter">${s.letter ?? 'no grades yet'}</span>
      </div>
    </header>

    <div class="progress" title="${Math.round(s.graded * 100)}% of the grade is in">
      <span style="width:${s.graded * 100}%"></span>
    </div>
    <p class="tiny muted">${Math.round(s.graded * 100)}% of your grade is in · ${Math.round(s.remaining * 100)}% still ahead</p>

    <div class="final-box">
      <div class="final-controls">
        <label>Aiming for
          <select data-path="courses.${ci}.target">
            ${scale.filter(([, c]) => c > 0).map(([l]) => `<option ${l === target ? 'selected' : ''}>${l}</option>`).join('')}
          </select>
        </label>
        ${open.length ? `<label>What do I need on
          <select data-path="courses.${ci}.finalId">
            ${open.map((i) => `<option value="${i.id}" ${final?.id === i.id ? 'selected' : ''}>${esc(i.name)} (${Math.round((weights.get(i.id)?.weight ?? 0) * 100)}%)</option>`).join('')}
          </select></label>` : ''}
      </div>
      <div data-result="${course.id}">${finalResult(course, table)}</div>
    </div>

    ${playPanel(course)}

    ${passWarning(course)}
    ${describeRules(course).length ? `
    <details class="fine-print" data-key="rules-${course.id}">
      <summary>Syllabus rules <small class="muted">(${describeRules(course).length}, already in the math)</small></summary>
      ${rulesList(course)}
      ${course.rules?.extraCreditMax ? `<label class="inline">Extra credit you've earned
        <input type="number" min="0" step="0.5" max="${course.rules.extraCreditMax}" value="${course.extraCredit ?? ''}" placeholder="0" data-path="courses.${ci}.extraCredit" data-type="optnumber"> points</label>` : ''}
    </details>` : ''}

    <details class="scale-card" data-key="scale-${course.id}">
      <summary>How this class grades <small class="muted">(an A starts at ${(course.scale ?? DEFAULT_SCALE).find(([l]) => l === 'A')?.[1] ?? '—'})</small></summary>
      ${scaleEditor(course.scale ?? DEFAULT_SCALE, ci)}
    </details>

    <details class="ladder" data-key="ladder-${course.id}">
      <summary>Every letter</summary>
      <div class="ladder-grid" data-ladder="${course.id}">${ladder(course, table)}</div>
    </details>

    <details class="entry" data-key="entry-${course.id}" ${!course.items.some(isGraded) || open.some((i) => i.date && i.date < today) ? 'open' : ''}>
      <summary>Your scores <small class="muted">(type one in when it comes back)</small></summary>
      <ul class="entry-list">
        ${course.items.map((item, ii) => `
          <li class="${!isGraded(item) && item.date && item.date < today ? 'due' : ''} ${isGraded(item) ? 'is-in' : ''}">
            <span>${esc(item.name)} <small class="muted">${item.date ? shortDate(item.date) : ''}</small></span>
            <span class="score"><input type="number" inputmode="decimal" step="any" min="0" placeholder="—" value="${isGraded(item) ? item.earned : ''}" data-path="courses.${ci}.items.${ii}.earned" data-type="score" aria-label="${esc(item.name)} score"> / ${item.possible}</span>
          </li>`).join('')}
      </ul>
    </details>
  </article>`;
}

function ladder(course, table) {
  const target = course.target ?? 'A';
  return table.map((r) => `<div class="rung ${r.letter === target ? 'is-target' : ''} ${r.needed !== null && r.needed > 100 ? 'is-out' : ''}">
    <b>${r.letter}</b><span>${r.needed === null ? '—' : r.needed <= 0 ? 'locked ✓' : formatScore(Math.ceil(r.needed * 10) / 10)}</span></div>`).join('');
}

/** The big number, its one-liner, and the survival gauge. Patched live while the what-if slider moves. */
function finalResult(course, table = finalTable(course, whatIfOf(course))) {
  const s = summarize(course);
  const target = course.target ?? 'A';
  const row = table.find((r) => r.letter === target) ?? table[0];
  const best = table.find((r) => r.needed !== null && r.needed <= 100);
  if (row.needed === null) {
    return `<div class="big">${s.current === null ? '—' : formatScore(s.current)}</div>
      <p class="verdict">${verdict(null)}</p>`;
  }
  const n = Math.ceil(row.needed * 10) / 10;
  const odds = oddsFor(n);
  return `<div class="big ${n <= 0 ? 'chill' : odds.key}">${n <= 0 ? '✓' : formatScore(n)}</div>
    <p class="verdict">${esc(verdict(row.needed, target, best && best.letter !== target ? best.letter : null))}</p>
    ${gauge(n)}
    ${letterRow(course, table)}`;
}

/** A, B, C, D side by side: "what do I need on this for a C? a B? an A?" Tap one to aim for it. */
function letterRow(course, table) {
  const target = course.target ?? 'A';
  const item = pickFinal(course);
  const rows = table.filter((r) => /^[A-D]$/.test(r.letter));
  if (rows.length < 2) return '';
  const ci = state.courses.indexOf(course);
  return `<div class="letters">
      <p class="tiny muted">On ${item ? esc(item.name) : 'what\'s left'}, you need</p>
      <div class="letter-row">${rows.map((r) => {
        const n = r.needed === null ? null : Math.ceil(r.needed * 10) / 10;
        const text = n === null ? '—' : n <= 0 ? 'locked' : n > 100 ? 'out of reach' : formatScore(n);
        const key = n === null ? '' : n <= 0 ? 'chill' : oddsFor(n).key;
        return `<button class="letter ${r.letter === target ? 'is-target' : ''}" data-action="set-target" data-course="${ci}" data-letter="${r.letter}" aria-pressed="${r.letter === target}">
          <b>${r.letter}</b><span class="odds-${key}">${text}</span></button>`;
      }).join('')}</div>
    </div>`;
}

/** 0–100 on the final, split into the ODDS bands, with a marker at what you need. */
function gauge(n) {
  const at = Math.max(0, Math.min(100, n));
  const odds = n <= 0 ? ODDS[0] : oddsFor(n);
  let from = 0;
  const zones = ODDS.filter((b) => b.max <= 100).map((b) => {
    const z = { ...b, flex: b.max - from };
    from = b.max;
    return z;
  });
  return `<div class="gauge" role="img" aria-label="Survival odds: ${odds.label}">
      <div class="gauge-track">${zones.map((z) => `<span class="band band-${z.key}" style="flex:${z.flex}"></span>`).join('')}
        <b class="gauge-mark mark-${odds.key}" style="left:${n > 100 ? 100 : at}%"></b></div>
      <div class="gauge-zones">${zones.map((z) => `<span class="${z.key === odds.key ? `odds-${z.key}` : ''}" style="flex:${z.flex}">${z.label}</span>`).join('')}</div>
      ${n > 100 ? '<p class="gauge-label odds-out">Out of reach, even with a 100</p>' : ''}
    </div>`;
}

// ---------- drag to see where you land ----------
//
// One slider per category that still has work left (what you average on the
// rest of it) and one for the final. course.whatIf = { [categoryId]: 0–100 },
// course.finalGuess = { id, value } for whichever item is "the final" right now.
// A slider you haven't touched sits at your pace.

const FINAL_KEY = '__final';
const whatIfOf = (course) => (course.whatIf && typeof course.whatIf === 'object' ? course.whatIf : {});

function playRows(course) {
  const s = summarize(course);
  const final = pickFinal(course);
  const weights = itemWeights(course);
  const pace = (catId) => Math.round(categoryPace(course, catId) ?? s.current ?? 85);
  const wi = whatIfOf(course);
  const rows = [];
  for (const cat of course.categories) {
    const left = course.items.filter((i) => i.category === cat.id && !isGraded(i) && i.id !== final?.id && (weights.get(i.id)?.weight ?? 0) > 0);
    if (!left.length) continue;
    const share = Math.round(left.reduce((sum, i) => sum + weights.get(i.id).weight, 0) * 100);
    rows.push({
      key: cat.id,
      name: cat.name,
      note: `${left.length > 1 ? `${left.length} left · ` : left[0].name !== cat.name ? `${esc(left[0].name)} · ` : ''}${share}% of your grade`,
      value: wi[cat.id] ?? pace(cat.id),
    });
  }
  if (final && (weights.get(final.id)?.weight ?? 0) > 0) {
    rows.push({
      key: FINAL_KEY,
      name: final.name,
      note: `${Math.round(weights.get(final.id).weight * 100)}% of your grade`,
      value: course.finalGuess?.id === final.id ? course.finalGuess.value : pace(final.category),
    });
  }
  return rows;
}

function playPanel(course) {
  const rows = playRows(course);
  if (!rows.length) return '';
  const touched = Object.keys(whatIfOf(course)).length || course.finalGuess?.id === pickFinal(course)?.id;
  return `<section class="play">
    <div class="play-head">
      <div>
        <h3>Drag to see where you land</h3>
        <p class="tiny muted">What you average on what's left. They start at your pace so far.</p>
      </div>
      <div class="play-out" data-proj="${course.id}">${projection(course)}</div>
    </div>
    ${rows.map((r) => `<div class="play-row">
      <div class="play-label">
        <label for="pl-${course.id}-${r.key}">${esc(r.name)} <small class="muted">${r.note}</small></label>
        <b data-v="${course.id}-${r.key}">${r.value}%</b>
      </div>
      <input id="pl-${course.id}-${r.key}" type="range" min="0" max="100" step="1" value="${r.value}" data-play-course="${course.id}" data-play-key="${r.key}">
      ${r.key === FINAL_KEY ? `<p class="tiny need-line" data-need="${course.id}">${needLine(course)}</p>` : ''}
    </div>`).join('')}
    ${touched ? `<button class="linkish tiny" data-action="reset-play" data-course="${state.courses.indexOf(course)}">Back to your pace</button>` : ''}
  </section>`;
}

/** Where the class ends up if the rest goes like the sliders say (untouched sliders are your pace). */
function landing(course) {
  const final = pickFinal(course);
  const finalRow = playRows(course).find((r) => r.key === FINAL_KEY);
  return projectGrade(course, whatIfOf(course), final?.id, finalRow ? finalRow.value : null);
}

/** Where the sliders say you finish. */
function projection(course) {
  const p = landing(course);
  const cutoff = (course.scale ?? DEFAULT_SCALE).find(([l]) => l === (course.target ?? 'A'))?.[1] ?? 0;
  return `<span class="proj-kicker">You'd finish with</span>
    <span class="proj-num ${p.grade >= cutoff - 1e-9 ? 'hit' : 'miss'}">${formatScore(p.grade)}</span>
    <span class="proj-letter">${p.letter}</span>`;
}

function needLine(course) {
  const target = course.target ?? 'A';
  const row = finalTable(course, whatIfOf(course)).find((r) => r.letter === target);
  if (!row || row.needed === null) return '';
  if (row.needed <= 0) return `${target} is locked in whatever you get.`;
  if (row.needed > 100) return `${target} is out of reach even with a 100.`;
  return `You need ${formatScore(Math.ceil(row.needed * 10) / 10)} here for ${/^[AEF]/.test(target) ? 'an' : 'a'} ${target}.`;
}

/** While a slider moves: update the numbers in place (a full re-render would drop the drag). */
function playLive(course) {
  const table = finalTable(course, whatIfOf(course));
  const set = (sel, html) => { const el = app.querySelector(sel); if (el) el.innerHTML = html; };
  set(`[data-result="${course.id}"]`, finalResult(course, table));
  set(`[data-ladder="${course.id}"]`, ladder(course, table));
  set(`[data-proj="${course.id}"]`, projection(course));
  set(`[data-need="${course.id}"]`, needLine(course));
}

// ---------- GPA ----------
//
// Each class counts at the letter it's headed for (the same projection as the
// sliders on The final), unless you pick a letter yourself. course.hours,
// course.gpaLetter (your pick), course.whatIfDrop; state.gpa = { prior, priorHours, aPlus }.

function gpaRow(course) {
  const headed = summarize(course).current === null ? null : landing(course).letter;
  return {
    course,
    headed,
    letter: course.gpaLetter || headed,
    hours: course.hours ?? 3,
    dropped: !!course.whatIfDrop,
  };
}

function renderGpa() {
  const g = state.gpa ?? {};
  const opts = { aPlus: g.aPlus ? 4.33 : 4 };
  const rows = state.courses.map(gpaRow);
  const sem = semesterGpa(rows, opts);
  const prior = { gpa: g.prior, hours: g.priorHours };
  const overall = cumulativeGpa(sem, prior);
  const hasPrior = Number(g.priorHours) > 0 && g.prior !== undefined;
  const without = (row) => semesterGpa(rows.map((r) => (r === row ? { ...r, dropped: true } : r)), opts);
  const delta = (a, b) => {
    if (a === null || b === null) return '';
    const d = Math.round((a - b) * 100) / 100;
    return d === 0 ? '<small class="muted">same</small>' : `<small class="${d > 0 ? 'ok' : 'bad'}">${d > 0 ? '+' : ''}${d.toFixed(2)}</small>`;
  };
  const anyMissing = rows.some((r) => !r.dropped && !r.letter);

  return `
  <div class="stack gpa">
    <section class="card gpa-hero">
      <div class="gpa-big">
        <span>This semester</span>
        <b>${formatGpa(sem.gpa)}</b>
        <small class="muted">${sem.hours} hour${sem.hours === 1 ? '' : 's'}${rows.some((r) => r.dropped) ? ` · after dropping ${rows.filter((r) => r.dropped).map((r) => esc(r.course.code)).join(', ')}` : ''}</small>
      </div>
      <div class="gpa-big">
        <span>Overall</span>
        <b>${hasPrior ? formatGpa(overall) : '—'}</b>
        <small class="muted">${hasPrior ? `${Number(g.priorHours) + sem.hours} hours with this semester` : 'Add your GPA so far below'}</small>
      </div>
      <div class="grid2 gpa-prior">
        <label>GPA so far <input type="number" inputmode="decimal" min="0" max="4.33" step="0.01" value="${g.prior ?? ''}" placeholder="3.50" data-path="gpa.prior" data-type="optnumber"></label>
        <label>Hours so far <input type="number" inputmode="numeric" min="0" step="1" value="${g.priorHours ?? ''}" placeholder="45" data-path="gpa.priorHours" data-type="optnumber"></label>
      </div>
      <p class="tiny muted">From your transcript, before this semester. Leave it empty for a semester GPA only.</p>
    </section>

    <section class="card">
      <h2>Your classes</h2>
      <p class="muted">Each class counts at the grade it's headed for (your sliders on The final). Pick a letter to try another, or drop a class to see what it does.</p>
      <div class="gpa-table">
        <div class="gpa-tr gpa-th"><span>Class</span><span>Hours</span><span>Grade</span><span>Without it</span><span>Drop</span></div>
        ${rows.map((r) => {
          const ci = state.courses.indexOf(r.course);
          const scale = (r.course.scale ?? DEFAULT_SCALE).map(([l]) => l).filter((l) => l in POINTS);
          const w = without(r);
          const p = pointsFor(r.letter, opts);
          return `<div class="gpa-tr ${r.dropped ? 'is-dropped' : ''}" style="--c:${r.course.color}">
            <span class="gpa-class"><span class="dot"></span><b>${esc(r.course.code)}</b>${r.dropped ? ' <small class="muted">dropped</small>' : ''}</span>
            <span class="unit"><input type="number" inputmode="numeric" min="0" max="6" step="1" value="${r.hours}" data-path="courses.${ci}.hours" data-type="number" aria-label="${esc(r.course.code)} credit hours"><small>hrs</small></span>
            <span class="gpa-grade">
              <select data-path="courses.${ci}.gpaLetter" aria-label="${esc(r.course.code)} grade">
                <option value="">${r.headed ? `Headed for ${r.headed}` : 'No grades yet'}</option>
                ${scale.map((l) => `<option value="${l}" ${r.course.gpaLetter === l ? 'selected' : ''}>${l}</option>`).join('')}
              </select>
              <small class="muted">${p === null ? 'pick a letter' : `${p.toFixed(2)} points`}</small>
            </span>
            <span class="gpa-without">${r.dropped ? '—' : `${formatGpa(w.gpa)} ${delta(w.gpa, sem.gpa)}`}</span>
            <span><label class="drop-toggle"><input type="checkbox" ${r.dropped ? 'checked' : ''} data-path="courses.${ci}.whatIfDrop" data-type="bool" aria-label="Drop ${esc(r.course.code)}"><span>Drop</span></label></span>
          </div>`;
        }).join('')}
      </div>
      ${anyMissing ? '<p class="tiny muted">Classes with no grades yet don\'t count until you pick a letter.</p>' : ''}
      ${sem.hours > 0 && sem.hours < 12 ? `<p class="warn">That's ${sem.hours} hours. At a lot of schools under 12 is part-time, which can affect financial aid, scholarships and visas. Check with your advisor before you drop.</p>` : ''}
      <label class="radio gpa-aplus"><input type="checkbox" ${g.aPlus ? 'checked' : ''} data-path="gpa.aPlus" data-type="bool"><span>My school counts an A+ as 4.33 <small class="muted">(most count it as 4.0)</small></span></label>
    </section>
  </div>`;
}

// ---------- Study plan ----------

function currentPlan() {
  const now = new Date();
  return planStudy({
    courses: state.courses,
    busy: state.busy,
    prefs: state.prefs,
    today,
    nowMinutes: now.getHours() * 60 + now.getMinutes(),
    semester: state.semester,
  });
}

function renderPlan() {
  const prefs = { ...DEFAULT_PREFS, ...state.prefs };
  const exams = upcomingExams(state.courses, today);
  const { blocks, shortfalls } = currentPlan();

  // Agenda: study blocks, exams and other deadlines, day by day.
  const days = new Map();
  const add = (date, entry) => {
    if (!days.has(date)) days.set(date, []);
    days.get(date).push(entry);
  };
  for (const b of blocks) add(b.date, { ...b, type: 'study', course: courseById(b.courseId) });
  const horizon = blocks.length ? blocks.at(-1).date : addDays(today, 14);
  for (const course of state.courses) {
    for (const item of course.items) {
      if (!item.date || item.date < today || item.date > horizon || isGraded(item)) continue;
      add(item.date, {
        type: item.kind === 'exam' ? 'exam' : 'due',
        start: item.time ? parseTime(item.time) : 24 * 60,
        label: `${course.code}: ${item.name}`,
        course,
      });
    }
  }
  const agenda = [...days.entries()].sort(([a], [b]) => (a < b ? -1 : 1));
  const totalHours = Math.round(blocks.reduce((s, b) => s + b.end - b.start, 0) / 60);

  return `
  <div class="plan-layout">
    <section class="card">
      <h2>Your study plan</h2>
      <p class="muted">${exams.length
        ? `${exams.length} exam${exams.length === 1 ? '' : 's'} ahead · ${blocks.length} sessions · ${totalHours} hours, worked backward from each exam and fit around your classes.`
        : 'No exams ahead. Add some in My classes (kind: exam) and I\'ll plan around them.'}</p>
      ${shortfalls.map((s) => `<p class="warn">Couldn't fit ${Math.round(s.missingMinutes / 60 * 10) / 10} more hours for ${esc(s.label)}. Loosen your study hours or start earlier.</p>`).join('')}
      ${blocks.length ? `<div class="row-actions">
        <button class="primary" data-action="ics-study">Add study blocks to my calendar</button>
        <button class="ghost" data-action="ics-deadlines">Add all deadlines</button>
      </div>` : ''}
      <ol class="agenda">
        ${agenda.map(([date, entries]) => `
          <li>
            <h3>${date === today ? 'Today' : date === addDays(today, 1) ? 'Tomorrow' : prettyDate(date)}</h3>
            <ul>
              ${entries.sort((a, b) => a.start - b.start).map((e) => `
                <li class="ev ev-${e.type}" style="--c:${e.course?.color ?? 'var(--accent)'}">
                  <span class="ev-time">${e.type === 'study' ? `${formatTime(e.start)}–${formatTime(e.end)}` : e.start < 24 * 60 ? formatTime(e.start) : 'due'}</span>
                  <span class="ev-label">${e.type === 'study' ? `Study · ${esc(e.label)} <small>${e.session} of ${e.sessions}</small>` : e.type === 'exam' ? `<b>${esc(e.label)}</b> ✦` : esc(e.label)}</span>
                </li>`).join('')}
            </ul>
          </li>`).join('')}
      </ol>
    </section>

    <aside class="stack">
      <section class="card">
        <h3>How much studying</h3>
        <ul class="exam-hours">
          ${exams.map(({ course, item, hours, weightPct }) => {
            const ci = state.courses.indexOf(course);
            const ii = course.items.indexOf(item);
            return `<li style="--c:${course.color}"><span><span class="dot"></span>${esc(course.code)} ${esc(item.name)} <small class="muted">${shortDate(item.date)} · ${Math.round(weightPct)}%</small></span>
              <span><input type="number" min="0" max="40" step="0.5" value="${hours}" data-path="courses.${ci}.items.${ii}.studyHours" data-type="number" aria-label="Hours for ${esc(item.name)}"> hrs</span></li>`;
          }).join('') || '<li class="muted">Nothing yet.</li>'}
        </ul>
      </section>

      <section class="card">
        <h3>When I can study</h3>
        <div class="grid2">
          <label>From <input type="time" value="${toTimeInput(prefs.dayStart)}" data-path="prefs.dayStart" data-type="minutes"></label>
          <label>Until <input type="time" value="${toTimeInput(prefs.dayEnd)}" data-path="prefs.dayEnd" data-type="minutes"></label>
          <label>Session length
            <select data-path="prefs.blockMinutes" data-type="number">
              ${[45, 60, 90, 120].map((m) => `<option value="${m}" ${m === prefs.blockMinutes ? 'selected' : ''}>${m} min</option>`).join('')}
            </select></label>
          <label>Max per day
            <select data-path="prefs.maxBlocksPerDay" data-type="number">
              ${[1, 2, 3, 4, 5].map((m) => `<option ${m === prefs.maxBlocksPerDay ? 'selected' : ''}>${m}</option>`).join('')}
            </select></label>
          <label>Start this many days out
            <select data-path="prefs.windowDays" data-type="number">
              ${[5, 7, 10, 14, 21].map((m) => `<option ${m === prefs.windowDays ? 'selected' : ''}>${m}</option>`).join('')}
            </select></label>
        </div>
      </section>

      <section class="card">
        <h3>Already busy</h3>
        <p class="tiny muted">Work, org meetings, Pilates. Classes are added automatically.</p>
        ${state.busy.map((b, bi) => `
          <div class="busy-row">
            <input value="${esc(b.label)}" data-path="busy.${bi}.label" aria-label="What">
            ${daysPicker(`busy.${bi}.days`, b.days)}
            <input type="time" value="${b.start}" data-path="busy.${bi}.start" aria-label="Starts">
            <input type="time" value="${b.end}" data-path="busy.${bi}.end" aria-label="Ends">
            <button class="x" data-action="del-busy" data-index="${bi}" aria-label="Remove">×</button>
          </div>`).join('')}
        <button class="ghost small" data-action="add-busy">+ Add something</button>
      </section>

      <section class="card rules">
        <h3>The rules</h3>
        <ul>${Object.values(RULES).map((r) => `<li>${esc(r.why)}</li>`).join('')}</ul>
      </section>
    </aside>
  </div>`;
}

function daysPicker(path, days) {
  return `<span class="days">${[1, 2, 3, 4, 5, 6, 0].map((d) => `
    <label class="day"><input type="checkbox" data-path="${path}" data-day="${d}" ${days.includes(d) ? 'checked' : ''}><span>${WEEKDAYS[d][0]}</span></label>`).join('')}</span>`;
}

// ---------- Wrapped ----------

function renderWrapped() {
  const w = wrapped({ semester: state.semester, courses: state.courses, blocks: currentPlan().blocks });
  return `
  <div class="wrapped-layout">
    <div class="card-frame"><canvas id="card" width="1080" height="1920" aria-label="Semester Wrapped card"></canvas></div>
    <section class="card">
      <h2>Semester Wrapped ✦</h2>
      <p class="muted">Screenshot it, post it, send it to the group chat that's in all the same classes.</p>
      <div class="row-actions">
        <button class="primary" data-action="download-card">Save as image</button>
        ${navigator.canShare ? '<button class="ghost" data-action="share-card">Share</button>' : ''}
      </div>
      <label class="block">Semester name <input value="${esc(state.semester?.name ?? '')}" placeholder="Fall 2026" data-path="semester.name"></label>
      <dl class="facts">
        <div><dt>Deadlines</dt><dd>${w.deadlines}</dd></div>
        <div><dt>Exams</dt><dd>${w.exams}</dd></div>
        <div><dt>Hardest class</dt><dd>${esc(w.hardest ?? '—')}</dd></div>
        <div><dt>Worst week</dt><dd>${w.worstWeek ? `${w.worstWeek.label} <small class="muted">(${w.worstWeek.count} things due)</small>` : '—'}</dd></div>
        <div><dt>Carrying you</dt><dd>${w.carrying ? `${esc(w.carrying.code)} · ${formatScore(w.carrying.score)}` : '—'}</dd></div>
        <div><dt>Study hours planned</dt><dd>${w.studyHours}</dd></div>
        <div><dt>Survival odds</dt><dd>✦ ${w.odds.label} <small class="muted">${w.odds.line}</small></dd></div>
      </dl>
    </section>
  </div>`;
}

async function paintCard() {
  const canvas = document.getElementById('card');
  if (!canvas) return;
  const w = wrapped({ semester: state.semester, courses: state.courses, blocks: currentPlan().blocks });
  await safe(() => document.fonts.ready);
  drawCard(canvas, w, state.courses);
}

// ---------- My classes ----------

function renderClasses() {
  const sem = state.semester ?? { name: '', start: '', end: '' };
  return `
  <div class="stack">
    ${draft ? quickSetup() : ''}
    ${renderImporter()}
    ${imports.map(reviewCard).join('')}
    <section class="card">
      <h2>Semester</h2>
      <div class="grid3">
        <label>Name <input value="${esc(sem.name)}" placeholder="Fall 2026" data-path="semester.name"></label>
        <label>First day <input type="date" value="${sem.start}" data-path="semester.start"></label>
        <label>Last day of finals <input type="date" value="${sem.end}" data-path="semester.end"></label>
      </div>
    </section>
    ${state.courses.map(classCard).join('')}
    <button class="primary add-course" data-action="add-course">+ Add a class</button>
  </div>`;
}

function classCard(course, ci) {
  const total = course.categories.reduce((s, c) => s + (Number(c.weight) || 0), 0);
  const p = `courses.${ci}`;
  return `
  <details class="card class-card" style="--c:${course.color}" data-key="class-${course.id}" open>
    <summary class="card-head">
      <h2><span class="dot"></span>${esc(course.code || 'New class')}</h2>
      <span class="muted">${course.items.length} items · weights ${total === 100 ? '100% ✓' : `<b class="bad">${total}%</b>`}</span>
    </summary>

    <div class="grid4">
      <label>Code <input value="${esc(course.code)}" placeholder="ABC 123" data-path="${p}.code"></label>
      <label class="span2">Name <input value="${esc(course.name)}" placeholder="Class name" data-path="${p}.name"></label>
      <label>Color <input type="color" value="${course.color}" data-path="${p}.color"></label>
    </div>

    <h3>Class times</h3>
    ${course.meetings.map((m, mi) => `
      <div class="busy-row">
        ${daysPicker(`${p}.meetings.${mi}.days`, m.days)}
        <input type="time" value="${m.start}" data-path="${p}.meetings.${mi}.start" aria-label="Starts">
        <input type="time" value="${m.end}" data-path="${p}.meetings.${mi}.end" aria-label="Ends">
        <button class="x" data-action="del" data-path="${p}.meetings.${mi}" aria-label="Remove">×</button>
      </div>`).join('')}
    <button class="ghost small" data-action="add-meeting" data-course="${ci}">+ Class time</button>

    <h3>Grade weights <small class="muted">(from the syllabus)</small></h3>
    <table class="edit">
      <thead><tr><th>Category</th><th>Weight %</th><th>Drop lowest</th><th title="Earning this % of the points counts as 100%">Full credit at %</th><th></th></tr></thead>
      <tbody>
        ${course.categories.map((cat, ki) => `<tr>
          <td><input value="${esc(cat.name)}" data-path="${p}.categories.${ki}.name" aria-label="Category"></td>
          <td><input type="number" min="0" max="100" step="any" value="${cat.weight}" data-path="${p}.categories.${ki}.weight" data-type="number" aria-label="Weight"></td>
          <td><input type="number" min="0" step="1" value="${cat.dropLowest ?? 0}" data-path="${p}.categories.${ki}.dropLowest" data-type="number" aria-label="Drop lowest"></td>
          <td><input type="number" min="1" max="100" step="any" value="${cat.fullCreditAt ?? ''}" placeholder="100" data-path="${p}.categories.${ki}.fullCreditAt" data-type="optnumber" aria-label="Full credit at"></td>
          <td><button class="x" data-action="del-category" data-course="${ci}" data-index="${ki}" aria-label="Remove">×</button></td>
        </tr>`).join('')}
      </tbody>
    </table>
    <button class="ghost small" data-action="add-category" data-course="${ci}">+ Category</button>

    <h3>Syllabus rules <small class="muted">(the fine print that changes the math)</small></h3>
    <div class="rules-edit">
      <label class="radio"><input type="checkbox" data-path="${p}.rules.roundAt" data-type="round" ${course.rules?.roundAt ? 'checked' : ''}><span>Final grade rounds up at .5 <small class="muted">(89.5 → 90)</small></span></label>
      <label class="radio"><input type="checkbox" data-path="${p}.rules.finalReplacesLowest" data-type="bool" ${course.rules?.finalReplacesLowest ? 'checked' : ''}><span>The final replaces my lowest exam if it's higher</span></label>
      <div class="grid2">
        <label>Exam average needed to pass <input type="number" min="0" max="100" value="${course.rules?.passExams ?? ''}" placeholder="none" data-path="${p}.rules.passExams" data-type="optnumber"></label>
        <label>Extra credit, at most (points) <input type="number" min="0" max="20" step="0.5" value="${course.rules?.extraCreditMax ?? ''}" placeholder="none" data-path="${p}.rules.extraCreditMax" data-type="optnumber"></label>
      </div>
      <h4 class="scale-h">How this class grades</h4>
      ${scaleEditor(course.scale ?? DEFAULT_SCALE, ci)}
      ${describeRules(course).some((r) => r.source) ? `<details class="src-all" data-key="src-${course.id}"><summary>Where these came from</summary>${rulesList(course)}</details>` : ''}
    </div>

    <h3>Everything that gets graded</h3>
    <div class="table-scroll">
    <table class="edit items">
      <thead><tr><th>Name</th><th>Category</th><th>Kind</th><th>Date</th><th>Time</th><th>Score</th><th>Out of</th><th></th></tr></thead>
      <tbody>
        ${course.items.map((item, ii) => `<tr>
          <td><input value="${esc(item.name)}" data-path="${p}.items.${ii}.name" aria-label="Name"></td>
          <td><select data-path="${p}.items.${ii}.category" aria-label="Category">
            ${course.categories.map((c) => `<option value="${c.id}" ${c.id === item.category ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
          </select></td>
          <td><select data-path="${p}.items.${ii}.kind" aria-label="Kind">
            ${KINDS.map((k) => `<option ${k === item.kind ? 'selected' : ''}>${k}</option>`).join('')}
          </select></td>
          <td><input type="date" value="${item.date ?? ''}" data-path="${p}.items.${ii}.date" aria-label="Date"></td>
          <td><input type="time" value="${item.time ?? ''}" data-path="${p}.items.${ii}.time" aria-label="Time"></td>
          <td><input type="number" step="any" min="0" value="${isGraded(item) ? item.earned : ''}" placeholder="—" data-path="${p}.items.${ii}.earned" data-type="score" aria-label="Score"></td>
          <td><input type="number" step="any" min="0" value="${item.possible}" data-path="${p}.items.${ii}.possible" data-type="number" aria-label="Out of"></td>
          <td><button class="x" data-action="del" data-path="${p}.items.${ii}" aria-label="Remove">×</button></td>
        </tr>`).join('')}
      </tbody>
    </table>
    </div>
    <button class="ghost small" data-action="add-item" data-course="${ci}">+ Item</button>

    <div class="danger-row"><button class="ghost small bad" data-action="del-course" data-course="${ci}">Delete ${esc(course.code || 'this class')}</button></div>
  </details>`;
}

// ---------- grading scale ----------

const SCALES = {
  plusminus: { label: 'A 93 · A- 90 · B+ 87…', scale: DEFAULT_SCALE },
  aplus: { label: 'With A+ (97 and up)', scale: [['A+', 97], ...DEFAULT_SCALE] },
  straight: { label: 'A 90 · B 80 · C 70 · D 60, no + or −', scale: [['A', 90], ['B', 80], ['C', 70], ['D', 60], ['F', 0]] },
};

const sameScale = (a, b) => a.length === b.length && a.every(([l, m], k) => l === b[k][0] && m === b[k][1]);

/** Presets plus every cutoff editable, so "an A is 96 and up" works too. `ci` is a course index or 'draft'. */
function scaleEditor(scale, ci) {
  const pathFor = (k) => (ci === 'draft' ? `data-draft="scale.${k}"` : `data-path="courses.${ci}.scale.${k}.1" data-type="cutoff"`);
  const letters = new Set(scale.map(([l]) => l));
  const preset = Object.entries(SCALES).find(([, p]) => p.scale.length === scale.length && p.scale.every(([l]) => letters.has(l)))?.[0];
  return `<div class="scale-edit">
      <div class="quick-add">${Object.entries(SCALES).map(([key, p]) => `<button class="chip ${key === preset ? 'is-on' : ''}" data-action="set-scale" data-preset="${key}" data-course="${ci}">${p.label}</button>`).join('')}</div>
      <div class="scale-grid">${scale.map(([l, m], k) => (m > 0 ? `<label><b>${l}</b><input type="number" min="1" max="100" step="any" value="${m}" ${pathFor(k)} aria-label="${l} starts at"></label>` : '')).join('')}</div>
      <p class="tiny muted">The lowest score that still gets each letter. Change any number to match your syllabus.</p>
    </div>`;
}

// ---------- quick setup: type the categories in ----------

const PRESETS = [
  ['Homework', 10], ['Quizzes', 8], ['Midterm', 2], ['Final exam', 1], ['Project', 1], ['Labs', 8], ['Participation', 1],
];

function newDraft() {
  return {
    code: '',
    rows: [
      { name: 'Homework', weight: 25, count: 10 },
      { name: 'Midterms', weight: 40, count: 2 },
      { name: 'Final exam', weight: 25, count: 1 },
      { name: 'Participation', weight: 10, count: 1 },
    ],
  };
}

function draftTotal() {
  return draft.rows.reduce((sum, r) => sum + (Number(r.weight) || 0), 0);
}

function totalNote() {
  const t = Math.round(draftTotal() * 10) / 10;
  return t === 100 ? '<span class="ok">100% ✓</span>' : `<span class="bad">${t}%</span> <small class="muted">should add to 100</small>`;
}

function quickSetup() {
  return `
  <section class="card quick" id="quick">
    <h2>Type your class in</h2>
    <p class="muted">Copy the grade breakdown from your syllabus: each category, what it's worth, and how many there are.</p>
    <label class="quick-code">Class <input value="${esc(draft.code)}" placeholder="MIS 333K" data-draft="code"></label>
    <div class="quick-rows">
      <div class="quick-row quick-labels"><span>Category</span><span>Weight</span><span>How many</span><span></span></div>
      ${draft.rows.map((r, i) => `<div class="quick-row">
        <input value="${esc(r.name)}" placeholder="Homework" data-draft="${i}.name" aria-label="Category">
        <span class="unit"><input type="number" inputmode="decimal" min="0" max="100" step="any" value="${r.weight}" data-draft="${i}.weight" aria-label="Weight">%</span>
        <input type="number" inputmode="numeric" min="1" max="60" step="1" value="${r.count}" data-draft="${i}.count" aria-label="How many">
        <button class="x" data-action="draft-del" data-index="${i}" aria-label="Remove">×</button>
      </div>`).join('')}
    </div>
    <div class="quick-add">
      <span class="tiny muted">Add</span>
      ${PRESETS.map(([name]) => `<button class="chip" data-action="draft-add" data-name="${name}">+ ${name}</button>`).join('')}
      <button class="chip" data-action="draft-add" data-name="">+ Other</button>
    </div>
    <p class="quick-total">Total <b data-draft-total>${totalNote()}</b></p>
    <h4 class="scale-h">How this class grades</h4>
    ${scaleEditor(draft.scale ?? DEFAULT_SCALE, 'draft')}
    <div class="row-actions">
      <button class="primary" data-action="draft-create">Add this class ✦</button>
      <button class="ghost" data-action="draft-cancel">Cancel</button>
    </div>
    <p class="tiny muted">Then type in your scores as they come back. You can add dates and the fine print later in My classes.</p>
  </section>`;
}

function kindFor(name) {
  if (/final/i.test(name)) return 'exam';
  if (/exam|midterm|test/i.test(name)) return 'exam';
  if (/quiz/i.test(name)) return 'quiz';
  if (/project|presentation/i.test(name)) return 'project';
  if (/paper|essay|report|writing/i.test(name)) return 'paper';
  if (/particip|attendance|engagement/i.test(name)) return 'participation';
  return 'homework';
}

function singular(name) {
  return name.replace(/zzes$/i, 'z').replace(/ies$/i, 'y').replace(/([^s])s$/i, '$1');
}

function courseFromDraft() {
  const rows = draft.rows.filter((r) => r.name.trim() && Number(r.weight) > 0);
  if (!rows.length) return null;
  const course = {
    id: uid(), code: draft.code.trim() || 'My class', name: '', color: PALETTE[state.courses.length % PALETTE.length], target: 'A',
    meetings: [], categories: [], items: [],
    ...(draft.scale && !sameScale(draft.scale, DEFAULT_SCALE) ? { scale: draft.scale } : {}),
  };
  for (const r of rows) {
    const cat = { id: uid(), name: r.name.trim(), weight: Number(r.weight), dropLowest: 0 };
    const n = Math.max(1, Math.min(60, Math.round(Number(r.count) || 1)));
    course.categories.push(cat);
    for (let k = 1; k <= n; k++) {
      course.items.push({
        id: uid(), name: n === 1 ? cat.name : `${singular(cat.name)} ${k}`, category: cat.id,
        kind: kindFor(cat.name), possible: 100, earned: null, ...(n === 1 && /final/i.test(cat.name) ? { final: true } : {}),
      });
    }
  }
  return course;
}

function showCard(id) {
  tab = 'grades';
  history.replaceState(null, '', '#grades');
  requestAnimationFrame(() => document.querySelector(`[data-card="${id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
}

app.addEventListener('input', (e) => {
  const key = e.target.dataset?.draft;
  if (!key || !draft) return;
  if (key === 'code') draft.code = e.target.value;
  else if (key.startsWith('scale.')) {
    draft.scale ??= DEFAULT_SCALE.map((r) => [...r]);
    draft.scale[Number(key.split('.')[1])][1] = Number(e.target.value);
  } else {
    const [i, field] = key.split('.');
    draft.rows[i][field] = field === 'name' ? e.target.value : e.target.value === '' ? '' : Number(e.target.value);
  }
  const total = app.querySelector('[data-draft-total]');
  if (total) total.innerHTML = totalNote();
});

// ---------- syllabus upload ----------

function renderImporter() {
  return `
  <section class="card importer" id="importer">
    <h2>Upload a syllabus ✦</h2>
    <p class="muted">Drop in your syllabi. I'll find the class times, the grade weights and the exam dates, and you check everything before it's added.</p>
    ${dropzone()}
    <details data-key="paste">
      <summary>Or paste the text</summary>
      <textarea rows="6" data-role="paste" placeholder="Paste the grading section, the schedule, or the whole thing">${esc(pasteText)}</textarea>
      <button class="ghost small" data-action="read-paste">Read it</button>
    </details>
    <fieldset class="reader">
      <legend>Who reads it</legend>
      <label class="radio"><input type="radio" name="reader" value="builtin" data-role="reader-mode" ${reader.mode === 'builtin' ? 'checked' : ''}>
        <span><b>Built-in</b> · free and private. Nothing leaves your browser.</span></label>
      <label class="radio"><input type="radio" name="reader" value="gemini" data-role="reader-mode" ${reader.mode === 'gemini' ? 'checked' : ''}>
        <span><b>Gemini</b> · better with messy syllabi. Free with your own API key, but the syllabus text is sent to Google.</span></label>
      ${reader.mode === 'gemini' ? `
      <div class="grid2 gemini">
        <label>Gemini API key <input type="password" autocomplete="off" spellcheck="false" value="${esc(reader.apiKey)}" data-role="api-key" placeholder="Paste your key"></label>
        <label>Model <input value="${esc(reader.model)}" data-role="model" spellcheck="false"></label>
      </div>
      <p class="tiny muted">Get a free key at <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">Google AI Studio</a>. It's saved only in this browser and sent only to Google.</p>` : ''}
    </fieldset>
  </section>`;
}

function describeMeeting(m) {
  const names = { 0: 'Sun', 1: 'Mon', 2: 'Tue', 3: 'Wed', 4: 'Thu', 5: 'Fri', 6: 'Sat' };
  return `${m.days.map((d) => names[d]).join(' & ')} · ${formatTime(parseTime(m.start))}–${formatTime(parseTime(m.end))}`;
}

function reviewCard(entry) {
  const head = `<header class="card-head"><div><h3>${esc(entry.course?.code || entry.fileName)}${entry.course?.name ? ` <span class="muted">${esc(entry.course.name)}</span>` : ''}</h3>
    <p class="tiny muted">${esc(entry.fileName)} · ${entry.via === 'gemini' ? 'read by Gemini' : 'read by the built-in reader'}</p></div></header>`;
  if (entry.status === 'reading') {
    return `<article class="card review reading">${head}<p class="pulse">Reading${entry.via === 'gemini' ? ' with Gemini' : ''}… ✦</p></article>`;
  }
  if (entry.status === 'error') {
    return `<article class="card review">${head}<p class="warn">${esc(entry.error)}</p>
      <div class="row-actions">${entry.text ? `<button class="ghost small" data-action="retry-import" data-id="${entry.id}" data-via="${entry.via === 'gemini' ? 'builtin' : 'gemini'}">Try ${entry.via === 'gemini' ? 'the built-in reader' : 'Gemini'}</button>` : ''}
      <button class="ghost small" data-action="discard-import" data-id="${entry.id}">Dismiss</button></div></article>`;
  }
  const c = entry.course;
  const total = c.categories.reduce((sum, k) => sum + k.weight, 0);
  const dated = c.items.filter((i) => i.date).sort((a, b) => (a.date < b.date ? -1 : 1));
  const byCat = (id) => c.items.filter((i) => i.category === id).length;
  return `
  <article class="card review" style="--c:${c.color}">
    ${head}
    ${entry.warnings.length ? `<ul class="warn-list">${entry.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>` : '<p class="ok">✓ Found everything I look for. Give it a quick look anyway.</p>'}
    <div class="review-grid">
      <div>
        <h4>Grade weights <span class="${Math.abs(total - 100) < 0.6 ? 'ok' : 'bad'}">${Math.round(total * 10) / 10}%</span></h4>
        <ul class="plain sourced">${c.categories.map((k) => `<li><div class="row-main"><span>${esc(k.name)}${byCat(k.id) > 1 ? ` <small class="muted">×${byCat(k.id)}</small>` : ''}</span><b>${k.weight}%</b></div>${sourceTag(k.source?.weight, k.check)}</li>`).join('') || '<li class="muted">None found</li>'}</ul>
        ${describeRules(c).length ? `<h4>The fine print</h4>${rulesList(c)}` : ''}
      </div>
      <div>
        <h4>Class times</h4>
        <ul class="plain sourced">${c.meetings.map((m, mi) => `<li><div class="row-main"><span>${describeMeeting(m)}</span></div>${mi === 0 ? sourceTag(c.sources?.meetings) : ''}</li>`).join('') || '<li class="muted">None found</li>'}</ul>
        <h4>Dates</h4>
        <ul class="plain sourced">${dated.map((i) => `<li><div class="row-main"><span>${esc(i.name)}</span><span class="muted">${shortDate(i.date)}${i.time ? `, ${formatTime(parseTime(i.time))}` : ''}</span></div>${sourceTag(i.source)}</li>`).join('') || '<li class="muted">None found</li>'}</ul>
      </div>
    </div>
    <div class="row-actions">
      <button class="primary" data-action="accept-import" data-id="${entry.id}">Add ${esc(c.code || 'this class')}</button>
      ${entry.text && entry.via !== 'gemini' ? `<button class="ghost" data-action="retry-import" data-id="${entry.id}" data-via="gemini">Ask Gemini instead</button>` : ''}
      <button class="ghost" data-action="discard-import" data-id="${entry.id}">Discard</button>
    </div>
    <p class="tiny muted">You can fix anything after adding it.</p>
  </article>`;
}

async function readSyllabus(fileName, getText, via = reader.mode, existing = null) {
  const entry = existing ?? { id: uid(), fileName };
  Object.assign(entry, { status: 'reading', via, error: null });
  if (!existing) imports.unshift(entry);
  render();
  try {
    entry.text ??= await getText();
    if (entry.text.replace(/\s/g, '').length < 40) {
      throw new Error("I couldn't find any text in that file. If it's a scanned PDF, paste the text instead.");
    }
    const ref = state.semester?.start || today;
    let found;
    if (via === 'gemini') {
      if (!reader.apiKey) throw new Error('Add your Gemini API key above first (choose Gemini under "Who reads it").');
      found = await readWithGemini(entry.text, { apiKey: reader.apiKey, model: reader.model || DEFAULT_MODEL, ref });
    } else {
      found = parseSyllabus(entry.text, { ref });
    }
    const color = PALETTE[(state.courses.length + imports.indexOf(entry)) % PALETTE.length];
    Object.assign(entry, toCourse(found, { id: uid(), color, semester: state.semester, uid, text: entry.text }), { status: 'done' });
  } catch (err) {
    Object.assign(entry, { status: 'error', error: err.message || String(err) });
  }
  render();
}

function readFiles(files) {
  if (files.length && tab !== 'classes') {
    tab = 'classes';
    history.replaceState(null, '', '#classes');
  }
  for (const file of files) {
    const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
    readSyllabus(file.name, () => (isPdf ? pdfText(file) : file.text()));
  }
}

app.addEventListener('change', (e) => {
  const role = e.target.dataset?.role;
  if (role === 'syllabus-file') {
    readFiles([...e.target.files]);
    e.target.value = '';
  } else if (role === 'reader-mode') {
    reader.mode = e.target.value;
    saveReader(reader);
    render();
  } else if (role === 'api-key' || role === 'model') {
    reader[role === 'api-key' ? 'apiKey' : 'model'] = e.target.value.trim();
    saveReader(reader);
  }
});

app.addEventListener('input', (e) => {
  if (e.target.dataset?.role === 'paste') pasteText = e.target.value;
  const { playCourse, playKey } = e.target.dataset ?? {};
  if (playCourse) {
    const course = courseById(playCourse);
    const value = Number(e.target.value);
    if (playKey === FINAL_KEY) course.finalGuess = { id: pickFinal(course).id, value };
    else course.whatIf = { ...whatIfOf(course), [playKey]: value };
    app.querySelector(`[data-v="${playCourse}-${playKey}"]`).textContent = `${value}%`;
    playLive(course);
  }
});
// Save when a slider is let go. No re-render, so the slider keeps focus for arrow keys.
app.addEventListener('change', (e) => {
  if (e.target.dataset?.playCourse) persist();
});

app.addEventListener('dragover', (e) => {
  const drop = e.target.closest?.('[data-role="drop"]');
  if (!drop) return;
  e.preventDefault();
  drop.classList.add('over');
});
app.addEventListener('dragleave', (e) => e.target.closest?.('[data-role="drop"]')?.classList.remove('over'));
app.addEventListener('drop', (e) => {
  const drop = e.target.closest?.('[data-role="drop"]');
  if (!drop) return;
  e.preventDefault();
  drop.classList.remove('over');
  readFiles([...e.dataTransfer.files]);
});

// ---------- state changes ----------

function getParent(path) {
  const keys = path.split('.');
  const last = keys.pop();
  let obj = state;
  for (const k of keys) {
    if (obj[k] === undefined || obj[k] === null) obj[k] = /^\d+$/.test(k) ? [] : {};
    obj = obj[k];
  }
  return [obj, last];
}

function setField(el) {
  const path = el.dataset.path;
  if (path.startsWith('semester.') && !state.semester) state.semester = { name: '', start: '', end: '' };
  const scaleEdit = path.match(/^courses\.(\d+)\.scale\./);
  if (scaleEdit && !state.courses[scaleEdit[1]].scale) state.courses[scaleEdit[1]].scale = DEFAULT_SCALE.map((r) => [...r]);
  const [obj, key] = getParent(path);

  if (el.dataset.day !== undefined) {
    const day = Number(el.dataset.day);
    const set = new Set(obj[key]);
    el.checked ? set.add(day) : set.delete(day);
    obj[key] = [...set].sort();
    return;
  }
  const type = el.dataset.type;
  const raw = el.value;
  if (type === 'bool') {
    if (el.checked) obj[key] = true;
    else delete obj[key];
    return;
  }
  if (type === 'round') {
    if (el.checked) obj[key] = 0.5;
    else delete obj[key];
    return;
  }
  if (type === 'optnumber') {
    if (raw === '' || Number(raw) === 0) delete obj[key];
    else obj[key] = Number(raw);
    return;
  }
  if (type === 'cutoff') {
    if (raw !== '') obj[key] = Number(raw);
    return;
  }
  if (type === 'score') obj[key] = raw === '' ? null : Number(raw);
  else if (type === 'number') obj[key] = raw === '' ? 0 : Number(raw);
  else if (type === 'minutes') obj[key] = parseTime(raw || '00:00');
  else obj[key] = raw;
}

app.addEventListener('change', (e) => {
  const el = e.target.closest('[data-path]');
  if (!el || el.tagName === 'BUTTON') return;
  setField(el);
  persist();
  render();
});

document.addEventListener('click', (e) => {
  const tabBtn = e.target.closest('[data-tab]');
  if (tabBtn) {
    tab = tabBtn.dataset.tab;
    history.replaceState(null, '', `#${tab}`);
    render();
    return;
  }
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const ci = Number(btn.dataset.course);
  const course = state.courses[ci];
  const actions = {
    sample() {
      if (state.courses.length && !confirm('Replace your classes with the sample semester?')) return;
      state = sampleSemester(today);
      tab = 'grades';
    },
    reset() {
      if (!confirm('Delete all your classes and grades from this browser?')) return;
      state = { courses: [], busy: [], prefs: {}, semester: null };
      clear();
    },
    start() { actions['add-course'](); },
    'read-paste'() {
      if (!pasteText.trim()) return;
      const text = pasteText;
      readSyllabus('Pasted text', async () => text);
    },
    'accept-import'() {
      const entry = imports.find((i) => i.id === btn.dataset.id);
      if (!entry) return;
      state.courses.push(entry.course);
      imports = imports.filter((i) => i !== entry);
      if (!imports.length) showCard(entry.course.id);
    },
    'set-scale'() {
      const scale = SCALES[btn.dataset.preset].scale.map((r) => [...r]);
      if (btn.dataset.course === 'draft') {
        draft.scale = scale;
        return;
      }
      if (btn.dataset.preset === 'plusminus') delete course.scale;
      else course.scale = scale;
      if (!scale.some(([l]) => l === course.target)) course.target = 'A';
    },
    'set-target'() { course.target = btn.dataset.letter; },
    'reset-play'() {
      delete course.whatIf;
      delete course.finalGuess;
    },
    'discard-import'() { imports = imports.filter((i) => i.id !== btn.dataset.id); },
    'retry-import'() {
      const entry = imports.find((i) => i.id === btn.dataset.id);
      if (!entry) return;
      if (btn.dataset.via === 'gemini' && !reader.apiKey) {
        reader.mode = 'gemini';
        saveReader(reader);
        document.getElementById('importer')?.scrollIntoView({ behavior: 'smooth' });
        return;
      }
      readSyllabus(entry.fileName, null, btn.dataset.via, entry);
    },
    'add-course'() {
      draft ??= newDraft();
      tab = 'classes';
      history.replaceState(null, '', '#classes');
      requestAnimationFrame(() => document.getElementById('quick')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    },
    'draft-add'() {
      const preset = PRESETS.find(([name]) => name === btn.dataset.name);
      draft.rows.push({ name: btn.dataset.name, weight: '', count: preset?.[1] ?? 1 });
    },
    'draft-del'() { draft.rows.splice(Number(btn.dataset.index), 1); },
    'draft-cancel'() { draft = null; },
    'draft-create'() {
      const made = courseFromDraft();
      if (!made) return;
      state.courses.push(made);
      draft = null;
      showCard(made.id);
    },
    'add-meeting'() { course.meetings.push({ days: [2, 4], start: '12:30', end: '14:00' }); },
    'add-category'() { course.categories.push({ id: uid(), name: 'New category', weight: 0, dropLowest: 0 }); },
    'del-category'() {
      const cat = course.categories[Number(btn.dataset.index)];
      const used = course.items.filter((i) => i.category === cat.id).length;
      if (used && !confirm(`Delete ${cat.name} and its ${used} item${used === 1 ? '' : 's'}?`)) return;
      course.categories.splice(Number(btn.dataset.index), 1);
      course.items = course.items.filter((i) => i.category !== cat.id);
    },
    'add-item'() {
      course.items.push({
        id: uid(), name: `Item ${course.items.length + 1}`, category: course.categories[0]?.id,
        kind: 'homework', date: today, possible: 100, earned: null,
      });
    },
    'del-course'() {
      if (!confirm(`Delete ${course.code || 'this class'}?`)) return;
      state.courses.splice(ci, 1);
    },
    del() {
      const [obj, key] = getParent(btn.dataset.path);
      obj.splice(Number(key), 1);
    },
    'add-busy'() { state.busy.push({ id: uid(), label: 'Pilates', days: [6], start: '09:00', end: '10:00' }); },
    'del-busy'() { state.busy.splice(Number(btn.dataset.index), 1); },
    'ics-study'() { downloadStudy(); },
    'ics-deadlines'() { downloadDeadlines(); },
    'download-card'() { downloadCard(); },
    'share-card'() { shareCard(); },
  };
  const fn = actions[btn.dataset.action];
  if (!fn) return;
  fn();
  persist();
  render();
});

window.addEventListener('hashchange', () => {
  const t = location.hash.slice(1);
  if (TABS.includes(t)) { tab = t; render(); }
});

// ---------- files ----------

function download(name, blob) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function downloadStudy() {
  const { blocks } = currentPlan();
  const events = blocks.map((b) => ({
    uid: `study-${b.itemId}-${b.date}-${b.start}`,
    date: b.date, start: b.start, end: b.end,
    summary: `Study: ${b.label} (${b.session}/${b.sessions})`,
    description: b.daysBefore === 1 ? 'Last review before the exam. Sleep after this.' : `${b.daysBefore} days before the exam.`,
  }));
  download('study-plan.ics', new Blob([buildCalendar(events, { name: 'Study plan ✦' })], { type: 'text/calendar' }));
}

function downloadDeadlines() {
  const events = [];
  for (const course of state.courses) {
    for (const item of course.items) {
      if (!item.date) continue;
      const start = item.time ? parseTime(item.time) : undefined;
      events.push({
        uid: `due-${course.id}-${item.id}`,
        date: item.date,
        start,
        end: start === undefined ? undefined : start + (item.kind === 'exam' ? (item.minutes ?? 90) : 30),
        summary: `${item.kind === 'exam' ? '✦ ' : ''}${course.code}: ${item.name}`,
      });
    }
  }
  download('deadlines.ics', new Blob([buildCalendar(events, { name: `${state.semester?.name || 'Semester'} deadlines` })], { type: 'text/calendar' }));
}

function cardBlob() {
  return new Promise((resolve) => document.getElementById('card').toBlob(resolve, 'image/png'));
}

async function downloadCard() {
  download('semester-wrapped.png', await cardBlob());
}

async function shareCard() {
  const file = new File([await cardBlob()], 'semester-wrapped.png', { type: 'image/png' });
  if (navigator.canShare?.({ files: [file] })) {
    safe(() => navigator.share({ files: [file], title: 'My Semester Wrapped ✦' }).catch(() => {}));
  } else {
    downloadCard();
  }
}

render();
