// Turns a Studio "data file" (report, dataset, publication — anything
// besides the source video) into a text block the AI prompt can actually
// use. Previously these were accepted and logged but never read; this is
// what wires them in for real.
//
// Known gap: old-format .doc (application/msword, pre-2007 Word) still
// falls back to filename-only context — there's no lightweight pure-JS
// parser for it without a much heavier dependency (LibreOffice conversion,
// antiword, etc.) for a format that's genuinely rare now that .docx is the
// default. Flagging this rather than silently doing nothing about it.
const MAX_CHARS = 4000;

function truncate(text) {
  const cleaned = String(text || '').replace(/\s+/g, ' ').trim();
  return cleaned.length > MAX_CHARS ? `${cleaned.slice(0, MAX_CHARS)}… [truncated]` : cleaned;
}

// Minimal delimited-text summary (CSV or TSV) — header row + a handful of
// sample rows. Deliberately not a full RFC-4180 parser (no quoted-comma
// handling); good enough for giving the AI a sense of what the dataset
// contains, not for re-ingesting the data itself.
function summarizeDelimited(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return null;
  const header = lines[0];
  const sample = lines.slice(1, 6).join('\n');
  return `Columns: ${header}\nSample rows:\n${sample}`;
}

async function extractOne(file) {
  if (!file?.url) return null;
  const name = file.name || '';
  try {
    const res = await fetch(file.url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const mime = file.mimeType || '';

    if (mime === 'application/pdf') {
      const buffer = Buffer.from(await res.arrayBuffer());
      const { default: pdfParse } = await import('pdf-parse');
      const parsed = await pdfParse(buffer);
      return `${name || 'Report'} (PDF):\n${truncate(parsed.text)}`;
    }

    if (mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
      const buffer = Buffer.from(await res.arrayBuffer());
      const { default: mammoth } = await import('mammoth');
      const result = await mammoth.extractRawText({ buffer });
      return `${name || 'Report'} (Word document):\n${truncate(result.value)}`;
    }

    if (mime === 'text/csv' || /\.csv$/i.test(name)) {
      const text = await res.text();
      const summary = summarizeDelimited(text);
      return summary ? `${name || 'Dataset'} (CSV):\n${summary}` : null;
    }

    if (mime === 'text/tab-separated-values' || /\.tsv$/i.test(name)) {
      const text = await res.text();
      const summary = summarizeDelimited(text);
      return summary ? `${name || 'Dataset'} (TSV):\n${summary}` : null;
    }

    if (mime === 'application/json' || /\.json$/i.test(name)) {
      const text = await res.text();
      // Re-stringify (rather than pass the raw text through) so a
      // minified/single-line JSON file still reads as structured data in
      // the prompt instead of one giant unreadable line.
      try {
        const parsed = JSON.parse(text);
        return `${name || 'Data file'} (JSON):\n${truncate(JSON.stringify(parsed, null, 2))}`;
      } catch {
        return `${name || 'Data file'} (JSON):\n${truncate(text)}`;
      }
    }

    if (
      mime === 'application/vnd.ms-excel' ||
      mime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
      /\.xlsx?$/i.test(name)
    ) {
      const buffer = Buffer.from(await res.arrayBuffer());
      const XLSX = await import('xlsx');
      const workbook = XLSX.read(buffer, { type: 'buffer' });
      const sheetSummaries = workbook.SheetNames.slice(0, 3).map((sheetName) => {
        const sheet = workbook.Sheets[sheetName];
        const csv = XLSX.utils.sheet_to_csv(sheet);
        const summary = summarizeDelimited(csv);
        return summary ? `Sheet "${sheetName}":\n${summary}` : null;
      }).filter(Boolean);
      return sheetSummaries.length
        ? `${name || 'Spreadsheet'} (Excel):\n${truncate(sheetSummaries.join('\n\n'))}`
        : null;
    }

    // Old-format .doc — see the file-level comment above.
    return `${name || 'Attached file'}: uploaded but this format isn't parsed server-side yet (PDF, .docx, .csv, .tsv, .json, .xlsx/.xls are) — the AI only knows this file's name, not its contents.`;
  } catch (err) {
    console.warn(`Studio: could not read data file "${name}":`, err.message);
    return `${name || 'Attached file'}: could not be read (${err.message}) — the AI is proceeding without its contents.`;
  }
}

// Runs every file's extraction in parallel and joins the results into one
// block ready to drop into the analysis prompt. Never throws — a file that
// fails to parse degrades to a short note about it rather than blocking
// the whole reel.
export async function buildDataContext(dataFiles = []) {
  if (!dataFiles?.length) return '';
  const blocks = await Promise.all(dataFiles.map(extractOne));
  return blocks.filter(Boolean).join('\n\n');
}
