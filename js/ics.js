// A standards-compliant .ics file (RFC 5545): CRLF line endings, escaped
// text, and lines folded at 75 octets. Times are "floating", so Calendar
// shows them in whatever time zone you're in, which is what you want for
// "study at 7 PM".

const encoder = new TextEncoder();

export function escapeText(s) {
  return String(s)
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/** Folds a content line so no physical line is longer than 75 octets. */
export function fold(line) {
  const out = [];
  let current = '';
  let bytes = 0;
  for (const ch of line) {
    const size = encoder.encode(ch).length;
    const limit = out.length === 0 ? 75 : 74; // continuation lines start with a space
    if (bytes + size > limit) {
      out.push(current);
      current = '';
      bytes = 0;
    }
    current += ch;
    bytes += size;
  }
  out.push(current);
  return out.join('\r\n ');
}

function compactDate(date) {
  return date.replaceAll('-', '');
}

function stamp(date, minutes) {
  const h = String(Math.floor(minutes / 60)).padStart(2, '0');
  const m = String(minutes % 60).padStart(2, '0');
  return `${compactDate(date)}T${h}${m}00`;
}

function nextDay(date) {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

/**
 * events: [{ uid, date, start?, end?, summary, description? }]
 * With no start/end, the event is all-day.
 */
export function buildCalendar(events, { name = 'Survival Odds', now = new Date() } = {}) {
  const dtstamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Survival Odds//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(name)}`,
  ];
  for (const e of events) {
    lines.push('BEGIN:VEVENT', `UID:${e.uid}@survival-odds`, `DTSTAMP:${dtstamp}`);
    if (e.start === undefined) {
      lines.push(`DTSTART;VALUE=DATE:${compactDate(e.date)}`, `DTEND;VALUE=DATE:${compactDate(nextDay(e.date))}`);
    } else {
      lines.push(`DTSTART:${stamp(e.date, e.start)}`, `DTEND:${stamp(e.date, e.end)}`);
    }
    lines.push(`SUMMARY:${escapeText(e.summary)}`);
    if (e.description) lines.push(`DESCRIPTION:${escapeText(e.description)}`);
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}
