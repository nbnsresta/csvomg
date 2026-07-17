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
import { createHistory, pushGroup, redo, undo, type History } from './core/history.ts';
import { parseCSV, parseJSON, serializeCSV, serializeJSON } from './core/parser.ts';
import { deleteDraft, loadDraft, saveDraft } from './io/drafts.ts';
import {
  listRecentFiles,
  recordRecentDraft,
  recordRecentFile,
  removeRecentFile,
  type RecentFileEntry,
} from './io/recent-files.ts';
import { clearSession, loadSession, saveSession, type SessionState } from './io/session.ts';
import { openDroppedFile, webFileSystemAdapter } from './io/web-fs.ts';
import type { FileHandle, OpenedFile } from './io/types.ts';
import { showContextMenu, type ContextMenuItem } from './ui/context-menu.ts';
import { createFindBar } from './ui/find-bar.ts';
import { Grid, type CellEdit, type ContextMenuTarget } from './ui/grid.ts';
import { showReconnectDialog } from './ui/reconnect-dialog.ts';
import type { DataModel, Diff, FileType, Mutation, Selection } from './types/index.ts';

const emptyState = document.getElementById('empty-state') as HTMLDivElement;
const gridContainer = document.getElementById('grid-container') as HTMLDivElement;
const btnOpenFile = document.getElementById('btn-open-file') as HTMLButtonElement;
const btnNewFile = document.getElementById('btn-new-file') as HTMLButtonElement;
const pageDropOverlay = document.getElementById('page-drop-overlay') as HTMLDivElement;
const statusSelection = document.getElementById('status-selection') as HTMLDivElement;
const statusCounts = document.getElementById('status-counts') as HTMLDivElement;
const btnToolbarNew = document.getElementById('btn-toolbar-new') as HTMLButtonElement;
const btnToolbarOpen = document.getElementById('btn-toolbar-open') as HTMLButtonElement;
const btnToolbarSave = document.getElementById('btn-toolbar-save') as HTMLButtonElement;
const tabBar = document.getElementById('tab-bar') as HTMLElement;
const recentFilesContainer = document.getElementById('recent-files-container') as HTMLDivElement;
const recentFilesList = document.getElementById('recent-files-list') as HTMLUListElement;

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
  history: History;
  // --- reconnect-tab feature (retry #2, 2026-07-17): easy to fully revert, see STATUS.md ---
  /** True when restored from session with an unconfirmed handle permission — no content loaded yet, shown as a dimmed tab that reconnects on click. */
  needsReconnect?: boolean;
  // --- end reconnect-tab feature field ---
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
    // reconnect-tab feature: file-backed tabs are persisted too (was draft-only) so
    // restoreSession() can attempt them again — see STATUS.md.
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
  onBulkEdit: handleBulkEdit,
  onSelectionChange: updateSelectionStatus,
  onContextMenu: handleContextMenu,
  onUndo: performUndo,
  onRedo: performRedo,
});

interface FindMatch {
  row: number;
  col: number;
}

let findMatches: FindMatch[] = [];
let findIndex = -1;
let findQuery = '';

const findBar = createFindBar({
  onSearch: runFind,
  onNext: findNext,
  onPrev: findPrev,
  onClose: closeFind,
});

/** Searches the active tab's data cells (not headers) case-insensitively. */
function runFind(query: string): void {
  findQuery = query;
  findMatches = [];
  findIndex = -1;
  const tab = getActiveTab();
  if (!tab || !query) {
    findBar.setMatchStatus(0, 0);
    return;
  }
  const needle = query.toLowerCase();
  for (let r = 0; r < tab.data.rows.length; r++) {
    for (let c = 0; c < tab.data.headers.length; c++) {
      if ((tab.data.rows[r][c] ?? '').toLowerCase().includes(needle)) {
        findMatches.push({ row: r, col: c });
      }
    }
  }
  if (findMatches.length > 0) {
    findIndex = 0;
    jumpToFindMatch();
  } else {
    findBar.setMatchStatus(0, 0);
  }
}

function jumpToFindMatch(): void {
  const match = findMatches[findIndex];
  if (!match) return;
  grid.selectCell(match.row, match.col);
  findBar.setMatchStatus(findIndex + 1, findMatches.length);
}

function findNext(): void {
  if (findMatches.length === 0) return;
  findIndex = (findIndex + 1) % findMatches.length;
  jumpToFindMatch();
}

function findPrev(): void {
  if (findMatches.length === 0) return;
  findIndex = (findIndex - 1 + findMatches.length) % findMatches.length;
  jumpToFindMatch();
}

