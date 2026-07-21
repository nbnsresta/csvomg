import type { ColumnType } from '../types/index.ts';

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
 * Recursively flattens nested objects/arrays into dot-delimited keys, array indices included
 * as path segments (e.g. `images.0.url`) — csvomg is a flat-table editor (see "What This Is
 * Not" in STATUS.md), so this is the default, lossy-by-design way it makes nested JSON fit a
 * grid, rather than refusing it or mangling it into a single stringified cell. An empty
 * object/array has no key to flatten into, so it's kept as a leaf (JSON-stringified downstream).
 */
function flattenValue(value: unknown, path: string, out: Record<string, unknown>): void {
  if (value !== null && typeof value === 'object') {
    const entries: Array<[string, unknown]> = Array.isArray(value)
      ? value.map((v, i) => [String(i), v])
      : Object.entries(value as Record<string, unknown>);
    if (entries.length > 0) {
      for (const [key, v] of entries) flattenValue(v, path ? `${path}.${key}` : key, out);
      return;
    }
  }
  out[path] = value;
}

function flattenRecord(record: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) flattenValue(value, key, out);
  return out;
}

function inferColumnType(value: unknown): ColumnType {
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  return 'text';
}

/**
 * Parses JSON text into a headers + rows table. Supports array-of-objects (headers = union of
 * flattened keys, first-seen order; nested objects/arrays flattened, see flattenValue) and
 * array-of-arrays (first row = headers, no flattening/type profile — there are no keys there).
 *
 * `columnTypes` is a best-effort profile of each column's original JSON type (number/boolean vs.
 * the default text), used by serializeJSON to export it back out as the right type. Scanned from
 * the *closest* non-null/undefined value per column, not just the first row — an early row's
 * null (or a row that lacks the field) shouldn't force a numeric/boolean column to read as text.
 */
export function parseJSON(text: string): { headers: string[]; rows: string[][]; columnTypes: Record<string, ColumnType> } {
  const data: unknown = JSON.parse(text);
  if (!Array.isArray(data)) {
    throw new Error('JSON must be an array of objects or an array of arrays');
  }
  if (data.length === 0) {
    return { headers: [], rows: [], columnTypes: {} };
  }

  if (Array.isArray(data[0])) {
    const [headerRow, ...rest] = data as unknown[][];
    const headers = headerRow.map(stringifyCell);
    const rows = rest.map((row) => padRow(row.map(stringifyCell), headers.length));
    return { headers, rows, columnTypes: {} };
  }

  const flatRecords = (data as Record<string, unknown>[]).map(flattenRecord);

  const headers: string[] = [];
  const seen = new Set<string>();
  for (const record of flatRecords) {
    for (const key of Object.keys(record)) {
      if (!seen.has(key)) {
        seen.add(key);
        headers.push(key);
      }
    }
  }

  const columnTypes: Record<string, ColumnType> = {};
  for (const header of headers) {
    for (const record of flatRecords) {
      const value = record[header];
      if (value === null || value === undefined) continue;
      columnTypes[header] = inferColumnType(value);
      break;
    }
  }

  const rows = flatRecords.map((record) => headers.map((h) => (h in record ? stringifyCell(record[h]) : '')));

  return { headers, rows, columnTypes };
}

/** True if a non-empty cell no longer parses as its profiled type — the case coerceForExport
 * falls back to exporting as a raw string for, silently producing a mixed-type JSON field unless
 * something upstream (see findTypeMismatchedColumns) catches it first. */
function isTypeMismatch(raw: string, type: ColumnType): boolean {
  if (type === 'text' || raw === '') return false;
  if (type === 'number') return Number.isNaN(Number(raw));
  return raw !== 'true' && raw !== 'false';
}

/** Coerces a cell's stored string back to its profiled JSON type for export. An empty cell
 * exports as `null` for number/boolean columns (not `0`/`false`, and not `""` — that would
 * silently turn a blank/absent value into a real one) but stays `""` for text, matching how a
 * text field's blank cell always meant an empty string, never "no value". A value that no longer
 * parses as its profiled type (e.g. a number cell hand-edited to non-numeric text) falls back to
 * the raw string rather than losing the edit — callers that care should check
 * findTypeMismatchedColumns first and offer the user a chance to resolve it. */
function coerceForExport(raw: string, type: ColumnType): string | number | boolean | null {
  if (type === 'text') return raw;
  if (raw === '') return null;
  if (isTypeMismatch(raw, type)) return raw;
  return type === 'number' ? Number(raw) : raw === 'true';
}

