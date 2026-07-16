import './style.css';
import {
  createDataModel,
  deleteColumn,
  deleteRow,
  duplicateRow,
  insertColumn,
  insertRow,
  renameColumn,
  reorderColumn,
  setCell,
} from './core/data.ts';
import { parseCSV, parseJSON, serializeCSV, serializeJSON } from './core/parser.ts';
import { webFileSystemAdapter } from './io/web-fs.ts';
import type { FileHandle, OpenedFile } from './io/types.ts';
import { showContextMenu, type ContextMenuItem } from './ui/context-menu.ts';
import { Grid, type ContextMenuTarget } from './ui/grid.ts';
import type { DataModel, Selection } from './types/index.ts';

type FileType = 'csv' | 'json';

const emptyState = document.getElementById('empty-state') as HTMLDivElement;
const gridContainer = document.getElementById('grid-container') as HTMLDivElement;
const btnOpenFile = document.getElementById('btn-open-file') as HTMLButtonElement;
const btnNewFile = document.getElementById('btn-new-file') as HTMLButtonElement;
const dropZone = document.querySelector('.drop-zone') as HTMLDivElement;
const statusSelection = document.getElementById('status-selection') as HTMLDivElement;
const statusCounts = document.getElementById('status-counts') as HTMLDivElement;

// The only place a venue-specific FileSystemAdapter is chosen. Swapping venues (extension,
// future VS Code host) means swapping this one line — nothing below here should import
// web-fs.ts or DOM file-picker types directly.
const fs = webFileSystemAdapter;

let currentData: DataModel | null = null;
let currentHandle: FileHandle | null = null;
let currentFileType: FileType = 'csv';
let dirty = false;

const grid = new Grid(gridContainer, {
  onCellEdit: handleCellEdit,
  onSelectionChange: updateSelectionStatus,
  onContextMenu: handleContextMenu,
});

function detectFileType(filename: string): FileType {
  return filename.toLowerCase().endsWith('.json') ? 'json' : 'csv';
}

function parseOpenedFile(opened: OpenedFile): { data: DataModel; type: FileType } {
  const type = detectFileType(opened.name);
  if (type === 'json') {
    const { headers, rows } = parseJSON(opened.text);
    return { data: createDataModel(headers, rows, opened.name, ','), type };
  }
  const { headers, rows, delimiter } = parseCSV(opened.text);
  return { data: createDataModel(headers, rows, opened.name, delimiter), type };
}

function serializeCurrent(): string {
  if (!currentData) return '';
  return currentFileType === 'json'
    ? serializeJSON(currentData.headers, currentData.rows)
    : serializeCSV(currentData.headers, currentData.rows, currentData.meta.delimiter);
}

function showGrid(): void {
  emptyState.classList.add('hidden');
  gridContainer.classList.remove('hidden');
  grid.refresh();
  grid.focus();
}

function loadFile(opened: OpenedFile): void {
  let parsed: { data: DataModel; type: FileType };
  try {
    parsed = parseOpenedFile(opened);
  } catch (err) {
    alert(`Failed to open "${opened.name}": ${err instanceof Error ? err.message : String(err)}`);
    return;
  }
  currentData = parsed.data;
  currentFileType = parsed.type;
  currentHandle = opened.handle;
  dirty = false;
  grid.setData(currentData);
  showGrid();
  updateStatus();
}

function newFile(): void {
  if (dirty && !confirm('Discard unsaved changes?')) return;
  currentData = createDataModel(['A', 'B', 'C'], [['', '', '']], 'Untitled.csv', ',');
  currentFileType = 'csv';
  currentHandle = null;
  dirty = false;
  grid.setData(currentData);
  showGrid();
  updateStatus();
}

/** Commits a new DataModel from any mutation (cell edit, row/column action, paste, clear, ...). */
function commitMutation(data: DataModel): void {
  currentData = data;
  dirty = true;
  grid.setData(currentData);
  updateStatus();
}

function handleCellEdit(row: number, col: number, value: string): void {
  if (!currentData) return;
  if ((currentData.rows[row]?.[col] ?? '') === value) return;
  commitMutation(setCell(currentData, row, col, value).data);
}

function clearSelectedCells(): void {
  if (!currentData) return;
  const sel = grid.getSelection();
  if (!sel) return;
  const minRow = Math.min(sel.startRow, sel.endRow);
  const maxRow = Math.max(sel.startRow, sel.endRow);
  const minCol = Math.min(sel.startCol, sel.endCol);
  const maxCol = Math.max(sel.startCol, sel.endCol);
  let data = currentData;
  for (let r = minRow; r <= maxRow; r++) {
    for (let c = minCol; c <= maxCol; c++) {
      data = setCell(data, r, c, '').data;
    }
  }
  commitMutation(data);
}

/**
 * Refocuses the grid before running an item's action. Without this, focus is left on the (now
 * removed) menu button after any click, which breaks keyboard nav afterward and — for Cut/Copy
 * specifically — breaks execCommand('cut'/'copy') outright, since handleCut/handleCopy in
 * grid.ts only act when the grid itself (not the menu) is the focused element.
 */
function withFocus(items: ContextMenuItem[]): ContextMenuItem[] {
  return items.map((item) => ({
    ...item,
    onSelect: () => {
      grid.focus();
      item.onSelect();
    },
  }));
}

