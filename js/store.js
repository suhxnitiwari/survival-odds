// Everything lives in this browser's localStorage. Storage can be blocked
// (private windows, strict settings), so every access is wrapped and the app
// still works, it just forgets on reload.

const KEY = 'survival-odds:v1';

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function save(state) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // Not saved, but nothing breaks.
  }
}

export function clear() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing to clear.
  }
}

// The syllabus reader settings (including a Gemini key, if you add one) are
// kept separately from your classes so "Start over" doesn't wipe them.
const READER_KEY = 'survival-odds:reader';

export function loadReader() {
  try {
    return JSON.parse(localStorage.getItem(READER_KEY)) ?? {};
  } catch {
    return {};
  }
}

export function saveReader(reader) {
  try {
    localStorage.setItem(READER_KEY, JSON.stringify(reader));
  } catch {
    // Not saved, but nothing breaks.
  }
}