/** Column headers whose profiled number/boolean type no longer fits every current cell — used to
 * gate an interactive JSON save behind a confirmation before silently downgrading them to text on
 * export. Never flags text columns or empty cells (an empty cell already exports as `null`, by
 * design — not a mismatch). */
export function findTypeMismatchedColumns(
  headers: string[],
  rows: string[][],
  columnTypes: Record<string, ColumnType> = {},
): string[] {
  const mismatched: string[] = [];
  headers.forEach((h, i) => {
    const type = columnTypes[h] ?? 'text';
    if (type !== 'text' && rows.some((row) => isTypeMismatch(row[i] ?? '', type))) {
      mismatched.push(h);
    }
  });
  return mismatched;
}

/** True for a path segment that came from an array index when flattenValue ran (a canonical
 * non-negative integer string, no leading zeros — matches how flattenValue always wrote them via
 * String(i)) — as opposed to a real object key that just happens to look numeric (e.g. "01"). */
function isArrayIndexSegment(segment: string): boolean {
  return /^(0|[1-9]\d*)$/.test(segment);
}

/** True if `keys` are exactly the array indices 0..n-1, in any order — the shape flattenValue's
 * array handling always produces, so a node with exactly this shape can be rebuilt as an array. */
function isArrayShaped(keys: string[]): boolean {
  return keys.length > 0 && keys.every(isArrayIndexSegment) && new Set(keys).size === keys.length && keys.map(Number).sort((a, b) => a - b).every((n, i) => n === i);
}

/** Recursively turns any object whose own keys are array-shaped into a real array (turning
 * `{0: 'a', 1: 'b'}` into `['a', 'b']`), depth-first so a nested array-shaped object is converted
 * before its parent is checked. Applied to values *under* a record's own top-level keys, never to
 * the record itself — one exported row must always stay a JSON object, never become an array,
 * regardless of what its top-level header names happen to look like. */
function arrayify(node: unknown): unknown {
  if (node === null || typeof node !== 'object' || Array.isArray(node)) return node;
  const obj = node as Record<string, unknown>;
  const keys = Object.keys(obj);
  for (const k of keys) obj[k] = arrayify(obj[k]);
  return isArrayShaped(keys) ? keys.map(Number).sort((a, b) => a - b).map((i) => obj[String(i)]) : obj;
}

/** Inverse of flattenValue/flattenRecord — rebuilds nested objects/arrays from a flat record's
 * dot-delimited keys, so a re-exported JSON file gets its original shape back (as far as the flat
 * grid can reconstruct it) instead of staying flat with literal dotted keys forever. A path
 * segment that looks like an array index is only actually turned into one by arrayify, once all
 * of a level's keys are known — see isArrayShaped. Conflicting headers (e.g. both "company" and
 * "company.name" present at once, which only a hand-edited header could produce) resolve by
 * last-key-wins in header order — an accepted, rare edge case, not solvable without a UI to
 * arbitrate it. */
function unflattenRecord(flat: Record<string, unknown>): Record<string, unknown> {
  const root: Record<string, unknown> = {};
  for (const [path, value] of Object.entries(flat)) {
    const segments = path.split('.');
    let node = root;
    for (let i = 0; i < segments.length - 1; i++) {
      const seg = segments[i];
      if (typeof node[seg] !== 'object' || node[seg] === null || Array.isArray(node[seg])) {
        node[seg] = {};
      }
      node = node[seg] as Record<string, unknown>;
    }
    node[segments[segments.length - 1]] = value;
  }
  for (const key of Object.keys(root)) root[key] = arrayify(root[key]);
  return root;
}

/** Serializes a headers + rows table to a JSON array-of-objects string. `columnTypes` (from
 * parseJSON's import-time profile) restores number/boolean fields to their real JSON type instead
 * of exporting everything as a string; columns with no entry default to text, unchanged. A
 * dot-delimited header (from flattenValue at import) is unflattened back into nested
 * objects/arrays — see unflattenRecord — rather than staying flat with a literal dotted key. */
export function serializeJSON(headers: string[], rows: string[][], columnTypes: Record<string, ColumnType> = {}): string {
  const records = rows.map((row) => {
    const flat: Record<string, string | number | boolean | null> = {};
    headers.forEach((h, i) => {
      flat[h] = coerceForExport(row[i] ?? '', columnTypes[h] ?? 'text');
    });
    return unflattenRecord(flat);
  });
  return JSON.stringify(records, null, 2);
}