function openFind(): void {
  if (!getActiveTab()) return;
  findBar.show();
  findBar.focusInput();
  if (findQuery) runFind(findQuery);
}

function closeFind(): void {
  findBar.hide();
  findMatches = [];
  findIndex = -1;
  grid.focus();
}

const SUPPORTED_EXTENSIONS = ['.csv', '.tsv', '.json'];

function isSupportedFile(filename: string): boolean {
  const lower = filename.toLowerCase();
  return SUPPORTED_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

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

/**
 * Requests read permission — must be called from a real user gesture, browsers won't prompt
 * otherwise — and re-reads the handle's current content from disk. Throws on denial or a
 * moved/deleted file; callers alert() and decide their own cleanup.
 */
async function reconnectFileHandle(handle: FileSystemFileHandle): Promise<{ data: DataModel; type: FileType }> {
  const permission = await handle.requestPermission({ mode: 'read' });
  if (permission !== 'granted') throw new Error('Permission denied');
  const file = await handle.getFile();
  const opened: OpenedFile = { name: file.name, text: await file.text(), handle };
  return parseOpenedFile(opened);
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
  void refreshRecentFilesUI();
}

/** Hand-rolled, zero-dependency relative-time label for Recent Files rows. */
function formatRelativeTime(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString();
}

async function refreshRecentFilesUI(): Promise<void> {
  const entries = await listRecentFiles().catch(() => []);
  recentFilesContainer.classList.toggle('hidden', entries.length === 0);
  recentFilesList.replaceChildren(
    ...entries.map((entry) => {
      const li = document.createElement('li');
      li.className = 'recent-file-item';

      const open = document.createElement('button');
      open.className = 'recent-file-open';
      open.addEventListener('click', () => void reopenRecentFile(entry));

      const name = document.createElement('span');
      name.className = 'recent-file-name';
      name.textContent = entry.filename;
      open.appendChild(name);

      const meta = document.createElement('span');
      meta.className = 'recent-file-meta';
      meta.textContent = formatRelativeTime(entry.updatedAt);
      open.appendChild(meta);

      li.appendChild(open);

      const removeBtn = document.createElement('button');
      removeBtn.className = 'tab-close';
      removeBtn.textContent = '×';
      removeBtn.setAttribute('aria-label', `Remove ${entry.filename} from Recent Files`);
      removeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        void dismissRecentFile(entry);
      });
      li.appendChild(removeBtn);

      return li;
    }),
  );
}

async function dismissRecentFile(entry: RecentFileEntry): Promise<void> {
  if (entry.kind === 'draft') {
    await deleteDraft(entry.id).catch((err) => console.error('draft cleanup failed', err));
  }
  await removeRecentFile(entry.id).catch((err) => console.error('recent-file remove failed', err));
  void refreshRecentFilesUI();
}

async function reopenRecentFile(entry: RecentFileEntry): Promise<void> {
  if (!canOpenNewTab()) return;

  if (entry.kind === 'draft') {
    const draft = await loadDraft(entry.id).catch(() => null);
    if (!draft) {
      alert(`"${entry.filename}" is no longer available.`);
      await removeRecentFile(entry.id).catch(() => {});
      await refreshRecentFilesUI();
      return;
    }
    const data = createDataModel(draft.headers, draft.rows, draft.filename, draft.delimiter);
    tabs.push({ id: entry.id, data, handle: null, fileType: draft.fileType, dirty: true, history: createHistory() });
    activateTab(entry.id);
    return;
  }

  // --- reconnect-tab feature: routed through the same blocking dialog as reconnectTab(), see STATUS.md ---
  if (reconnectingTabId !== null) return;
  const handle = entry.handle as FileSystemFileHandle;
  showReconnectDialog({
    filename: entry.filename,
    onAttempt: async () => {
      reconnectingTabId = entry.id; // no real tab yet to associate — just claims the global slot
      try {
        const parsed = await reconnectFileHandle(handle);
        const tab: DocTab = {
          id: crypto.randomUUID(),
          data: parsed.data,
          handle,
          fileType: parsed.type,
          dirty: false,
          history: createHistory(),
        };
        tabs.push(tab);
        activateTab(tab.id);
      } finally {
        reconnectingTabId = null;
      }
    },
  });
  // A failed attempt no longer auto-evicts the Recent Files entry — the dialog's own "Try Again"
  // lets the user retry without losing it, since a failure here can be purely transient.
  // --- end reopenRecentFile() file-kind branch ---
}

