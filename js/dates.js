// Dates are plain "YYYY-MM-DD" strings and times are minutes after midnight,
// so none of the math depends on the viewer's time zone.

const DAY = 86_400_000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function parseDate(s) {
  const [y, m, d] = s.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

export function formatDate(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addDays(s, n) {
  return formatDate(parseDate(s) + n * DAY);
}

export function daysBetween(a, b) {
  return Math.round((parseDate(b) - parseDate(a)) / DAY);
}

/** 0 = Sunday … 6 = Saturday */
export function weekday(s) {
  return new Date(parseDate(s)).getUTCDay();
}

/** The Monday of the week `s` falls in. */
export function weekStart(s) {
  return addDays(s, -((weekday(s) + 6) % 7));
}

export function todayLocal(now = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function parseTime(s) {
  const [h, m] = s.split(':').map(Number);
  return h * 60 + (m || 0);
}

export function toTimeInput(min) {
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
}

export function formatTime(min) {
  const h = Math.floor(min / 60) % 24;
  const m = min % 60;
  const suffix = h < 12 ? 'AM' : 'PM';
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${suffix}`;
}

export function prettyDate(s) {
  const d = new Date(parseDate(s));
  return `${WEEKDAYS[d.getUTCDay()]}, ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

export function shortDate(s) {
  const d = new Date(parseDate(s));
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

export { WEEKDAYS };
