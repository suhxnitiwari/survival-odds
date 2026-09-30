// Pulls the text out of a PDF in the browser with pdf.js. Pieces of text on
// the same line are joined by their position, so a table row like
// "Exam 1 … 20%" stays on one line even when the PDF stores it in columns.

const PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/6.3.289';

let lib;
async function pdfjs() {
  if (!lib) {
    lib = await import(`${PDFJS}/pdf.min.mjs`);
    lib.GlobalWorkerOptions.workerSrc = `${PDFJS}/pdf.worker.min.mjs`;
  }
  return lib;
}

export async function pdfText(file) {
  const { getDocument } = await pdfjs();
  const doc = await getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const pages = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const { items } = await page.getTextContent();
    const rows = [];
    for (const it of items) {
      if (!it.str?.trim()) continue;
      const y = it.transform[5];
      const x = it.transform[4];
      let row = rows.find((r) => Math.abs(r.y - y) < 3);
      if (!row) rows.push((row = { y, parts: [] }));
      row.parts.push({ x, s: it.str });
    }
    rows.sort((a, b) => b.y - a.y);
    pages.push(rows.map((r) => r.parts.sort((a, b) => a.x - b.x).map((q) => q.s).join(' ')).join('\n'));
  }
  return pages.join('\n');
}
