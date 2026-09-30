import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  findCode, findDate, findDrops, findExams, findMeeting, findWeights, kindFor, parseDays, parseSyllabus,
} from '../js/parser.js';
import { toCourse } from '../js/importer.js';

// Every syllabus here is made up, written to look like the layouts real
// syllabi use.
const REF = '2026-08-26';
const lines = (s) => s.split('\n');
let n = 0;
const uid = () => `u${++n}`;

const LABEL_FIRST = `
ABC 123 Intro to Everything
Meeting Times: Tue/Thu 11:00 AM - 12:30 PM
Office hours: Wednesdays, 1:00-2:00pm on Zoom

Grading
Participation 10%
Quizzes 20%
Homework 20%
Exam 1 15%
Exam 2 15%
Final Exam 20%
Total 100%

A 93-100%   A- 90-92.99%
Late work loses 10% per day.
We'll drop your lowest quiz.

Schedule
Week 6  Tue Oct 6   Exam 1 review
Week 6  Thu Oct 8   Exam 1 (in class)
Week 11 Thu 11/12   Exam 2
Final Exam: Tuesday, December 8 at 2:00pm
`;

const PERCENT_FIRST = `
XYZ 456: Thinking About Thinking
Day & Time: Mondays & Wednesdays 12:30pm – 2:00pm
Your grade
• 40% Class engagement
o Polls (10%)
o Discussions (15%)
o Out of class activities (15%)
• 30% Reflection papers (3)
• 30% Exams (2)
Exam 1 - Oct. 14 - IN CLASS
Exam 2 - Dec 2 - IN CLASS
`;

const WRAPPED_TABLE = `
Assignment Deadline Points % of grade
Welcome quiz Thursday, August 27 at 11:59pm 10 2.5%
Weekly activities
Most Thursdays at 3:15pm
90 (10 pts each) 22.5%
Pre-project checkpoint
Thursday, November 5 at 11:59pm 10 2.5%
Group project Varies 70 17.5%
Peer feedback Varies 20 5%
Midterm exam October 8 100 25%
Final exam December 3 100 25%
Total 400 100%
`;

const SPLIT_COLUMNS = `
Weight
10%
10%
35%
20%
15%
10%
_Bonus_
100%
Assignment
Team case 1
Team case 2
Client project
Exam 1
Exam 2
Exercises and participation
Pre-class prep
`;

test('guesses the kind of thing from its name', () => {
  assert.equal(kindFor('Final Project'), 'project');
  assert.equal(kindFor('Final Exam'), 'exam');
  assert.equal(kindFor('Case Quizzes'), 'quiz');
  assert.equal(kindFor('Reflection papers'), 'paper');
  assert.equal(kindFor('Participation/Attendance'), 'participation');
  assert.equal(kindFor('Labs'), 'homework');
});

test('dates without a year land in the right semester', () => {
  assert.equal(findDate('Exam 1 - Oct. 14', REF), '2026-10-14');
  assert.equal(findDate('Thu 11/12 Exam 2', REF), '2026-11-12');
  assert.equal(findDate('Final: January 12', REF), '2027-01-12');
  assert.equal(findDate('Exam 1 on 3/4', '2026-01-20'), '2026-03-04');
  assert.equal(findDate('no date here', REF), null);
});

test('reads class days in every common style', () => {
  assert.deepEqual(parseDays('MW'), [1, 3]);
  assert.deepEqual(parseDays('TTh'), [2, 4]);
  assert.deepEqual(parseDays('TTH'), [2, 4]);
  assert.deepEqual(parseDays('T/Th'), [2, 4]);
  assert.deepEqual(parseDays('MWF'), [1, 3, 5]);
  assert.deepEqual(parseDays('TR'), [2, 4]);
  assert.deepEqual(parseDays('Mon/Wed'), [1, 3]);
  assert.deepEqual(parseDays('Mondays & Wednesdays'), [1, 3]);
});

const meet = (m) => m && { days: m.days, start: m.start, end: m.end };

test('finds class times and ignores office hours', () => {
  assert.deepEqual(meet(findMeeting(lines(LABEL_FIRST))), { days: [2, 4], start: '11:00', end: '12:30' });
  assert.deepEqual(meet(findMeeting(lines(PERCENT_FIRST))), { days: [1, 3], start: '12:30', end: '14:00' });
  assert.deepEqual(meet(findMeeting(['05025 MW 11:00am -12:15pm RRH 5.382'])), { days: [1, 3], start: '11:00', end: '12:15' });
  assert.match(findMeeting(lines(LABEL_FIRST)).source, /Meeting Times/);
  assert.equal(findMeeting(['Office hours: Thursdays, 12:30-1:30pm']), null);
});

test('finds the course code and title', () => {
  assert.deepEqual(findCode(lines(LABEL_FIRST).filter(Boolean)), { code: 'ABC 123', name: 'Intro to Everything' });
  assert.equal(findCode(['XYZ 456: Thinking About Thinking']).name, 'Thinking About Thinking');
});

test('finds a "Label 20%" breakdown and skips scales and penalties', () => {
  const w = findWeights(lines(LABEL_FIRST), REF);
  assert.deepEqual(w.map((c) => [c.label, c.value]), [
    ['Participation', 10], ['Quizzes', 20], ['Homework', 20], ['Exam 1', 15], ['Exam 2', 15], ['Final Exam', 20],
  ]);
});

