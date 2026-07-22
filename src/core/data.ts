import type {
  CellDiff,
  ColumnDiff,
  ColumnReorderDiff,
  ColumnType,
  DataModel,
  Diff,
  HeaderRenameDiff,
  Mutation,
  RowDiff,
  RowReorderDiff,
} from '../types/index.ts';

export function createDataModel(
  headers: string[],
  rows: string[][],
  filename = 'Untitled',
  delimiter = ',',
  columnTypes?: Record<string, ColumnType>,
): DataModel {
  return {
    headers: [...headers],
    rows: rows.map((row) => [...row]),
    meta: { filename, delimiter, ...(columnTypes ? { columnTypes } : {}) },
  };
}

/** Renames a key in a column-type profile map, dropping it if absent — used so a JSON-imported
 * column's number/boolean type follows a header rename instead of silently reverting to text. */
function renameTypeKey(
  types: Record<string, ColumnType> | undefined,
  from: string,
  to: string,
): Record<string, ColumnType> | undefined {
  if (!types || !(from in types)) return types;
  const { [from]: type, ...rest } = types;
  return { ...rest, [to]: type };
}

/** Drops a key from a column-type profile map — used so a deleted JSON-imported column's type
 * doesn't linger and get silently reused if a new column is later given the same header name. */
function omitTypeKey(types: Record<string, ColumnType> | undefined, key: string): Record<string, ColumnType> | undefined {
  if (!types || !(key in types)) return types;
  const { [key]: _omitted, ...rest } = types;
  return rest;
}

/** Permanently downgrades the given columns' profiled type to text (by dropping their
 * columnTypes entry — the same default an unprofiled column already gets). Used once the user
 * confirms an export-time type-mismatch resolution, so later saves (including auto-save) stop
 * re-flagging it. Not undo/redo-tracked — same precedent as saveAs()'s direct filename mutation
 * in main.ts: this is tab metadata about export representation, not a content edit the user
 * expects to Ctrl+Z. */
export function downgradeColumnsToText(data: DataModel, headers: string[]): DataModel {
  if (!data.meta.columnTypes) return data;
  const columnTypes = { ...data.meta.columnTypes };
  let changed = false;
  for (const h of headers) {
    if (h in columnTypes) {
      delete columnTypes[h];
      changed = true;
    }
  }
  return changed ? { ...data, meta: { ...data.meta, columnTypes } } : data;
}

/** True if any cell has non-whitespace content. Header text alone doesn't count. */
export function hasContent(data: DataModel): boolean {
  return data.rows.some((row) => row.some((cell) => cell.trim() !== ''));
}

export function moveItem<T>(arr: T[], from: number, to: number): T[] {
  const copy = [...arr];
  const [item] = copy.splice(from, 1);
  copy.splice(to, 0, item);
  return copy;
}

export function setCell(data: DataModel, row: number, col: number, value: string): Mutation<CellDiff> {
  const before = data.rows[row]?.[col] ?? '';
  const rows = data.rows.map((r, i) => (i === row ? r.map((c, j) => (j === col ? value : c)) : r));
  return {
    data: { ...data, rows },
    diff: { type: 'cell', row, col, before, after: value },
  };
}

export function insertRow(data: DataModel, index: number, row?: string[]): Mutation<RowDiff> {
  const newRow = row ? [...row] : Array.from({ length: data.headers.length }, () => '');
  const rows = [...data.rows.slice(0, index), newRow, ...data.rows.slice(index)];
  return {
    data: { ...data, rows },
    diff: { type: 'row-insert', index, row: newRow },
  };
}

export function deleteRow(data: DataModel, index: number): Mutation<RowDiff> {
  const row = data.rows[index];
  const rows = [...data.rows.slice(0, index), ...data.rows.slice(index + 1)];
  return {
    data: { ...data, rows },
    diff: { type: 'row-delete', index, row: [...row] },
  };
}

export function duplicateRow(data: DataModel, index: number): Mutation<RowDiff> {
  return insertRow(data, index + 1, data.rows[index]);
}