function handleContextMenu(target: ContextMenuTarget): void {
  if (!currentData) return;
  const data = currentData;

  if (target.zone === 'row') {
    const items: ContextMenuItem[] = [
      { label: 'Insert row above', onSelect: () => commitMutation(insertRow(data, target.row).data) },
      { label: 'Insert row below', onSelect: () => commitMutation(insertRow(data, target.row + 1).data) },
      { label: 'Duplicate row', onSelect: () => commitMutation(duplicateRow(data, target.row).data) },
      {
        label: 'Delete row',
        danger: true,
        onSelect: () => {
          if (!confirm(`Delete row ${target.row + 1}? This can't be undone yet.`)) return;
          commitMutation(deleteRow(data, target.row).data);
        },
      },
    ];
    showContextMenu(target.x, target.y, withFocus(items));
    return;
  }

  if (target.zone === 'col') {
    const lastCol = data.headers.length - 1;
    const headerName = data.headers[target.col] || `Column ${target.col + 1}`;
    const items: ContextMenuItem[] = [
      { label: 'Insert column left', onSelect: () => commitMutation(insertColumn(data, target.col).data) },
      { label: 'Insert column right', onSelect: () => commitMutation(insertColumn(data, target.col + 1).data) },
      {
        label: 'Rename column',
        onSelect: () => {
          const name = prompt('Column name', data.headers[target.col]);
          if (name === null) return;
          commitMutation(renameColumn(data, target.col, name).data);
        },
      },
      {
        label: 'Move left',
        disabled: target.col === 0,
        onSelect: () => commitMutation(reorderColumn(data, target.col, target.col - 1).data),
      },
      {
        label: 'Move right',
        disabled: target.col === lastCol,
        onSelect: () => commitMutation(reorderColumn(data, target.col, target.col + 1).data),
      },
      {
        label: 'Delete column',
        danger: true,
        onSelect: () => {
          if (!confirm(`Delete column "${headerName}"? This can't be undone yet.`)) return;
          commitMutation(deleteColumn(data, target.col).data);
        },
      },
    ];
    showContextMenu(target.x, target.y, withFocus(items));
    return;
  }

  const items: ContextMenuItem[] = [
    { label: 'Cut', onSelect: () => document.execCommand('cut') },
    { label: 'Copy', onSelect: () => document.execCommand('copy') },
    { label: 'Paste', onSelect: () => void navigator.clipboard.readText().then((text) => grid.pasteText(text)) },
    { label: 'Clear', onSelect: clearSelectedCells },
  ];
  showContextMenu(target.x, target.y, withFocus(items));
}

async function openFileDialog(): Promise<void> {
  const opened = await fs.openFiles(false);
  if (opened.length === 0) return;
  loadFile(opened[0]);
}

async function save(): Promise<void> {
  if (!currentData) return;
  const text = serializeCurrent();
  if (currentHandle) {
    try {
      await fs.saveToHandle(currentHandle, text);
      dirty = false;
      updateStatus();
      return;
    } catch {
      // Permission may have been revoked; fall through to Save As.
    }
  }
  await saveAs();
}

async function saveAs(): Promise<void> {
  if (!currentData) return;
  const text = serializeCurrent();
  const handle = await fs.saveFileAs(text, currentData.meta.filename);
  if (handle) {
    currentHandle = handle;
    dirty = false;
    updateStatus();
  } else if (!fs.supportsDirectSave) {
    // Fallback path triggers a download immediately; treat as saved.
    dirty = false;
    updateStatus();
  }
}

function formatSelection(sel: Selection | null): string {
  if (!sel) return 'Ready';
  const { startRow, startCol, endRow, endCol } = sel;
  if (startRow === endRow && startCol === endCol) {
    return `R${startRow + 1}, C${startCol + 1}`;
  }
  const rows = Math.abs(endRow - startRow) + 1;
  const cols = Math.abs(endCol - startCol) + 1;
  return `${rows} × ${cols} selected`;
}

function updateSelectionStatus(sel: Selection | null): void {
  statusSelection.textContent = formatSelection(sel);
}

function updateStatus(): void {
  if (!currentData) {
    statusCounts.textContent = '';
    document.title = 'csvomg';
    return;
  }
  const rows = currentData.rows.length;
  const cols = currentData.headers.length;
  statusCounts.textContent = `${rows} row${rows === 1 ? '' : 's'} · ${cols} col${cols === 1 ? '' : 's'}`;
  document.title = `${dirty ? '● ' : ''}${currentData.meta.filename} — csvomg`;
}

btnOpenFile.addEventListener('click', () => void openFileDialog());
btnNewFile.addEventListener('click', newFile);

dropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropZone.classList.add('drag-active');
});
dropZone.addEventListener('dragleave', () => {
  dropZone.classList.remove('drag-active');
});
dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('drag-active');
  const file = e.dataTransfer?.files?.[0];
  if (!file) return;
  void file.text().then((text) => loadFile({ name: file.name, text, handle: null }));
});

window.addEventListener('keydown', (e) => {
  const ctrlOrCmd = e.ctrlKey || e.metaKey;
  if (!ctrlOrCmd) return;
  const key = e.key.toLowerCase();
  if (key === 's' && e.shiftKey) {
    e.preventDefault();
    void saveAs();
  } else if (key === 's') {
    e.preventDefault();
    void save();
  } else if (key === 'o') {
    e.preventDefault();
    void openFileDialog();
  } else if (key === 'n') {
    e.preventDefault();
    newFile();
  }
});

window.addEventListener('beforeunload', (e) => {
  if (!dirty) return;
  e.preventDefault();
  e.returnValue = '';
});
