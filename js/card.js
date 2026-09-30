// Draws the Semester Wrapped card straight onto a 1080×1920 canvas (story
// size), so what you see on the page is exactly the PNG you save.

import { formatScore } from './grades.js';

const W = 1080;
const H = 1920;
const PAD = 90;
const CREAM = '#fff4ec';
const SOFT = 'rgba(255, 244, 236, 0.72)';
const DISPLAY = '"Fraunces", Georgia, serif';
const BODY = '"Inter", system-ui, sans-serif';

function fit(ctx, text, font, size, maxWidth) {
  let s = size;
  ctx.font = font(s);
  while (ctx.measureText(text).width > maxWidth && s > 20) {
    s -= 4;
    ctx.font = font(s);
  }
  return s;
}

function sparkle(ctx, x, y, r, alpha) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = CREAM;
  ctx.beginPath();
  ctx.moveTo(x, y - r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.quadraticCurveTo(x, y, x, y + r);
  ctx.quadraticCurveTo(x, y, x - r, y);
  ctx.quadraticCurveTo(x, y, x, y - r);
  ctx.fill();
  ctx.restore();
}

function label(ctx, text, y) {
  ctx.font = `600 34px ${BODY}`;
  ctx.fillStyle = SOFT;
  ctx.letterSpacing = '4px';
  ctx.fillText(text.toUpperCase(), PAD, y);
  ctx.letterSpacing = '0px';
}

function value(ctx, text, y, size = 96) {
  ctx.fillStyle = CREAM;
  fit(ctx, text, (s) => `700 ${s}px ${DISPLAY}`, size, W - PAD * 2);
  ctx.fillText(text, PAD, y);
}

export function drawCard(canvas, w, courses) {
  const ctx = canvas.getContext('2d');
  ctx.textBaseline = 'alphabetic';

  // Background: plum at the top, melting into pink and peach.
  const bg = ctx.createLinearGradient(0, 0, W * 0.4, H);
  bg.addColorStop(0, '#2a0f3b');
  bg.addColorStop(0.5, '#a61e5f');
  bg.addColorStop(1, '#ff9a76');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  for (const [x, y, r, c] of [[880, 260, 420, 'rgba(255,120,190,0.35)'], [120, 1500, 520, 'rgba(255,200,140,0.30)']]) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, c);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  [[930, 140, 34, 0.9], [990, 250, 16, 0.6], [860, 610, 22, 0.5], [960, 1060, 28, 0.7], [70, 980, 18, 0.5], [1000, 1480, 20, 0.6], [150, 1760, 14, 0.5]]
    .forEach(([x, y, r, a]) => sparkle(ctx, x, y, r, a));

  // Header
  ctx.font = `600 36px ${BODY}`;
  ctx.fillStyle = SOFT;
  ctx.letterSpacing = '8px';
  ctx.fillText('SEMESTER WRAPPED', PAD, 170);
  ctx.letterSpacing = '0px';
  ctx.fillStyle = CREAM;
  fit(ctx, w.semester, (s) => `900 ${s}px ${DISPLAY}`, 104, W - PAD * 2 - 80);
  ctx.fillText(w.semester, PAD, 290);

  // The two big numbers
  let y = 510;
  for (const [n, word] of [[w.deadlines, 'deadlines.'], [w.exams, 'exams.']]) {
    ctx.font = `900 200px ${DISPLAY}`;
    ctx.fillStyle = CREAM;
    const num = String(n);
    ctx.fillText(num, PAD - 6, y);
    const nw = ctx.measureText(num).width;
    ctx.font = `500 72px ${DISPLAY}`;
    ctx.fillText(word, PAD + nw + 24, y);
    y += 190;
  }

  // Label / value pairs
  y += 30;
  const pairs = [
    ['Hardest class', w.hardest ?? '—'],
    ['Worst week', w.worstWeek ? w.worstWeek.short : '—'],
    ['Carrying you', w.carrying ? `${w.carrying.code} · ${formatScore(w.carrying.score)}` : 'TBD'],
    ['Study hours planned', String(w.studyHours)],
  ];
  for (const [l, v] of pairs) {
    label(ctx, l, y);
    value(ctx, v, y + 88, 80);
    y += 165;
  }

  // Survival odds
  y += 10;
  ctx.fillStyle = 'rgba(255, 244, 236, 0.14)';
  ctx.beginPath();
  ctx.roundRect(PAD - 30, y - 60, W - PAD * 2 + 60, 230, 40);
  ctx.fill();
  label(ctx, 'Your survival odds', y);
  ctx.fillStyle = CREAM;
  const odds = `✦ ${w.odds.label}`;
  fit(ctx, odds, (s) => `italic 900 ${s}px ${DISPLAY}`, 110, W - PAD * 2);
  ctx.fillText(odds, PAD, y + 115);

  // Class dots
  let x = PAD;
  const dotsY = H - 110;
  ctx.font = `600 30px ${BODY}`;
  for (const c of courses) {
    const text = c.code || '?';
    const tw = ctx.measureText(text).width;
    if (x + tw + 40 > W - PAD) break;
    ctx.fillStyle = c.color;
    ctx.beginPath();
    ctx.arc(x + 10, dotsY - 10, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = CREAM;
    ctx.fillText(text, x + 30, dotsY);
    x += tw + 70;
  }
  ctx.font = `500 28px ${BODY}`;
  ctx.fillStyle = SOFT;
  ctx.fillText('survival odds ✦', PAD, H - 50);
}