function activateTab(id: string): void {
  activeTabId = id;
  const tab = getActiveTab();
  if (!tab) return;
  grid.setData(tab.data);
  showGrid();
  updateStatus();
  if (findBar.isOpen()) runFind(findQuery);
}

// --- reconnect-tab feature (retry #2, 2026-07-17/18) — see STATUS.md for revert instructions ---
// A second attempt while one's already in flight isn't just wasted — clicking anywhere on the
// page while the browser's native permission prompt is up can register as an outside-click on
// that prompt, dismissing it as an implicit denial. showReconnectDialog()'s full-page overlay
// already makes a second click structurally impossible while it's showing; this is a cheap
// defensive backstop, and lets renderTabs() know which tab (if any) to show as spinning.
let reconnectingTabId: string | null = null;

function reconnectTab(id: string): void {
  const tab = tabs.find((t) => t.id === id);
  if (!tab || !tab.needsReconnect || !tab.handle || reconnectingTabId !== null) return;
  const handle = tab.handle as FileSystemFileHandle;
  showReconnectDialog({
    filename: tab.data.meta.filename,
    onAttempt: async () => {
      reconnectingTabId = id;
      renderTabs();
      try {
        const parsed = await reconnectFileHandle(handle);
        tab.data = parsed.data;
        tab.fileType = parsed.type;
        tab.needsReconnect = false;
        activateTab(id);
      } finally {
        reconnectingTabId = null;
        // Redundant with activateTab()'s own render on success, but required on failure — the
        // dialog handles its own error UI, nothing else would clear this tab's spinning icon.
        renderTabs();
      }
    },
  });
}
// --- end reconnectTab() ---

function closeTab(id: string): void {
  const tab = tabs.find((t) => t.id === id);
  if (!tab) return;
  // Tracks whether the confirm below actually fired (and was accepted) — a freshly opened,
  // never-edited handle-less tab (e.g. a fallback-mode dropped/opened file, dirty: false) can
  // have real content too, but wasn't dirty, so it never hit the dialog at all.
  const confirmedDiscard = tab.dirty && hasContent(tab.data);
  if (confirmedDiscard && !confirm(`Discard unsaved changes to "${tab.data.meta.filename}"?`)) {
    return;
  }

  const index = tabs.indexOf(tab);
  tabs = tabs.filter((t) => t.id !== id);

  // showEmptyState()/updateStatus() below trigger an immediate (possibly stale-by-one, if this
  // record/remove hasn't landed yet) recent-files refresh; chaining a second refresh once this
  // settles keeps the list eventually consistent — e.g. reflecting cap eviction — without making
  // tab-close itself wait on an IndexedDB round trip.
  if (tab.handle) {
    void recordRecentFile(tab.handle, tab.data.meta.filename, tab.fileType)
      .then(() => refreshRecentFilesUI())
      .catch((err) => console.error('recent-file record failed', err));
  } else if (confirmedDiscard) {
    // The user just explicitly confirmed "Discard unsaved changes?" — discard means discard.
    void deleteDraft(id).catch((err) => console.error('draft cleanup failed', err));
    void removeRecentFile(id)
      .then(() => refreshRecentFilesUI())
      .catch(() => {});
  } else if (hasContent(tab.data)) {
    // Handle-less but never flagged dirty — a freshly opened fallback-mode file (real content,
    // just never got a live handle) rather than an Untitled draft. Nothing was discarded, so
    // it's still worth keeping recoverable.
    void recordRecentDraft(tab.id, tab.data.meta.filename, tab.fileType)
      .then(() => refreshRecentFilesUI())
      .catch((err) => console.error('recent-file record failed', err));
  } else {
    void deleteDraft(id).catch((err) => console.error('draft cleanup failed', err));
    void removeRecentFile(id)
      .then(() => refreshRecentFilesUI())
      .catch(() => {});
  }

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
      // --- reconnect-tab feature: dimmed tab + click-to-reconnect routing, see STATUS.md ---
      const isReconnecting = reconnectingTabId === tab.id;
      if (tab.needsReconnect) el.classList.add('tab-needs-reconnect');
      if (isReconnecting) el.classList.add('tab-reconnecting');
      el.addEventListener('click', () => {
        if (tab.needsReconnect) reconnectTab(tab.id);
        else activateTab(tab.id);
      });
      // --- end reconnect-tab click routing ---

      const nameSpan = document.createElement('span');
      nameSpan.className = 'tab-name';
      nameSpan.textContent = tab.data.meta.filename;
      el.appendChild(nameSpan);

      // --- reconnect-tab feature: reconnect glyph instead of the dirty-dot, see STATUS.md ---
      if (tab.needsReconnect) {
        const icon = document.createElement('span');
        icon.className = isReconnecting ? 'tab-reconnect-icon tab-reconnect-icon-spinning' : 'tab-reconnect-icon';
        icon.title = isReconnecting ? 'Reconnecting…' : 'Needs reconnect — click to restore';
        icon.textContent = '⟳';
        el.appendChild(icon);
      } else if (tab.dirty) {
        // --- end reconnect-tab icon branch ---
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
  if (!isSupportedFile(opened.name)) {
    alert(`"${opened.name}" isn't a supported file type. csvomg opens .csv, .tsv, and .json files.`);
    return;
  }
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
    history: createHistory(),
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
    history: createHistory(),
  };
  tabs.push(tab);
  activateTab(tab.id);
  void saveDraft(tab.id, tab.data, tab.fileType).catch((err) => console.error('draft autosave failed', err));
}