test('uses the sub-parts when a parent line is split up', () => {
  const w = findWeights(lines(PERCENT_FIRST), REF);
  assert.deepEqual(w.map((c) => [c.label, c.value]), [
    ['Polls', 10], ['Discussions', 15], ['Out of class activities', 15], ['Reflection papers', 30], ['Exams', 30],
  ]);
  assert.equal(w.find((c) => c.label === 'Reflection papers').count, 3);
});

test('handles table rows that wrap onto several lines', () => {
  const w = findWeights(lines(WRAPPED_TABLE), REF);
  assert.deepEqual(w.map((c) => c.label), [
    'Welcome quiz', 'Weekly activities', 'Pre-project checkpoint', 'Group project', 'Peer feedback', 'Midterm exam', 'Final exam',
  ]);
  assert.equal(w[1].count, 9);
  assert.equal(w[0].date, '2026-08-27');
  assert.equal(w[0].time, '23:59');
  assert.equal(w[2].date, '2026-11-05');
  assert.equal(w[5].date, '2026-10-08');
});

test('matches labels to percentages when the PDF splits the table into columns', () => {
  const w = findWeights(lines(SPLIT_COLUMNS), REF);
  assert.deepEqual(w.map((c) => [c.label, c.value]), [
    ['Team case 1', 10], ['Team case 2', 10], ['Client project', 35], ['Exam 1', 20], ['Exam 2', 15], ['Exercises and participation', 10],
  ]);
});

test('finds dated exams, but not review days', () => {
  const exams = findExams(lines(LABEL_FIRST), REF);
  assert.deepEqual(exams.map((e) => [e.name, e.date]), [
    ['Exam 1', '2026-10-08'], ['Exam 2', '2026-11-12'], ['Final Exam', '2026-12-08'],
  ]);
  assert.equal(exams[2].time, '14:00');
});

test('finds "drop the lowest"', () => {
  const [quiz] = findDrops("We'll drop your lowest quiz.");
  assert.deepEqual([quiz.kind, quiz.n], ['quiz', 1]);
  assert.match(quiz.source, /drop your lowest quiz/);
  assert.equal(findDrops('We drop the two lowest labs')[0].n, 2);
  assert.equal(findDrops('We will drop your lowest exam score.')[0].kind, 'exam');
});

test('a whole syllabus becomes a class with no warnings', () => {
  const { course, warnings } = toCourse(parseSyllabus(LABEL_FIRST, { ref: REF }), { id: 'c', color: '#000', uid });
  assert.deepEqual(warnings, []);
  assert.equal(course.code, 'ABC 123');
  assert.equal(course.categories.find((c) => c.name === 'Quizzes').dropLowest, 1);
  const final = course.items.find((i) => i.name === 'Final Exam');
  assert.equal(final.date, '2026-12-08');
  assert.equal(final.time, '14:00');
  // An exam with no time is assumed to be during class.
  assert.equal(course.items.find((i) => i.name === 'Exam 1').time, '11:00');
});

test('"Exams (2)" becomes Exam 1 and Exam 2 with their dates', () => {
  const { course, warnings } = toCourse(parseSyllabus(PERCENT_FIRST, { ref: REF }), { id: 'c', color: '#000', uid });
  assert.deepEqual(warnings, []);
  const exams = course.items.filter((i) => i.kind === 'exam');
  assert.deepEqual(exams.map((e) => [e.name, e.date]), [['Exam 1', '2026-10-14'], ['Exam 2', '2026-12-02']]);
  assert.equal(course.items.filter((i) => i.kind === 'paper').length, 3);
});

test('checks what a reader hands back, AI or not', () => {
  const { course, warnings } = toCourse({
    code: 'ABC 123',
    meetings: [{ days: [1, 9, 3], start: '10:00', end: '11:15' }, { days: [2], start: '25:00', end: '09:00' }],
    categories: [
      { name: 'Exams', weight: 60, kind: 'exam', count: 2 },
      { name: 'Homework', weight: 30, kind: 'banana' },
      { name: '', weight: 50 },
    ],
    items: [{ name: 'Exam 1', kind: 'exam', date: '2026-13-45' }],
  }, { id: 'c', color: '#000', uid, semester: { start: '2026-08-26', end: '2026-12-15' } });
  assert.deepEqual(course.meetings, [{ days: [1, 3], start: '10:00', end: '11:15' }]);
  assert.equal(course.categories.length, 2);
  assert.equal(course.items.find((i) => i.name === 'Homework').kind, 'homework');
  assert.ok(warnings.some((w) => /add up to 90%/.test(w)));
  assert.ok(warnings.some((w) => /No date found for Exam 1, Exam 2/.test(w)));
});

test('warns when nothing useful is found', () => {
  const { warnings } = toCourse(parseSyllabus('Welcome to class! Be kind.', { ref: REF }), { id: 'c', color: '#000', uid });
  assert.ok(warnings.some((w) => /grade weights/.test(w)));
  assert.ok(warnings.some((w) => /class times/.test(w)));
});