export function insertColumn(
  data: DataModel,
  index: number,
  header = '',
  values?: string[],
): Mutation<ColumnDiff> {
  const headers = [...data.headers.slice(0, index), header, ...data.headers.slice(index)];
  const colValues = values ?? data.rows.map(() => '');
  const rows = data.rows.map((r, i) => [...r.slice(0, index), colValues[i] ?? '', ...r.slice(index)]);
  return {
    data: { ...data, headers, rows },
    diff: { type: 'col-insert', index, header, values: colValues },
  };
}

export function deleteColumn(data: DataModel, index: number): Mutation<ColumnDiff> {
  const header = data.headers[index];
  const values = data.rows.map((r) => r[index]);
  const headers = [...data.headers.slice(0, index), ...data.headers.slice(index + 1)];
  const rows = data.rows.map((r) => [...r.slice(0, index), ...r.slice(index + 1)]);
  const meta = { ...data.meta, columnTypes: omitTypeKey(data.meta.columnTypes, header) };
  return {
    data: { ...data, headers, rows, meta },
    diff: { type: 'col-delete', index, header, values },
  };
}

export function renameColumn(data: DataModel, index: number, name: string): Mutation<HeaderRenameDiff> {
  const before = data.headers[index];
  const headers = data.headers.map((h, i) => (i === index ? name : h));
  const meta = { ...data.meta, columnTypes: renameTypeKey(data.meta.columnTypes, before, name) };
  return {
    data: { ...data, headers, meta },
    diff: { type: 'header-rename', index, before, after: name },
  };
}

export function reorderColumn(data: DataModel, from: number, to: number): Mutation<ColumnReorderDiff> {
  const headers = moveItem(data.headers, from, to);
  const rows = data.rows.map((r) => moveItem(r, from, to));
  return {
    data: { ...data, headers, rows },
    diff: { type: 'col-reorder', from, to },
  };
}

export function reorderRow(data: DataModel, from: number, to: number): Mutation<RowReorderDiff> {
  const rows = moveItem(data.rows, from, to);
  return {
    data: { ...data, rows },
    diff: { type: 'row-reorder', from, to },
  };
}

export const BUFFER_ROWS = 1;
export const BUFFER_COLS = 1;

