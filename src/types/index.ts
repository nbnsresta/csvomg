export type FileType = 'csv' | 'json';

/** JSON-import type profile for a column, used to serialize it back out as the right JSON type
 * on export instead of always as a string. CSV has no notion of this — always 'text' there. */
export type ColumnType = 'text' | 'number' | 'boolean';

export interface DataModel {
  headers: string[];
  rows: string[][];
  meta: {
    filename: string;
    delimiter: string;
    columnTypes?: Record<string, ColumnType>;
  };
}

export interface Selection {
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
}

/** A discriminated union, not two independently-optional fields — when a sort is active, both
 * are always present together; `null` means no sort at all. */
export interface SortState {
  sortBy: number;
  sortOrder: 'asc' | 'desc';
}

export interface CellDiff {
  type: 'cell';
  row: number;
  col: number;
  before: string;
  after: string;
}

export interface RowDiff {
  type: 'row-insert' | 'row-delete';
  index: number;
  row: string[];
}

export interface ColumnDiff {
  type: 'col-insert' | 'col-delete';
  index: number;
  header: string;
  values: string[];
}

export interface HeaderRenameDiff {
  type: 'header-rename';
  index: number;
  before: string;
  after: string;
}

export interface ColumnReorderDiff {
  type: 'col-reorder';
  from: number;
  to: number;
}

export interface RowReorderDiff {
  type: 'row-reorder';
  from: number;
  to: number;
}

export type Diff = CellDiff | RowDiff | ColumnDiff | HeaderRenameDiff | ColumnReorderDiff | RowReorderDiff;

export interface Mutation<D extends Diff = Diff> {
  data: DataModel;
  diff: D;
}
