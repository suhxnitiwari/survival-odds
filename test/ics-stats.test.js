import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCalendar, escapeText, fold } from '../js/ics.js';
import { worstWeek, wrapped } from '../js/stats.js';
import { sampleSemester } from '../js/sample.js';

const encoder = new TextEncoder();

test('escapes commas, semicolons, backslashes and newlines', () => {
  assert.equal(escapeText('a,b;c\\d\ne'), 'a\\,b\\;c\\\\d\\ne');
});

test('folds long lines at 75 octets without splitting a character', () => {
  const line = `SUMMARY:${'✦'.repeat(60)}`;
  const parts = fold(line).split('\r\n');
  assert.ok(parts.length > 1);
  for (const p of parts) assert.ok(encoder.encode(p).length <= 75);
  assert.equal(parts.map((p, i) => (i ? p.slice(1) : p)).join(''), line);
});

test('builds timed and all-day events with CRLF endings', () => {
  const ics = buildCalendar([
    { uid: 'a', date: '2026-10-12', start: 19 * 60, end: 20 * 60 + 30, summary: 'Study: WEB 210' },
    { uid: 'b', date: '2026-12-31', summary: 'Due' },
  ], { now: new Date('2026-09-30T12:00:00Z') });
  assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\n'));
  assert.ok(ics.endsWith('END:VCALENDAR\r\n'));
  assert.match(ics, /DTSTART:20261012T190000\r\nDTEND:20261012T203000/);
  assert.match(ics, /DTSTART;VALUE=DATE:20261231\r\nDTEND;VALUE=DATE:20270101/);
  assert.match(ics, /DTSTAMP:20260930T120000Z/);
  assert.equal(ics.split('BEGIN:VEVENT').length - 1, 2);
});

test('worst week is the one with the most riding on it', () => {
  const courses = [{
    categories: [{ id: 'e', weight: 100 }],
    items: [
      { id: 1, category: 'e', date: '2026-10-05', possible: 10 },
      { id: 2, category: 'e', date: '2026-10-07', possible: 50, kind: 'exam' },
      { id: 3, category: 'e', date: '2026-10-14', possible: 40 },
    ],
  }];
  const w = worstWeek(courses);
  assert.equal(w.start, '2026-10-05');
  assert.equal(w.count, 2);
  assert.equal(w.exams, 1);
});

test('wrapped adds up the sample semester', () => {
  const s = sampleSemester('2026-09-30');
  const w = wrapped({ ...s, blocks: [{ start: 0, end: 90 }, { start: 0, end: 90 }] });
  assert.equal(w.classes, 4);
  assert.equal(w.deadlines, s.courses.reduce((n, c) => n + c.items.length, 0));
  assert.equal(w.studyHours, 3);
  assert.ok(w.hardest);
  assert.ok(w.carrying.score > 0);
  assert.ok(['excellent', 'good', 'tight but real', 'character development'].includes(w.odds.label));
});
