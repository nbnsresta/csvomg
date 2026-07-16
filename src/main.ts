import './style.css';
import {
  createDataModel,
  deleteColumn,
  deleteRow,
  duplicateRow,
  hasContent,
  insertColumn,
  insertRow,
  renameColumn,
  reorderColumn,
  setCell,
} from './core/data.ts';
import { parseCSV, parseJSON, serializeCSV, serializeJSON } from './core/parser.ts';
import { deleteDraft, loadDraft, saveDraft } from './io/drafts.ts';
import { clearSession, loadSession, saveSession, type SessionState } from './io/session.ts';
import { openDroppedFile, webFileSystemAdapter } from './io/web-fs.ts';
import type { FileHandle, OpenedFile } from './io/types.ts';
import { showContextMenu, type ContextMenuItem } from './ui/context-menu.ts';
import { Grid, type ContextMenuTarget } from './ui/grid.ts';
import type { DataModel, FileType, Selection } from './types/index.ts';

const emptyState = document.getElementById('empty-state') as HTMLDivElement;
const gridContainer = document.getElementById('grid-container') as HTMLDivElement;
const btnOpenFile = document.getElementById('btn-open-file') as HTMLButtonElement;
const btnNewFile = document.getElementById('btn-new-file') as HTMLButtonElement;
const dropZone = document.querySelector('.drop-zone') as HTMLDivElement;
const statusSelection = document.getElementById('status-selection') as HTMLDivElement;
const statusCounts = document.getElementById('status-counts') as HTMLDivElement;
const btnToolbarNew = document.getElementById('btn-toolbar-new') as HTMLButtonElement;
const btnToolbarOpen = document.getElementById('btn-toolbar-open') as HTMLButtonElement;
const btnToolbarSave = document.getElementById('btn-toolbar-save') as HTMLButtonElement;
const tabBar = document.getElementById('tab-bar') as HTMLElement;

// The only place a venue-specific FileSystemAdapter is chosen. Swapping venues (extension,
// future VS Code host) means swapping this one line — nothing below here should import
// web-fs.ts or DOM file-picker types directly.
const fs = webFileSystemAdapter;

interface DocTab {
  id: string;
  data: DataModel;
  handle: FileHandle | null;
  fileType: FileType;
  dirty: boolean;
}

const MAX_TABS = 10;
let tabs: DocTab[] = [];
let activeTabId: string | null = null;

function getActiveTab(): DocTab | null {
  return tabs.find((t) => t.id === activeTabId) ?? null;
}

function canOpenNewTab(): boolean {
  if (tabs.length >= MAX_TABS) {
    alert(`You have ${MAX_TABS} documents open — close one before opening another.`);
    return false;
  }
  return true;
}

let untitledCounter = 1;
function nextUntitledName(): string {
  return `Untitled_${untitledCounter++}.csv`;
}

/** Seeds the counter past any restored Untitled_N.csv tabs so a new one never collides. */
function seedUntitledCounter(): void {
  const nums = tabs
    .map((t) => /^Untitled_(\d+)\.csv$/.exec(t.data.meta.filename)?.[1])
    .filter((n): n is string => n !== undefined)
    .map(Number);
  untitledCounter = nums.length > 0 ? Math.max(...nums) + 1 : 1;
}

function persistSession(): void {
  if (tabs.length === 0) {
    void clearSession().catch((err) => console.error('session clear failed', err));
    return;
  }
  const state: SessionState = {
    tabs: tabs.map((t) => ({
      id: t.id,
      kind: t.handle ? 'file' : 'draft',
      handle: t.handle,
      filename: t.data.meta.filename,
      fileType: t.fileType,
    })),
    activeTabId,
  };
  void saveSession(state).catch((err) => console.error('session save failed', err));
}

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

function serializeTab(tab: DocTab): string {
  return tab.fileType === 'json'
    ? serializeJSON(tab.data.headers, tab.data.rows)
    : serializeCSV(tab.data.headers, tab.data.rows, tab.data.meta.delimiter);
}