/** 0->A, 25->Z, 26->AA, ... — same convention newFile()'s original ['A','B','C'] headers used. */
export function nextColumnLetter(index: number): string {
  let n = index;
  let name = '';
  do {
    name = String.fromCharCode(65 + (n % 26)) + name;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return name;
}

function isRowEmpty(row: string[]): boolean {
  return row.every((cell) => cell.trim() === '');
}

function isColumnEmpty(data: DataModel, col: number): boolean {
  return data.rows.every((row) => (row[col] ?? '').trim() === '');
}

/**
 * Row/column counts for display (status bar): only rows/columns with real cell content, same
 * "header text alone doesn't count" convention as hasContent() — a column can be entirely blank
 * (no data ever typed into it) while still carrying a non-blank header, e.g. an untouched buffer
 * column's auto-assigned letter, or any other column whose header survived but whose data didn't.
 * Not scoped to trailing/buffer positions specifically — any blank row/column is excluded,
 * wherever it sits.
 */
export function countDataRows(data: DataModel): number {
  return data.rows.filter((row) => !isRowEmpty(row)).length;
}

export function countDataColumns(data: DataModel): number {
  let count = 0;
  for (let c = 0; c < data.headers.length; c++) {
    if (!isColumnEmpty(data, c)) count++;
  }
  return count;
}

function countTrailingEmptyColumns(data: DataModel): number {
  let count = 0;
  for (let c = data.headers.length - 1; c >= 0 && isColumnEmpty(data, c); c--) count++;
  return count;
}

function countTrailingEmptyRows(data: DataModel): number {
  let count = 0;
  for (let r = data.rows.length - 1; r >= 0 && isRowEmpty(data.rows[r]); r--) count++;
  return count;
}

/**
 * Ensures exactly BUFFER_ROWS trailing blank rows and BUFFER_COLS trailing blank columns,
 * growing or trimming as needed. "Blank" mirrors hasContent()'s convention (trim + non-empty
 * check) but per-row/per-column instead of whole-model; header text is not considered, only
 * cell content. Returns the adjusted data plus whatever diffs produced it (empty if already
 * balanced), so callers fold this into an existing undo group instead of it being its own step.
 */
export function normalizeTrailingBuffer(data: DataModel): { data: DataModel; diffs: Diff[] } {
  let current = data;
  const diffs: Diff[] = [];

  const trailingEmptyCols = countTrailingEmptyColumns(current);
  if (trailingEmptyCols < BUFFER_COLS) {
    for (let i = trailingEmptyCols; i < BUFFER_COLS; i++) {
      const m = insertColumn(current, current.headers.length, nextColumnLetter(current.headers.length));
      current = m.data;
      diffs.push(m.diff);
    }
  } else if (trailingEmptyCols > BUFFER_COLS) {
    for (let i = 0; i < trailingEmptyCols - BUFFER_COLS; i++) {
      const m = deleteColumn(current, current.headers.length - 1);
      current = m.data;
      diffs.push(m.diff);
    }
  }

  const trailingEmptyRows = countTrailingEmptyRows(current);
  if (trailingEmptyRows < BUFFER_ROWS) {
    for (let i = trailingEmptyRows; i < BUFFER_ROWS; i++) {
      const m = insertRow(current, current.rows.length);
      current = m.data;
      diffs.push(m.diff);
    }
  } else if (trailingEmptyRows > BUFFER_ROWS) {
    for (let i = 0; i < trailingEmptyRows - BUFFER_ROWS; i++) {
      const m = deleteRow(current, current.rows.length - 1);
      current = m.data;
      diffs.push(m.diff);
    }
  }

  return { data: current, diffs };
}

/** Strips all fully-blank trailing rows/columns (down to zero, not BUFFER_ROWS/BUFFER_COLS) —
 * for save-time output, so a saved file never carries live-editing buffer padding. Never mutates
 * `data`; the caller's in-memory tab keeps its buffer untouched. */
export function trimTrailingBlank(data: DataModel): DataModel {
  let current = data;
  for (let c = current.headers.length - 1; c >= 0 && isColumnEmpty(current, c); c--) {
    current = deleteColumn(current, c).data;
  }
  for (let r = current.rows.length - 1; r >= 0 && isRowEmpty(current.rows[r]); r--) {
    current = deleteRow(current, r).data;
  }
  return current;
}

/** Applies a diff (forward) to a data model. Used to replay redo steps. */
export function applyDiff(data: DataModel, diff: Diff): DataModel {
  switch (diff.type) {
    case 'cell':
      return setCell(data, diff.row, diff.col, diff.after).data;
    case 'row-insert':
      return insertRow(data, diff.index, diff.row).data;
    case 'row-delete':
      return deleteRow(data, diff.index).data;
    case 'col-insert':
      return insertColumn(data, diff.index, diff.header, diff.values).data;
    case 'col-delete':
      return deleteColumn(data, diff.index).data;
    case 'header-rename':
      return renameColumn(data, diff.index, diff.after).data;
    case 'col-reorder':
      return reorderColumn(data, diff.from, diff.to).data;
    case 'row-reorder':
      return reorderRow(data, diff.from, diff.to).data;
  }
}

/** Produces the inverse of a diff. Applying it undoes the original diff. */
export function invertDiff(diff: Diff): Diff {
  switch (diff.type) {
    case 'cell':
      return { ...diff, before: diff.after, after: diff.before };
    case 'row-insert':
      return { type: 'row-delete', index: diff.index, row: diff.row };
    case 'row-delete':
      return { type: 'row-insert', index: diff.index, row: diff.row };
    case 'col-insert':
      return { type: 'col-delete', index: diff.index, header: diff.header, values: diff.values };
    case 'col-delete':
      return { type: 'col-insert', index: diff.index, header: diff.header, values: diff.values };
    case 'header-rename':
      return { type: 'header-rename', index: diff.index, before: diff.after, after: diff.before };
    case 'col-reorder':
      return { type: 'col-reorder', from: diff.to, to: diff.from };
    case 'row-reorder':
      return { type: 'row-reorder', from: diff.to, to: diff.from };
  }
}

/** Applies a diff's inverse — i.e. undoes it. */
export function undoDiff(data: DataModel, diff: Diff): DataModel {
  return applyDiff(data, invertDiff(diff));
}