/** Applies a resolved DataModel to the active tab: dirty flag, grid render, status, draft autosave. */
function applyTabUpdate(tab: DocTab, data: DataModel): void {
  tab.data = data;
  tab.dirty = true;
  grid.setData(tab.data);
  updateStatus();
  if (!tab.handle) {
    void saveDraft(tab.id, tab.data, tab.fileType).catch((err) => console.error('draft autosave failed', err));
  }
}

/**
 * Commits a new DataModel from any mutation (cell edit, row/column action, clear, ...) and
 * records it as one undo step. A single mutation passes one Diff; an operation that touches
 * several cells at once (e.g. clearing a range) passes all of them as an array so the whole
 * thing undoes in one step rather than cell-by-cell.
 */
function commitMutation(data: DataModel, diff: Diff | Diff[]): void {
  const tab = getActiveTab();
  if (!tab) return;
  tab.history = pushGroup(tab.history, Array.isArray(diff) ? diff : [diff]);
  applyTabUpdate(tab, data);
}

function performUndo(): void {
  const tab = getActiveTab();
  if (!tab) return;
  const result = undo(tab.history, tab.data);
  if (!result) return;
  tab.history = result.history;
  applyTabUpdate(tab, result.data);
}

function performRedo(): void {
  const tab = getActiveTab();
  if (!tab) return;
  const result = redo(tab.history, tab.data);
  if (!result) return;
  tab.history = result.history;
  applyTabUpdate(tab, result.data);
}

function handleCellEdit(row: number, col: number, value: string): void {
  const tab = getActiveTab();
  if (!tab) return;
  if ((tab.data.rows[row]?.[col] ?? '') === value) return;
  const mutation = setCell(tab.data, row, col, value);
  commitMutation(mutation.data, mutation.diff);
}