function showGrid(): void {
  emptyState.classList.add('hidden');
  gridContainer.classList.remove('hidden');
  grid.refresh();
  grid.focus();
}

function showEmptyState(): void {
  gridContainer.classList.add('hidden');
  emptyState.classList.remove('hidden');
}

function activateTab(id: string): void {
  activeTabId = id;
  const tab = getActiveTab();
  if (!tab) return;
  grid.setData(tab.data);
  showGrid();
  updateStatus();
}

function closeTab(id: string): void {
  const tab = tabs.find((t) => t.id === id);
  if (!tab) return;
  if (tab.dirty && hasContent(tab.data) && !confirm(`Discard unsaved changes to "${tab.data.meta.filename}"?`)) {
    return;
  }

  const index = tabs.indexOf(tab);
  tabs = tabs.filter((t) => t.id !== id);
  void deleteDraft(id).catch((err) => console.error('draft cleanup failed', err));

  if (activeTabId !== id) {
    updateStatus();
    return;
  }
  const next = tabs[index] ?? tabs[index - 1];
  if (next) {
    activateTab(next.id);
  } else {
    activeTabId = null;
    showEmptyState();
    updateStatus();
  }
}

function renderTabs(): void {
  tabBar.replaceChildren(
    ...tabs.map((tab) => {
      const el = document.createElement('div');
      el.className = tab.id === activeTabId ? 'tab tab-active' : 'tab';
      el.addEventListener('click', () => activateTab(tab.id));

      const nameSpan = document.createElement('span');
      nameSpan.className = 'tab-name';
      nameSpan.textContent = tab.data.meta.filename;
      el.appendChild(nameSpan);

      if (tab.dirty) {
        const dot = document.createElement('span');
        dot.className = 'tab-dirty-dot';
        dot.title = 'Unsaved changes';
        el.appendChild(dot);
      }

      const closeBtn = document.createElement('button');
      closeBtn.className = 'tab-close';
      closeBtn.textContent = '×';
      closeBtn.setAttribute('aria-label', `Close ${tab.data.meta.filename}`);
      closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        closeTab(tab.id);
      });
      el.appendChild(closeBtn);

      return el;
    }),
  );
}

function loadFile(opened: OpenedFile): void {
  if (!canOpenNewTab()) return;
  let parsed: { data: DataModel; type: FileType };
  try {
    parsed = parseOpenedFile(opened);
  } catch (err) {
    alert(`Failed to open "${opened.name}": ${err instanceof Error ? err.message : String(err)}`);
    return;
  }
  const tab: DocTab = {
    id: crypto.randomUUID(),
    data: parsed.data,
    handle: opened.handle,
    fileType: parsed.type,
    dirty: false,
  };
  tabs.push(tab);
  activateTab(tab.id);
}

function newFile(): void {
  if (!canOpenNewTab()) return;
  const tab: DocTab = {
    id: crypto.randomUUID(),
    data: createDataModel(['A', 'B', 'C'], [['', '', '']], nextUntitledName(), ','),
    handle: null,
    fileType: 'csv',
    dirty: true,
  };
  tabs.push(tab);
  activateTab(tab.id);
  void saveDraft(tab.id, tab.data, tab.fileType).catch((err) => console.error('draft autosave failed', err));
}

/** Commits a new DataModel from any mutation (cell edit, row/column action, paste, clear, ...). */
function commitMutation(data: DataModel): void {
  const tab = getActiveTab();
  if (!tab) return;
  tab.data = data;
  tab.dirty = true;
  grid.setData(tab.data);
  updateStatus();
  if (!tab.handle) {
    void saveDraft(tab.id, tab.data, tab.fileType).catch((err) => console.error('draft autosave failed', err));
  }
}

function handleCellEdit(row: number, col: number, value: string): void {
  const tab = getActiveTab();
  if (!tab) return;
  if ((tab.data.rows[row]?.[col] ?? '') === value) return;
  commitMutation(setCell(tab.data, row, col, value).data);
}

