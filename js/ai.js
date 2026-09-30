// Optional: read a syllabus with Gemini (free tier, your own API key).
// Gemini returns JSON in the same shape as the built-in parser, and the same
// checks run on it afterward, so a model mistake shows up as a warning on
// the review screen instead of quietly ending up in your grades.

export const DEFAULT_MODEL = 'gemini-flash-latest';

const QUOTE = { type: 'STRING', description: 'The exact sentence or table row from the syllabus this came from, copied word for word' };

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
          quote: QUOTE,
        },
        required: ['days', 'start', 'end', 'quote'],
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
          fullCreditAt: { type: 'NUMBER', description: 'If earning this percent of the points counts as full credit (e.g. 85), else omit' },
          kind: { type: 'STRING', enum: ['exam', 'quiz', 'homework', 'project', 'paper', 'participation'] },
          date: { type: 'STRING', description: 'YYYY-MM-DD, only if the category is a single dated item' },
          time: { type: 'STRING', description: '24-hour HH:MM' },
          quote: QUOTE,
        },
        required: ['name', 'weight', 'kind', 'quote'],
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
          quote: QUOTE,
        },
        required: ['name', 'kind', 'date', 'quote'],
      },
    },
    rules: {
      type: 'OBJECT',
      description: 'Only rules the syllabus actually states. Leave out anything not stated.',
      properties: {
        roundAt: { type: 'NUMBER', description: 'If final grades round up at a decimal, e.g. 0.5' },
        roundAtQuote: QUOTE,
        finalReplacesLowest: { type: 'BOOLEAN', description: 'The final exam score replaces the lowest exam score' },
        finalReplacesLowestQuote: QUOTE,
        passExams: { type: 'NUMBER', description: 'Minimum exam average (percent) required to pass the course' },
        passExamsQuote: QUOTE,
        extraCreditMax: { type: 'NUMBER', description: 'Most extra credit, in percentage points of the final grade' },
        extraCreditMaxQuote: QUOTE,
      },
    },
    scale: {
      type: 'ARRAY',
      description: "The letter grade scale if the syllabus prints one, highest first, each letter's minimum percent",
      items: {
        type: 'OBJECT',
        properties: { letter: { type: 'STRING' }, min: { type: 'NUMBER' } },
        required: ['letter', 'min'],
      },
    },
    scaleQuote: QUOTE,
  },
  required: ['code', 'categories'],
};

/** Gemini's answer → the shape the built-in parser returns. */
export function fromGemini(out) {
  const r = out.rules ?? {};
  const rules = {};
  const sources = {};
  for (const key of ['roundAt', 'finalReplacesLowest', 'passExams', 'extraCreditMax']) {
    if (r[key] !== undefined && r[key] !== null && r[key] !== false) {
      rules[key] = r[key];
      if (r[`${key}Quote`]) sources[key] = r[`${key}Quote`];
    }
  }
  if (out.scaleQuote) sources.scale = out.scaleQuote;
  if (out.meetings?.[0]?.quote) sources.meetings = out.meetings[0].quote;
  return {
    code: out.code,
    name: out.name,
    meetings: out.meetings ?? [],
    categories: (out.categories ?? []).map((c) => ({ ...c, source: { weight: c.quote } })),
    items: (out.items ?? []).map((i) => ({ ...i, source: i.quote })),
    rules,
    sources,
    scale: out.scale,
  };
}

function prompt(text, ref) {
  return `You read college syllabi. Extract the course code and title, the regular class meeting times (not office hours), the grade breakdown, and every exam or major deadline with a date.

Rules:
- Category weights are percentages of the final grade and should add up to 100. If the syllabus uses points, convert them to percentages.
- If a category has sub-parts that are weighted separately, list the sub-parts instead of the parent.
- Only include dates that are actually written in the syllabus. Never guess a date.
- Dates without a year belong to the semester around ${ref}.
- Use the same names for items as the categories do (for example "Exam 1", not "First exam").
- Also find the fine print that changes the math: rounding, a final that replaces the lowest exam, a minimum exam average to pass, extra credit caps, "you only need X% of the points for full credit", and a printed letter-grade scale.
- For every number you report, include "quote": the exact text from the syllabus, copied word for word. It will be checked against the syllabus, and anything that can't be found will be flagged.

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
    return fromGemini(JSON.parse(out));
  } catch {
    throw new Error("Gemini's answer wasn't readable. Try again, or use the built-in reader.");
  }
}
