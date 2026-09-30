import { WEEKDAYS, addDays, formatTime, parseTime, prettyDate, shortDate, todayLocal, toTimeInput } from './dates.js';
import {
  DEFAULT_SCALE, finalTable, formatScore, isGraded, itemWeights, pickFinal, summarize, verdict,
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

const PALETTE = ['#d6336c', '#7048e8', '#0c8599', '#e8590c', '#2f9e44', '#1971c2', '#ae3ec9', '#f08c00'];
const KINDS = ['exam', 'quiz', 'homework', 'project', 'paper', 'participation'];
const TABS = ['grades', 'plan', 'wrapped', 'classes'];

const app = document.getElementById('app');
const today = todayLocal();
// ?example shows the made-up semester without touching anything you saved.
const exampleMode = new URLSearchParams(location.search).has('example');
let state = exampleMode ? sampleSemester(today) : load() ?? { courses: [], busy: [], prefs: {}, semester: null };
let tab = TABS.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'grades';
let reader = { mode: 'builtin', apiKey: '', model: DEFAULT_MODEL, ...loadReader() };
let imports = []; // syllabi being read or waiting for review (not saved)
let pasteText = '';

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
    app.innerHTML = { grades: renderGrades, plan: renderPlan, wrapped: renderWrapped, classes: renderClasses }[tab]();
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
      <div class="hero-actions">
        <button class="primary" data-action="upload">Upload my syllabi ✦</button>
        <button class="ghost" data-action="sample">See a made-up example</button>
      </div>
      <p class="tiny"><button class="linkish" data-action="start">or type a class in yourself</button></p>
    </section>`;
}

// ---------- The final ----------

function renderGrades() {
  return `<div class="stack">${state.courses.map(gradeCard).join('')}</div>`;
}

function gradeCard(course) {
  const ci = state.courses.indexOf(course);
  const s = summarize(course);
  const scale = course.scale ?? DEFAULT_SCALE;
  const target = course.target ?? 'A';
  const table = finalTable(course);
  const row = table.find((r) => r.letter === target) ?? table[0];
  const best = table.find((r) => r.needed !== null && r.needed <= 100);
  const final = pickFinal(course);
  const open = course.items.filter((i) => !isGraded(i));
  const weights = itemWeights(course);

  let big;
  if (row.needed === null) {
    big = `<div class="big">${s.current === null ? '—' : formatScore(s.current)}</div>
           <p class="verdict">${verdict(null)}</p>`;
  } else {
    const n = Math.ceil(row.needed * 10) / 10;
    const mood = n <= 0 ? 'safe' : n <= 80 ? 'good' : n <= 100 ? 'tight' : 'nope';
    big = `<div class="big ${mood}">${n <= 0 ? '✓' : formatScore(n)}</div>
           <p class="verdict">${esc(verdict(row.needed, target, best && best.letter !== target ? best.letter : null))}</p>`;
  }

  return `
  <article class="card" style="--c:${course.color}">
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
        ${open.length ? `<label>on
          <select data-path="courses.${ci}.finalId">
            ${open.map((i) => `<option value="${i.id}" ${final?.id === i.id ? 'selected' : ''}>${esc(i.name)} (${Math.round((weights.get(i.id)?.weight ?? 0) * 100)}%)</option>`).join('')}
          </select></label>` : ''}
      </div>
      ${big}
      ${final && row.needed !== null ? `<p class="tiny muted">Assumes the rest of your ungraded work goes the way that category has gone so far.</p>` : ''}
    </div>

    <details class="ladder" data-key="ladder-${course.id}">
      <summary>Every letter</summary>
      <div class="ladder-grid">
        ${table.map((r) => `<div class="rung ${r.letter === target ? 'is-target' : ''} ${r.needed !== null && r.needed > 100 ? 'is-out' : ''}">
          <b>${r.letter}</b><span>${r.needed === null ? '—' : r.needed <= 0 ? 'locked ✓' : formatScore(Math.ceil(r.needed * 10) / 10)}</span></div>`).join('')}
      </div>
    </details>

    ${open.length ? `
    <details class="entry" data-key="entry-${course.id}" ${open.some((i) => i.date && i.date < today) ? 'open' : ''}>
      <summary>Enter a grade</summary>
      <ul class="entry-list">
        ${course.items.map((item, ii) => ({ item, ii })).filter(({ item }) => !isGraded(item)).map(({ item, ii }) => `
          <li class="${item.date && item.date < today ? 'due' : ''}">
            <span>${esc(item.name)} <small class="muted">${item.date ? shortDate(item.date) : ''}</small></span>
            <span class="score"><input type="number" inputmode="decimal" step="any" min="0" placeholder="—" data-path="courses.${ci}.items.${ii}.earned" data-type="score" aria-label="${esc(item.name)} score"> / ${item.possible}</span>
          </li>`).join('')}
      </ul>
    </details>` : ''}
  </article>`;
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
      <thead><tr><th>Category</th><th>Weight %</th><th>Drop lowest</th><th></th></tr></thead>
      <tbody>
        ${course.categories.map((cat, ki) => `<tr>
          <td><input value="${esc(cat.name)}" data-path="${p}.categories.${ki}.name" aria-label="Category"></td>
          <td><input type="number" min="0" max="100" step="any" value="${cat.weight}" data-path="${p}.categories.${ki}.weight" data-type="number" aria-label="Weight"></td>
          <td><input type="number" min="0" step="1" value="${cat.dropLowest ?? 0}" data-path="${p}.categories.${ki}.dropLowest" data-type="number" aria-label="Drop lowest"></td>
          <td><button class="x" data-action="del-category" data-course="${ci}" data-index="${ki}" aria-label="Remove">×</button></td>
        </tr>`).join('')}
      </tbody>
    </table>
    <button class="ghost small" data-action="add-category" data-course="${ci}">+ Category</button>

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

// ---------- syllabus upload ----------

function renderImporter() {
  return `
  <section class="card importer" id="importer">
    <h2>Upload a syllabus ✦</h2>
    <p class="muted">Drop in your syllabi. I'll find the class times, the grade weights and the exam dates, and you check everything before it's added.</p>
    <label class="drop" data-role="drop">
      <input type="file" accept="application/pdf,.pdf,.txt,text/plain" multiple data-role="syllabus-file">
      <span><b>Choose PDFs</b> or drop them here</span>
    </label>
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
        <ul class="plain">${c.categories.map((k) => `<li><span>${esc(k.name)}${byCat(k.id) > 1 ? ` <small class="muted">×${byCat(k.id)}</small>` : ''}${k.dropLowest ? ` <small class="muted">drop ${k.dropLowest}</small>` : ''}</span><b>${k.weight}%</b></li>`).join('') || '<li class="muted">None found</li>'}</ul>
      </div>
      <div>
        <h4>Class times</h4>
        <ul class="plain">${c.meetings.map((m) => `<li>${describeMeeting(m)}</li>`).join('') || '<li class="muted">None found</li>'}</ul>
        <h4>Dates</h4>
        <ul class="plain">${dated.map((i) => `<li><span>${esc(i.name)}</span><span class="muted">${shortDate(i.date)}${i.time ? `, ${formatTime(parseTime(i.time))}` : ''}</span></li>`).join('') || '<li class="muted">None found</li>'}</ul>
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
    Object.assign(entry, toCourse(found, { id: uid(), color, semester: state.semester, uid }), { status: 'done' });
  } catch (err) {
    Object.assign(entry, { status: 'error', error: err.message || String(err) });
  }
  render();
}

function readFiles(files) {
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
    start() {
      tab = 'classes';
      actions['add-course']();
    },
    upload() {
      tab = 'classes';
      history.replaceState(null, '', '#classes');
      requestAnimationFrame(() => document.querySelector('[data-role="syllabus-file"]')?.click());
    },
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
      state.courses.push({
        id: uid(), code: '', name: '', color: PALETTE[state.courses.length % PALETTE.length], target: 'A',
        meetings: [{ days: [1, 3], start: '10:00', end: '11:30' }],
        categories: [
          { id: uid(), name: 'Exams', weight: 50, dropLowest: 0 },
          { id: uid(), name: 'Homework', weight: 30, dropLowest: 0 },
          { id: uid(), name: 'Participation', weight: 20, dropLowest: 0 },
        ],
        items: [],
      });
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