function clearSelectedCells(): void {
  const tab = getActiveTab();
  if (!tab) return;
  const sel = grid.getSelection();
  if (!sel) return;
  const minRow = Math.min(sel.startRow, sel.endRow);
  const maxRow = Math.max(sel.startRow, sel.endRow);
  const minCol = Math.min(sel.startCol, sel.endCol);
  const maxCol = Math.max(sel.startCol, sel.endCol);
  let data = tab.data;
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
  const tab = getActiveTab();
  if (!tab) return;
  const data = tab.data;

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
  const tab = getActiveTab();
  if (!tab) return;
  const text = serializeTab(tab);
  if (tab.handle) {
    try {
      await fs.saveToHandle(tab.handle, text);
      tab.dirty = false;
      updateStatus();
      return;
    } catch {
      // Permission may have been revoked; fall through to Save As.
    }
  }
  await saveAs();
}

async function saveAs(): Promise<void> {
  const tab = getActiveTab();
  if (!tab) return;
  const text = serializeTab(tab);
  const result = await fs.saveFileAs(text, tab.data.meta.filename);
  if (result) {
    tab.handle = result.handle;
    tab.data = { ...tab.data, meta: { ...tab.data.meta, filename: result.name } };
    tab.dirty = false;
    void deleteDraft(tab.id).catch((err) => console.error('draft cleanup failed', err));
    updateStatus();
  } else if (!fs.supportsDirectSave) {
    // Fallback path triggers a download immediately; treat as saved.
    tab.dirty = false;
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
  const tab = getActiveTab();
  btnToolbarSave.disabled = !tab;

  if (!tab) {
    statusCounts.textContent = '';
    document.title = 'csvomg';
    renderTabs();
    persistSession();
    return;
  }
  const rows = tab.data.rows.length;
  const cols = tab.data.headers.length;
  statusCounts.textContent = `${rows} row${rows === 1 ? '' : 's'} · ${cols} col${cols === 1 ? '' : 's'}`;
  document.title = `${tab.dirty ? '● ' : ''}${tab.data.meta.filename} — csvomg`;
  renderTabs();
  persistSession();
}

btnOpenFile.addEventListener('click', () => void openFileDialog());
btnNewFile.addEventListener('click', newFile);
btnToolbarOpen.addEventListener('click', () => void openFileDialog());
btnToolbarNew.addEventListener('click', newFile);
btnToolbarSave.addEventListener('click', () => void save());

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
  if (!e.dataTransfer) return;
  void openDroppedFile(e.dataTransfer).then((opened) => {
    if (opened) loadFile(opened);
  });
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

async function restoreSession(): Promise<void> {
  const session = await loadSession().catch(() => null);
  if (!session || session.tabs.length === 0) return;

  for (const ref of session.tabs) {
    if (ref.kind === 'draft') {
      const draft = await loadDraft(ref.id).catch(() => null);
      if (!draft) continue;
      const data = createDataModel(draft.headers, draft.rows, draft.filename, draft.delimiter);
      if (!hasContent(data)) continue;
      tabs.push({ id: ref.id, data, handle: null, fileType: draft.fileType, dirty: true });
      continue;
    }

    // kind === 'file': re-read live from disk. queryPermission doesn't need a user gesture
    // (unlike requestPermission), so this can safely run unattended at boot. A denied/unknown
    // permission, or a moved/deleted file, just drops that tab from the restored set.
    try {
      const handle = ref.handle as FileSystemFileHandle;
      const permission = await handle.queryPermission({ mode: 'read' });
      if (permission !== 'granted') continue;
      const file = await handle.getFile();
      const opened: OpenedFile = { name: file.name, text: await file.text(), handle };
      const parsed = parseOpenedFile(opened);
      tabs.push({ id: ref.id, data: parsed.data, handle, fileType: parsed.type, dirty: false });
    } catch {
      continue;
    }
  }

  if (tabs.length === 0) return;
  seedUntitledCounter();
  const restoredActive = tabs.find((t) => t.id === session.activeTabId) ?? tabs[0];
  activateTab(restoredActive.id);
}

void restoreSession();
