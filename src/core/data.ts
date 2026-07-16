import type {
  CellDiff,
  ColumnDiff,
  ColumnReorderDiff,
  DataModel,
  Diff,
  HeaderRenameDiff,
  Mutation,
  RowDiff,
} from '../types/index.ts';

export function createDataModel(
  headers: string[],
  rows: string[][],
  filename = 'Untitled',
  delimiter = ',',
): DataModel {
  return {
    headers: [...headers],
    rows: rows.map((row) => [...row]),
    meta: { filename, delimiter },
  };
}

/** True if any cell has non-whitespace content. Header text alone doesn't count. */
export function hasContent(data: DataModel): boolean {
  return data.rows.some((row) => row.some((cell) => cell.trim() !== ''));
}

function moveItem<T>(arr: T[], from: number, to: number): T[] {
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
  return {
    data: { ...data, headers, rows },
    diff: { type: 'col-delete', index, header, values },
  };
}

export function renameColumn(data: DataModel, index: number, name: string): Mutation<HeaderRenameDiff> {
  const before = data.headers[index];
  const headers = data.headers.map((h, i) => (i === index ? name : h));
  return {
    data: { ...data, headers },
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
  }
}

/** Applies a diff's inverse — i.e. undoes it. */
export function undoDiff(data: DataModel, diff: Diff): DataModel {
  return applyDiff(data, invertDiff(diff));
}
