import { describe, expect, it } from 'vitest';
import {
  applyDiff,
  createDataModel,
  deleteColumn,
  deleteRow,
  duplicateRow,
  hasContent,
  insertColumn,
  insertRow,
  invertDiff,
  renameColumn,
  reorderColumn,
  setCell,
  undoDiff,
} from '../src/core/data.ts';
import type { DataModel } from '../src/types/index.ts';

function sample(): DataModel {
  return createDataModel(
    ['a', 'b'],
    [
      ['1', '2'],
      ['3', '4'],
    ],
    'test.csv',
  );
}

describe('createDataModel', () => {
  it('deep-copies headers and rows so the source arrays are not aliased', () => {
    const headers = ['a'];
    const rows = [['1']];
    const model = createDataModel(headers, rows);
    model.headers.push('b');
    model.rows[0].push('2');
    expect(headers).toEqual(['a']);
    expect(rows).toEqual([['1']]);
  });
});

describe('setCell', () => {
  it('updates the target cell without mutating the original data', () => {
    const original = sample();
    const { data, diff } = setCell(original, 0, 1, 'X');
    expect(data.rows[0]).toEqual(['1', 'X']);
    expect(original.rows[0]).toEqual(['1', '2']);
    expect(diff).toEqual({ type: 'cell', row: 0, col: 1, before: '2', after: 'X' });
  });
});

describe('insertRow / deleteRow', () => {
  it('are inverses of each other', () => {
    const original = sample();
    const { data: inserted, diff: insertDiff } = insertRow(original, 1, ['9', '9']);
    expect(inserted.rows).toEqual([
      ['1', '2'],
      ['9', '9'],
      ['3', '4'],
    ]);
    const restored = undoDiff(inserted, insertDiff);
    expect(restored.rows).toEqual(original.rows);

    const { data: deleted, diff: deleteDiff } = deleteRow(original, 0);
    expect(deleted.rows).toEqual([['3', '4']]);
    const restoredFromDelete = undoDiff(deleted, deleteDiff);
    expect(restoredFromDelete.rows).toEqual(original.rows);
  });
});

describe('duplicateRow', () => {
  it('inserts a copy directly after the source row', () => {
    const { data } = duplicateRow(sample(), 0);
    expect(data.rows).toEqual([
      ['1', '2'],
      ['1', '2'],
      ['3', '4'],
    ]);
  });
});

describe('insertColumn / deleteColumn', () => {
  it('are inverses of each other', () => {
    const original = sample();
    const { data: inserted, diff: insertDiff } = insertColumn(original, 1, 'new', ['x', 'y']);
    expect(inserted.headers).toEqual(['a', 'new', 'b']);
    expect(inserted.rows).toEqual([
      ['1', 'x', '2'],
      ['3', 'y', '4'],
    ]);
    const restored = undoDiff(inserted, insertDiff);
    expect(restored).toEqual(original);

    const { data: deleted, diff: deleteDiff } = deleteColumn(original, 0);
    expect(deleted.headers).toEqual(['b']);
    expect(deleted.rows).toEqual([['2'], ['4']]);
    const restoredFromDelete = undoDiff(deleted, deleteDiff);
    expect(restoredFromDelete).toEqual(original);
  });
});

describe('renameColumn', () => {
  it('renames the header and inverts cleanly', () => {
    const original = sample();
    const { data, diff } = renameColumn(original, 0, 'alpha');
    expect(data.headers).toEqual(['alpha', 'b']);
    expect(undoDiff(data, diff)).toEqual(original);
  });
});

describe('reorderColumn', () => {
  it('moves a column and its inverse restores original order', () => {
    const original = createDataModel(
      ['a', 'b', 'c'],
      [
        ['1', '2', '3'],
        ['4', '5', '6'],
      ],
    );
    const { data, diff } = reorderColumn(original, 0, 2);
    expect(data.headers).toEqual(['b', 'c', 'a']);
    expect(data.rows).toEqual([
      ['2', '3', '1'],
      ['5', '6', '4'],
    ]);
    const restored = undoDiff(data, diff);
    expect(restored).toEqual(original);
  });
});

describe('applyDiff / invertDiff', () => {
  it('applying a diff then its inverse returns to the original state for every diff type', () => {
    const original = sample();
    const mutations = [
      setCell(original, 0, 0, 'z'),
      insertRow(original, 0, ['x', 'y']),
      deleteRow(original, 1),
      insertColumn(original, 0, 'new'),
      deleteColumn(original, 1),
      renameColumn(original, 0, 'renamed'),
    ];
    for (const { data, diff } of mutations) {
      const roundTripped = applyDiff(data, invertDiff(diff));
      expect(roundTripped).toEqual(original);
    }
  });
});

describe('hasContent', () => {
  it('is false for a blank starter document', () => {
    const blank = createDataModel(['A', 'B', 'C'], [['', '', '']], 'Untitled_1.csv');
    expect(hasContent(blank)).toBe(false);
  });

  it('is false when rows contain only whitespace', () => {
    const whitespaceOnly = createDataModel(['A', 'B'], [['  ', '\t']], 'test.csv');
    expect(hasContent(whitespaceOnly)).toBe(false);
  });

  it('ignores header text and only looks at cell values', () => {
    const renamedOnly = createDataModel(['Name', 'Age'], [['', '']], 'test.csv');
    expect(hasContent(renamedOnly)).toBe(false);
  });

  it('is true as soon as any cell has non-whitespace content', () => {
    expect(hasContent(sample())).toBe(true);
  });
});
