import { describe, expect, it } from 'vitest';
import { createDataModel, deleteRow, insertColumn, setCell } from '../src/core/data.ts';
import { createHistory, pushGroup, redo, undo } from '../src/core/history.ts';
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

describe('history undo/redo', () => {
  it('undo reverts a single-diff group and redo reapplies it', () => {
    const original = sample();
    const mutation = setCell(original, 0, 0, 'z');
    let history = createHistory();
    history = pushGroup(history, [mutation.diff]);

    const undone = undo(history, mutation.data);
    expect(undone).not.toBeNull();
    expect(undone!.data).toEqual(original);

    const redone = redo(undone!.history, undone!.data);
    expect(redone).not.toBeNull();
    expect(redone!.data).toEqual(mutation.data);
  });

  it('undoes a multi-diff group (e.g. clearing several cells) as one step', () => {
    const original = sample();
    const first = setCell(original, 0, 0, '');
    const second = setCell(first.data, 0, 1, '');
    let history = createHistory();
    history = pushGroup(history, [first.diff, second.diff]);

    const undone = undo(history, second.data);
    expect(undone).not.toBeNull();
    expect(undone!.data).toEqual(original);
    expect(undone!.history.undoStack).toHaveLength(0);
  });

  it('undo/redo compose correctly across different diff types', () => {
    const original = sample();
    const inserted = insertColumn(original, 0, 'new');
    const deleted = deleteRow(inserted.data, 1);
    let history = createHistory();
    history = pushGroup(history, [inserted.diff]);
    history = pushGroup(history, [deleted.diff]);

    let state = deleted.data;
    let result = undo(history, state);
    expect(result).not.toBeNull();
    state = result!.data;
    history = result!.history;
    expect(state).toEqual(inserted.data);

    result = undo(history, state);
    expect(result).not.toBeNull();
    state = result!.data;
    history = result!.history;
    expect(state).toEqual(original);

    expect(undo(history, state)).toBeNull();
  });

  it('a new mutation after an undo clears the redo stack', () => {
    const original = sample();
    const mutation = setCell(original, 0, 0, 'z');
    let history = createHistory();
    history = pushGroup(history, [mutation.diff]);

    const undone = undo(history, mutation.data)!;
    history = undone.history;
    expect(history.redoStack).toHaveLength(1);

    const another = setCell(undone.data, 1, 1, 'y');
    history = pushGroup(history, [another.diff]);
    expect(history.redoStack).toHaveLength(0);
    expect(redo(history, another.data)).toBeNull();
  });

  it('undo/redo on an empty history is a no-op (returns null)', () => {
    const history = createHistory();
    expect(undo(history, sample())).toBeNull();
    expect(redo(history, sample())).toBeNull();
  });

  it('pushing an empty group is a no-op', () => {
    const history = createHistory();
    const next = pushGroup(history, []);
    expect(next).toBe(history);
  });
});
