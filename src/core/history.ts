import { applyDiff, undoDiff } from './data.ts';
import type { DataModel, Diff } from '../types/index.ts';

/**
 * Per-tab undo/redo built on top of data.ts's existing applyDiff/invertDiff/undoDiff — this
 * module is just the stack management, no new mutation logic.
 *
 * Each undo step is a DiffGroup (one or more Diffs) rather than a single Diff, so a multi-cell
 * operation that produces several individual CellDiffs (e.g. clearing a range) can still undo
 * as one action instead of cell-by-cell. Diffs within a group are undone in reverse order and
 * redone in forward order, standard LIFO transaction semantics.
 */

const MAX_HISTORY = 200;

export type DiffGroup = Diff[];

export interface History {
  undoStack: DiffGroup[];
  redoStack: DiffGroup[];
}

export function createHistory(): History {
  return { undoStack: [], redoStack: [] };
}

/** Records a completed mutation. Any pending redo stack is cleared, same as every editor does. */
export function pushGroup(history: History, group: DiffGroup): History {
  if (group.length === 0) return history;
  return {
    undoStack: [...history.undoStack, group].slice(-MAX_HISTORY),
    redoStack: [],
  };
}

export function undo(history: History, data: DataModel): { data: DataModel; history: History } | null {
  if (history.undoStack.length === 0) return null;
  const group = history.undoStack[history.undoStack.length - 1];
  let newData = data;
  for (let i = group.length - 1; i >= 0; i--) {
    newData = undoDiff(newData, group[i]);
  }
  return {
    data: newData,
    history: {
      undoStack: history.undoStack.slice(0, -1),
      redoStack: [...history.redoStack, group],
    },
  };
}

export function redo(history: History, data: DataModel): { data: DataModel; history: History } | null {
  if (history.redoStack.length === 0) return null;
  const group = history.redoStack[history.redoStack.length - 1];
  let newData = data;
  for (const diff of group) {
    newData = applyDiff(newData, diff);
  }
  return {
    data: newData,
    history: {
      undoStack: [...history.undoStack, group],
      redoStack: history.redoStack.slice(0, -1),
    },
  };
}
