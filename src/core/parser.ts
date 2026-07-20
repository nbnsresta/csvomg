export interface ParsedTable {
  headers: string[];
  rows: string[][];
  delimiter: string;
}

export const CANDIDATE_DELIMITERS = [',', '\t', ';', '|'];

/** Guesses the field delimiter by counting occurrences (outside quotes) across sample lines. */
export function detectDelimiter(text: string): string {
  const sampleLines = text.split(/\r\n|\r|\n/).slice(0, 5).filter((line) => line.length > 0);
  let best = CANDIDATE_DELIMITERS[0];
  let bestScore = -1;

  for (const delim of CANDIDATE_DELIMITERS) {
    const counts = sampleLines.map((line) => countOutsideQuotes(line, delim));
    if (counts.length === 0 || counts[0] === 0) continue;
    const consistent = counts.every((c) => c === counts[0]);
    // Reward delimiters that split every sampled line the same number of times.
    const score = consistent ? counts[0] * 2 : counts[0];
    if (score > bestScore) {
      bestScore = score;
      best = delim;
    }
  }
  return best;
}

function countOutsideQuotes(line: string, delim: string): number {
  let count = 0;
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === delim && !inQuotes) {
      count++;
    }
  }
  return count;
}

/** RFC 4180 tokenizer: handles quoted fields, escaped quotes (""), and CRLF/LF/CR line endings. */
function tokenizeDelimited(text: string, delim: string): string[][] {
  const records: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  const len = text.length;

  const pushField = () => {
    row.push(field);
    field = '';
  };
  const pushRow = () => {
    pushField();
    records.push(row);
    row = [];
  };

  while (i < len) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
        } else {
          inQuotes = false;
          i++;
        }
      } else {
        field += ch;
        i++;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      i++;
    } else if (ch === delim) {
      pushField();
      i++;
    } else if (ch === '\r') {
      pushRow();
      i += text[i + 1] === '\n' ? 2 : 1;
    } else if (ch === '\n') {
      pushRow();
      i++;
    } else {
      field += ch;
      i++;
    }
  }

  // Trailing content that wasn't terminated by a newline.
  if (field.length > 0 || row.length > 0) {
    pushRow();
  }

  return records;
}

function padRow(row: string[], length: number): string[] {
  if (row.length >= length) return row;
  return [...row, ...Array.from({ length: length - row.length }, () => '')];
}

/** Parses CSV/TSV text into a headers + rows table. Auto-detects the delimiter if not given. */
export function parseCSV(text: string, delimiter?: string): ParsedTable {
  const delim = delimiter ?? detectDelimiter(text);
  const records = tokenizeDelimited(text, delim);
  if (records.length === 0) {
    return { headers: [], rows: [], delimiter: delim };
  }
  const [headers, ...rawRows] = records;
  const rows = rawRows.map((row) => padRow(row, headers.length));
  return { headers, rows, delimiter: delim };
}

/** Serializes a headers + rows table back to CSV/TSV text, quoting fields that need it. */
export function serializeCSV(headers: string[], rows: string[][], delimiter = ','): string {
  const escape = (value: string): string => {
    if (value.includes(delimiter) || value.includes('"') || value.includes('\n') || value.includes('\r')) {
      return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
  };
  return [headers, ...rows].map((row) => row.map(escape).join(delimiter)).join('\r\n');
}

function stringifyCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

/**
 * Parses JSON text into a headers + rows table. Supports array-of-objects (headers = union
 * of keys, first-seen order) and array-of-arrays (first row = headers).
 */
export function parseJSON(text: string): { headers: string[]; rows: string[][] } {
  const data: unknown = JSON.parse(text);
  if (!Array.isArray(data)) {
    throw new Error('JSON must be an array of objects or an array of arrays');
  }
  if (data.length === 0) {
    return { headers: [], rows: [] };
  }

  if (Array.isArray(data[0])) {
    const [headerRow, ...rest] = data as unknown[][];
    const headers = headerRow.map(stringifyCell);
    const rows = rest.map((row) => padRow(row.map(stringifyCell), headers.length));
    return { headers, rows };
  }

  const headers: string[] = [];
  const seen = new Set<string>();
  for (const record of data as Record<string, unknown>[]) {
    for (const key of Object.keys(record)) {
      if (!seen.has(key)) {
        seen.add(key);
        headers.push(key);
      }
    }
  }

  const rows = (data as Record<string, unknown>[]).map((record) =>
    headers.map((h) => (h in record ? stringifyCell(record[h]) : '')),
  );

  return { headers, rows };
}

/** Serializes a headers + rows table to a JSON array-of-objects string. */
export function serializeJSON(headers: string[], rows: string[][]): string {
  const records = rows.map((row) => {
    const record: Record<string, string> = {};
    headers.forEach((h, i) => {
      record[h] = row[i] ?? '';
    });
    return record;
  });
  return JSON.stringify(records, null, 2);
}