/** A multi-cell operation (paste, Delete/Backspace-clear) — recorded as a single undo step. */
function handleBulkEdit(edits: CellEdit[]): void {
  const tab = getActiveTab();
  if (!tab) return;
  let data = tab.data;
  const diffs: Diff[] = [];
  for (const edit of edits) {
    if ((data.rows[edit.row]?.[edit.col] ?? '') === edit.value) continue;
    const mutation = setCell(data, edit.row, edit.col, edit.value);
    data = mutation.data;
    diffs.push(mutation.diff);
  }
  if (diffs.length === 0) return;
  commitMutation(data, diffs);
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
  const diffs: Diff[] = [];
  for (let r = minRow; r <= maxRow; r++) {
    for (let c = minCol; c <= maxCol; c++) {
      const mutation = setCell(data, r, c, '');
      data = mutation.data;
      diffs.push(mutation.diff);
    }
  }
  commitMutation(data, diffs);
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
  const commit = <D extends Diff>(mutation: Mutation<D>) => commitMutation(mutation.data, mutation.diff);

  if (target.zone === 'row') {
    const items: ContextMenuItem[] = [
      { label: 'Insert row above', onSelect: () => commit(insertRow(data, target.row)) },
      { label: 'Insert row below', onSelect: () => commit(insertRow(data, target.row + 1)) },
      { label: 'Duplicate row', onSelect: () => commit(duplicateRow(data, target.row)) },
      {
        label: 'Delete row',
        danger: true,
        onSelect: () => {
          if (!confirm(`Delete row ${target.row + 1}?`)) return;
          commit(deleteRow(data, target.row));
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
      { label: 'Insert column left', onSelect: () => commit(insertColumn(data, target.col)) },
      { label: 'Insert column right', onSelect: () => commit(insertColumn(data, target.col + 1)) },
      {
        label: 'Rename column',
        onSelect: () => {
          const name = prompt('Column name', data.headers[target.col]);
          if (name === null) return;
          commit(renameColumn(data, target.col, name));
        },
      },
      {
        label: 'Move left',
        disabled: target.col === 0,
        onSelect: () => commit(reorderColumn(data, target.col, target.col - 1)),
      },
      {
        label: 'Move right',
        disabled: target.col === lastCol,
        onSelect: () => commit(reorderColumn(data, target.col, target.col + 1)),
      },
      {
        label: 'Delete column',
        danger: true,
        onSelect: () => {
          if (!confirm(`Delete column "${headerName}"?`)) return;
          commit(deleteColumn(data, target.col));
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
    void removeRecentFile(tab.id).catch(() => {});
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

// Whole page acts as a drop target (Google Drive/Photos-style), regardless of whether the
// landing page or a document tab is currently showing. A dragenter/dragleave depth counter is
// needed because those events fire (and bubble) for every element the pointer passes over —
// naively hiding the overlay on any dragleave would flicker it off while still dragging over a
// child element.
let dragDepth = 0;

function dataTransferHasFiles(dt: DataTransfer | null): boolean {
  return !!dt && Array.from(dt.types).includes('Files');
}

window.addEventListener('dragenter', (e) => {
  if (!dataTransferHasFiles(e.dataTransfer)) return;
  e.preventDefault();
  dragDepth++;
  pageDropOverlay.classList.add('visible');
});
window.addEventListener('dragover', (e) => {
  if (!dataTransferHasFiles(e.dataTransfer)) return;
  // Required on every dragover for the browser to allow a drop at all.
  e.preventDefault();
});
window.addEventListener('dragleave', (e) => {
  if (!dataTransferHasFiles(e.dataTransfer)) return;
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) pageDropOverlay.classList.remove('visible');
});
window.addEventListener('drop', (e) => {
  e.preventDefault();
  dragDepth = 0;
  pageDropOverlay.classList.remove('visible');
  if (!e.dataTransfer) return;
  void openDroppedFile(e.dataTransfer)
    .then((opened) => {
      if (opened) loadFile(opened);
    })
    .catch((err) => {
      alert(`Failed to open dropped file: ${err instanceof Error ? err.message : String(err)}`);
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
  } else if (key === 'f') {
    // Overrides the browser's native find-in-page: the grid is virtualized, so native find
    // could only ever see whatever rows happen to be rendered near the current scroll position.
    e.preventDefault();
    openFind();
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
      tabs.push({ id: ref.id, data, handle: null, fileType: draft.fileType, dirty: true, history: createHistory() });
      continue;
    }

    // --- reconnect-tab feature (retry #2, 2026-07-17) — see STATUS.md for revert instructions ---
    // kind === 'file': re-read live from disk. queryPermission doesn't need a user gesture
    // (unlike requestPermission), so this can safely run unattended at boot. A moved/deleted
    // file just drops that tab from the restored set — no gesture could fix that anyway. A
    // denied/unconfirmed permission instead restores as a dimmed "needs reconnect" placeholder
    // (see reconnectTab()), since requestPermission() could still succeed from a real click.
    try {
      const handle = ref.handle as FileSystemFileHandle;
      const permission = await handle.queryPermission({ mode: 'read' });
      if (permission !== 'granted') {
        tabs.push({
          id: ref.id,
          data: createDataModel([], [], ref.filename, ','),
          handle,
          fileType: ref.fileType,
          dirty: false,
          history: createHistory(),
          needsReconnect: true,
        });
        continue;
      }
      const file = await handle.getFile();
      const opened: OpenedFile = { name: file.name, text: await file.text(), handle };
      const parsed = parseOpenedFile(opened);
      tabs.push({
        id: ref.id,
        data: parsed.data,
        handle,
        fileType: parsed.type,
        dirty: false,
        history: createHistory(),
      });
    } catch {
      continue;
    }
    // --- end reconnect-tab restore branch ---
  }

  if (tabs.length === 0) return;
  seedUntitledCounter();
  // --- reconnect-tab feature: skip needsReconnect placeholders when picking what to activate ---
  const restoredActive =
    tabs.find((t) => t.id === session.activeTabId && !t.needsReconnect) ?? tabs.find((t) => !t.needsReconnect);
  if (restoredActive) {
    activateTab(restoredActive.id);
  } else {
    // Every restored tab needs reconnecting — nothing to show yet, but this still renders the
    // placeholder tab pills and re-persists the session.
    updateStatus();
  }
  // --- end reconnect-tab tail-activation change ---
}

void restoreSession();
void refreshRecentFilesUI();
