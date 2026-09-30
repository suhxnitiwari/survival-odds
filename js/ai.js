// Optional: read a syllabus with Gemini (free tier, your own API key).
// Gemini returns JSON in the same shape as the built-in parser, and the same
// checks run on it afterward, so a model mistake shows up as a warning on
// the review screen instead of quietly ending up in your grades.

export const DEFAULT_MODEL = 'gemini-flash-latest';

const SCHEMA = {
  type: 'OBJECT',
  properties: {
    code: { type: 'STRING', description: 'Course code, e.g. "ABC 123"' },
    name: { type: 'STRING', description: 'Course title' },
    meetings: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          days: { type: 'ARRAY', items: { type: 'INTEGER' }, description: '0=Sun, 1=Mon … 6=Sat' },
          start: { type: 'STRING', description: '24-hour HH:MM' },
          end: { type: 'STRING', description: '24-hour HH:MM' },
        },
        required: ['days', 'start', 'end'],
      },
    },
    categories: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          name: { type: 'STRING' },
          weight: { type: 'NUMBER', description: 'Percent of the final grade' },
          count: { type: 'INTEGER', description: 'How many graded items, if stated' },
          dropLowest: { type: 'INTEGER' },
          kind: { type: 'STRING', enum: ['exam', 'quiz', 'homework', 'project', 'paper', 'participation'] },
          date: { type: 'STRING', description: 'YYYY-MM-DD, only if the category is a single dated item' },
          time: { type: 'STRING', description: '24-hour HH:MM' },
        },
        required: ['name', 'weight', 'kind'],
      },
    },
    items: {
      type: 'ARRAY',
      description: 'Exams and big deadlines that have a specific date',
      items: {
        type: 'OBJECT',
        properties: {
          name: { type: 'STRING', description: 'Exactly as it appears in categories where possible, e.g. "Exam 1"' },
          kind: { type: 'STRING', enum: ['exam', 'quiz', 'homework', 'project', 'paper', 'participation'] },
          date: { type: 'STRING', description: 'YYYY-MM-DD' },
          time: { type: 'STRING', description: '24-hour HH:MM' },
        },
        required: ['name', 'kind', 'date'],
      },
    },
  },
  required: ['code', 'categories'],
};

function prompt(text, ref) {
  return `You read college syllabi. Extract the course code and title, the regular class meeting times (not office hours), the grade breakdown, and every exam or major deadline with a date.

Rules:
- Category weights are percentages of the final grade and should add up to 100. If the syllabus uses points, convert them to percentages.
- If a category has sub-parts that are weighted separately, list the sub-parts instead of the parent.
- Only include dates that are actually written in the syllabus. Never guess a date.
- Dates without a year belong to the semester around ${ref}.
- Use the same names for items as the categories do (for example "Exam 1", not "First exam").

Syllabus:
"""
${text.slice(0, 60000)}
"""`;
}

export async function readWithGemini(text, { apiKey, model = DEFAULT_MODEL, ref, signal }) {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt(text, ref) }] }],
      generationConfig: { temperature: 0, responseMimeType: 'application/json', responseSchema: SCHEMA },
    }),
    signal,
  });
  if (!res.ok) {
    let detail = '';
    try { detail = (await res.json()).error?.message ?? ''; } catch { /* not JSON */ }
    if (res.status === 400 && /api key/i.test(detail)) throw new Error("Gemini didn't accept that API key.");
    if (res.status === 429) throw new Error("Gemini's free tier is out of requests for the moment. Try again in a minute, or use the built-in reader.");
    if (res.status === 404) throw new Error(`Gemini doesn't have a model called "${model}". Check the model name.`);
    throw new Error(`Gemini returned an error (${res.status}). ${detail}`.trim());
  }
  const data = await res.json();
  const out = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
  try {
    return JSON.parse(out);
  } catch {
    throw new Error("Gemini's answer wasn't readable. Try again, or use the built-in reader.");
  }
}
