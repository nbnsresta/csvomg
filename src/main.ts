import './style.css';
import {
  countDataColumns,
  countDataRows,
  createDataModel,
  deleteColumn,
  deleteRow,
  duplicateRow,
  hasContent,
  insertColumn,
  insertRow,
  nextColumnLetter,
  normalizeTrailingBuffer,
  renameColumn,
  reorderColumn,
  setCell,
  trimTrailingBlank,
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
import type { DataModel, Diff, FileType, Mutation, Selection, SortState } from './types/index.ts';
import pencilIcon from './icons/pencil.svg?raw';
import plusIcon from './icons/plus.svg?raw';
import arrowUpIcon from './icons/arrow-up.svg?raw';
import trashIcon from './icons/trash.svg?raw';

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

interface TabFindState {
  open: boolean;
  query: string;
  replacement: string;
  replaceOpen: boolean;
  /** -1 when there's no current match. */
  matchIndex: number;
}

function createFindState(): TabFindState {
  return { open: false, query: '', replacement: '', replaceOpen: false, matchIndex: -1 };
}

interface DocTab {
  id: string;
  data: DataModel;
  handle: FileHandle | null;
  fileType: FileType;
  dirty: boolean;
  history: History;
  /** Find/Replace session for this tab — never shared across tabs, see syncFindBar(). */
  find: TabFindState;
  /** View-only row sort — never applied to `data` itself, see renderTabIntoGrid(). Not persisted
   * across a reload, matching `find`'s existing precedent. */
  sort: SortState | null;
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
  onInsertColumn: handleInsertColumn,
  onInsertRow: handleInsertRow,
  onToggleSort: handleToggleSort,
  onColumnOptions: handleColumnOptions,
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

/** Matches for the active tab's current query — a derived cache, recomputed at every point it
 * could go stale (search, replace, tab switch). The persisted bits (query/replacement/open/
 * matchIndex) live on each tab's own `find`, see TabFindState. */
let findMatches: FindMatch[] = [];

const findBar = createFindBar({
  onSearch: runFind,
  onNext: findNext,
  onPrev: findPrev,
  onClose: closeFind,
  onReplace: findReplace,
  onReplaceAll: findReplaceAll,
  onReplacementInput: setReplacementText,
  onToggleReplace: toggleFindReplace,
});

/** Persists replacement text as the user types it, independent of actually firing a replace —
 * otherwise switching tabs before hitting Enter/Replace would silently drop it. */
function setReplacementText(replacement: string): void {
  const tab = getActiveTab();
  if (tab) tab.find.replacement = replacement;
}

/** Searches `data`'s data cells (not headers) case-insensitively. */
function computeMatches(data: DataModel, query: string): FindMatch[] {
  const matches: FindMatch[] = [];
  if (!query) return matches;
  const needle = query.toLowerCase();
  for (let r = 0; r < data.rows.length; r++) {
    for (let c = 0; c < data.headers.length; c++) {
      if ((data.rows[r][c] ?? '').toLowerCase().includes(needle)) {
        matches.push({ row: r, col: c });
      }
    }
  }
  return matches;
}

/** Re-renders the find bar from the active tab's own find state — the one place that pushes
 * state to the view, so restoring a different tab's session on switch is just calling this. */
function syncFindBar(): void {
  const find = getActiveTab()?.find;
  findBar.render({
    open: !!find?.open,
    query: find?.query ?? '',
    replacement: find?.replacement ?? '',
    replaceOpen: !!find?.replaceOpen,
    matchCurrent: find && find.matchIndex >= 0 ? find.matchIndex + 1 : 0,
    matchTotal: find?.open ? findMatches.length : 0,
  });
}

function runFind(query: string): void {
  const tab = getActiveTab();
  if (!tab) return;
  tab.find.query = query;
  findMatches = computeMatches(tab.data, query);
  tab.find.matchIndex = findMatches.length > 0 ? 0 : -1;
  syncFindBar();
  if (tab.find.matchIndex >= 0) jumpToFindMatch();
}

/** Escapes query so it's matched as a literal substring, consistent with computeMatches's .includes(). */
function escapeForRegExp(query: string): string {
  return query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function replaceInCell(current: string, query: string, replacement: string): string {
  return current.replace(new RegExp(escapeForRegExp(query), 'gi'), replacement);
}

/** Replaces just the currently-selected match, then advances to whatever now occupies its slot. */
function findReplace(replacement: string): void {
  const tab = getActiveTab();
  if (!tab) return;
  tab.find.replacement = replacement;
  if (tab.find.matchIndex < 0 || !findMatches[tab.find.matchIndex]) {
    syncFindBar();
    return;
  }
  const match = findMatches[tab.find.matchIndex];
  const current = tab.data.rows[match.row]?.[match.col] ?? '';
  const next = replaceInCell(current, tab.find.query, replacement);
  const mutation = setCell(tab.data, match.row, match.col, next);
  commitMutation(mutation.data, mutation.diff);
  const refreshed = getActiveTab()!;
  findMatches = computeMatches(refreshed.data, refreshed.find.query);
  refreshed.find.matchIndex = findMatches.length > 0 ? refreshed.find.matchIndex % findMatches.length : -1;
  syncFindBar();
  if (refreshed.find.matchIndex >= 0) jumpToFindMatch();
}

/** Replaces every current match in one undo step, same pattern as handleBulkEdit/clearSelectedCells. */
function findReplaceAll(replacement: string): void {
  const tab = getActiveTab();
  if (!tab) return;
  tab.find.replacement = replacement;
  if (findMatches.length === 0) {
    syncFindBar();
    return;
  }
  let data = tab.data;
  const diffs: Diff[] = [];
  for (const match of findMatches) {
    const current = data.rows[match.row]?.[match.col] ?? '';
    const next = replaceInCell(current, tab.find.query, replacement);
    if (next === current) continue;
    const mutation = setCell(data, match.row, match.col, next);
    data = mutation.data;
    diffs.push(mutation.diff);
  }
  if (diffs.length === 0) {
    syncFindBar();
    return;
  }
  commitMutation(data, diffs);
  const refreshed = getActiveTab()!;
  findMatches = computeMatches(refreshed.data, refreshed.find.query);
  refreshed.find.matchIndex = findMatches.length > 0 ? 0 : -1;
  syncFindBar();
  if (refreshed.find.matchIndex >= 0) jumpToFindMatch();
}

function jumpToFindMatch(): void {
  const tab = getActiveTab();
  if (!tab || tab.find.matchIndex < 0) return;
  const match = findMatches[tab.find.matchIndex];
  if (!match) return;
  grid.selectCell(match.row, match.col);
}

function findNext(): void {
  const tab = getActiveTab();
  if (!tab || findMatches.length === 0) return;
  tab.find.matchIndex = (tab.find.matchIndex + 1) % findMatches.length;
  jumpToFindMatch();
  syncFindBar();
}

function findPrev(): void {
  const tab = getActiveTab();
  if (!tab || findMatches.length === 0) return;
  tab.find.matchIndex = (tab.find.matchIndex - 1 + findMatches.length) % findMatches.length;
  jumpToFindMatch();
  syncFindBar();
}

function toggleFindReplace(): void {
  const tab = getActiveTab();
  if (!tab) return;
  tab.find.replaceOpen = !tab.find.replaceOpen;
  syncFindBar();
  if (tab.find.replaceOpen) findBar.focusReplacement();
}

function openFind(withReplace = false): void {
  const tab = getActiveTab();
  if (!tab) return;
  tab.find.open = true;
  if (withReplace) tab.find.replaceOpen = true;
  runFind(tab.find.query);
  if (withReplace) findBar.focusReplacement();
  else findBar.focusQuery();
}

function closeFind(): void {
  const tab = getActiveTab();
  if (tab) tab.find.open = false;
  findMatches = [];
  syncFindBar();
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

/** Never mutates tab.data — only the bytes written out are trimmed, so the live grid keeps its
 * running buffer of blank trailing rows/columns untouched. */
function serializeTab(tab: DocTab): string {
  const data = trimTrailingBlank(tab.data);
  return tab.fileType === 'json' ? serializeJSON(data.headers, data.rows) : serializeCSV(data.headers, data.rows, data.meta.delimiter);
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
    const data = normalizeTrailingBuffer(createDataModel(draft.headers, draft.rows, draft.filename, draft.delimiter)).data;
    tabs.push({ id: entry.id, data, handle: null, fileType: draft.fileType, dirty: true, history: createHistory(), find: createFindState(), sort: null });
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
          data: normalizeTrailingBuffer(parsed.data).data,
          handle,
          fileType: parsed.type,
          dirty: false,
          history: createHistory(),
          find: createFindState(),
          sort: null,
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

/** Numeric-aware compare when both sides parse as numbers, else locale compare. */
function compareCellValues(a: string, b: string): number {
  const na = a.trim() === '' ? NaN : Number(a);
  const nb = b.trim() === '' ? NaN : Number(b);
  if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

/** Real row indices in display order — identity order when unsorted. Recomputed fresh on every
 * call rather than cached: sorts at this app's realistic row counts are cheap, and caching would
 * mean tracking invalidation across every mutation path (insert/delete/paste-growth/undo/redo). */
function computeRowOrder(tab: DocTab): number[] {
  const indices = tab.data.rows.map((_, i) => i);
  if (!tab.sort || tab.sort.sortBy >= tab.data.headers.length) return indices;
  const { sortBy, sortOrder } = tab.sort;
  const dir = sortOrder === 'asc' ? 1 : -1;
  return indices.sort((a, b) => compareCellValues(tab.data.rows[a][sortBy] ?? '', tab.data.rows[b][sortBy] ?? '') * dir);
}

/** Maps a display-space row index (as reported by Grid, which only ever sees the sorted view)
 * back to its real index in `tab.data.rows`. */
function toRealRow(order: number[], displayRow: number): number {
  return order[displayRow] ?? displayRow;
}

/** The one place tab data reaches Grid — pre-sorts a view for display only; `tab.data` itself
 * (and therefore undo/redo, drafts, and the saved file) never sees the reordered rows, which is
 * what makes sort "not etched to file" true by construction. */
function renderTabIntoGrid(tab: DocTab, options?: { resetSelection?: boolean }): void {
  const order = computeRowOrder(tab);
  const view: DataModel = { ...tab.data, rows: order.map((i) => tab.data.rows[i]) };
  grid.setData(view, { resetSelection: options?.resetSelection, sort: tab.sort });
}

function activateTab(id: string): void {
  activeTabId = id;
  const tab = getActiveTab();
  if (!tab) return;
  renderTabIntoGrid(tab, { resetSelection: true });
  showGrid();
  updateStatus();
  // Restore this tab's own find session rather than re-running whatever was last typed
  // elsewhere — find state is per-tab, see TabFindState.
  if (tab.find.open) {
    findMatches = computeMatches(tab.data, tab.find.query);
    if (findMatches.length === 0) {
      tab.find.matchIndex = -1;
    } else if (tab.find.matchIndex < 0 || tab.find.matchIndex >= findMatches.length) {
      tab.find.matchIndex = 0;
    }
  } else {
    findMatches = [];
  }
  syncFindBar();
  if (tab.find.open && tab.find.matchIndex >= 0) jumpToFindMatch();
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
        tab.data = normalizeTrailingBuffer(parsed.data).data;
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
    data: normalizeTrailingBuffer(parsed.data).data,
    handle: opened.handle,
    fileType: parsed.type,
    dirty: false,
    history: createHistory(),
    find: createFindState(),
    sort: null,
  };
  tabs.push(tab);
  activateTab(tab.id);
}

function newFile(): void {
  if (!canOpenNewTab()) return;
  const tab: DocTab = {
    id: crypto.randomUUID(),
    data: normalizeTrailingBuffer(createDataModel([], [], nextUntitledName(), ',')).data,
    handle: null,
    fileType: 'csv',
    dirty: true,
    history: createHistory(),
    find: createFindState(),
    sort: null,
  };
  tabs.push(tab);
  activateTab(tab.id);
  void saveDraft(tab.id, tab.data, tab.fileType).catch((err) => console.error('draft autosave failed', err));
}

/** Applies a resolved DataModel to the active tab: dirty flag, grid render, status, draft autosave. */
function applyTabUpdate(tab: DocTab, data: DataModel): void {
  tab.data = data;
  tab.dirty = true;
  renderTabIntoGrid(tab);
  updateStatus();
  if (!tab.handle) {
    void saveDraft(tab.id, tab.data, tab.fileType).catch((err) => console.error('draft autosave failed', err));
  }
}

/**
 * Commits a new DataModel from any mutation (cell edit, row/column action, clear, ...) and
 * records it as one undo step. A single mutation passes one Diff; an operation that touches
 * several cells at once (e.g. clearing a range) passes all of them as an array so the whole
 * thing undoes in one step rather than cell-by-cell. Also re-balances the running buffer of
 * blank trailing rows/columns (see normalizeTrailingBuffer) and folds that into the same undo
 * step, so every mutation path in the app gets it for free without its own call site changes.
 */
function commitMutation(data: DataModel, diff: Diff | Diff[]): void {
  const tab = getActiveTab();
  if (!tab) return;
  const diffs = Array.isArray(diff) ? diff : [diff];
  // A column structural edit can leave `sort.sortBy` pointing at the wrong column — silently
  // sorting by the wrong column would be worse than sort just turning off, so it's cleared rather
  // than remapped. Checked against the original diffs only, before normalizeTrailingBuffer's own
  // buffer-maintenance column diffs are appended below — those must NOT clear an active sort.
  if (tab.sort && diffs.some((d) => d.type === 'col-insert' || d.type === 'col-delete' || d.type === 'col-reorder')) {
    tab.sort = null;
  }
  const normalized = normalizeTrailingBuffer(data);
  tab.history = pushGroup(tab.history, [...diffs, ...normalized.diffs]);
  applyTabUpdate(tab, normalized.data);
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

/** Header sort-icon click — cycles asc → desc → none. Not a content change: doesn't mark the tab
 * dirty. Resets selection since a selected cell has no coherent identity across a reorder (same
 * reasoning as the tab-switch resetSelection fix). */
function handleToggleSort(col: number): void {
  const tab = getActiveTab();
  if (!tab) return;
  if (!tab.sort || tab.sort.sortBy !== col) tab.sort = { sortBy: col, sortOrder: 'asc' };
  else if (tab.sort.sortOrder === 'asc') tab.sort = { sortBy: col, sortOrder: 'desc' };
  else tab.sort = null;
  renderTabIntoGrid(tab, { resetSelection: true });
  updateStatus();
  grid.focus(); // the clicked button's DOM node is torn down by the re-render, taking focus with it
}

/** Hover "+" between two column headers / gutter cells (grid.ts) — inserts blank at the boundary. */
function handleInsertColumn(col: number): void {
  const tab = getActiveTab();
  if (!tab) return;
  const mutation = insertColumn(tab.data, col);
  commitMutation(mutation.data, mutation.diff);
}

function handleInsertRow(row: number): void {
  const tab = getActiveTab();
  if (!tab) return;
  const order = computeRowOrder(tab);
  const realRow = row < order.length ? order[row] : tab.data.rows.length;
  const mutation = insertRow(tab.data, realRow);
  commitMutation(mutation.data, mutation.diff);
}

function handleCellEdit(row: number, col: number, value: string): void {
  const tab = getActiveTab();
  if (!tab) return;
  const realRow = toRealRow(computeRowOrder(tab), row);
  if ((tab.data.rows[realRow]?.[col] ?? '') === value) return;
  const mutation = setCell(tab.data, realRow, col, value);
  commitMutation(mutation.data, mutation.diff);
}

/** A multi-cell operation (paste, Delete/Backspace-clear) — recorded as a single undo step.
 * Paste can target cells beyond the sheet's current bounds (grid.ts no longer clips it, see
 * applyPastedText) — grown first so the whole pasted block lands. Delete/Backspace-clear's
 * edits are always already in-bounds, so these loops are no-ops on that path. Edits within the
 * original row count are display-space and translate via the sort order; edits beyond it are
 * rows the growth loop just appended at the real physical end, so they're already real indices. */
function handleBulkEdit(edits: CellEdit[]): void {
  const tab = getActiveTab();
  if (!tab) return;
  const order = computeRowOrder(tab);
  const originalRowCount = tab.data.rows.length;
  let data = tab.data;
  const diffs: Diff[] = [];
  const maxRow = Math.max(-1, ...edits.map((e) => e.row));
  const maxCol = Math.max(-1, ...edits.map((e) => e.col));
  while (data.rows.length <= maxRow) {
    const m = insertRow(data, data.rows.length);
    data = m.data;
    diffs.push(m.diff);
  }
  while (data.headers.length <= maxCol) {
    const m = insertColumn(data, data.headers.length, nextColumnLetter(data.headers.length));
    data = m.data;
    diffs.push(m.diff);
  }
  for (const edit of edits) {
    const realRow = edit.row < originalRowCount ? toRealRow(order, edit.row) : edit.row;
    if ((data.rows[realRow]?.[edit.col] ?? '') === edit.value) continue;
    const mutation = setCell(data, realRow, edit.col, edit.value);
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
  const order = computeRowOrder(tab);
  const minRow = Math.min(sel.startRow, sel.endRow);
  const maxRow = Math.max(sel.startRow, sel.endRow);
  const minCol = Math.min(sel.startCol, sel.endCol);
  const maxCol = Math.max(sel.startCol, sel.endCol);
  let data = tab.data;
  const diffs: Diff[] = [];
  for (let r = minRow; r <= maxRow; r++) {
    const realRow = toRealRow(order, r);
    for (let c = minCol; c <= maxCol; c++) {
      const mutation = setCell(data, realRow, c, '');
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

/**
 * Column actions, shared between the right-click header menu and the header options-icon menu —
 * one options-icon click gets you the identical menu right-click already gives you, just a
 * second, always-visible entry point. Order/icons match what's requested for the options icon;
 * the right-click menu adopts the same order+icons rather than keeping two different orderings
 * for the exact same actions.
 */
function buildColumnActionItems(data: DataModel, col: number): ContextMenuItem[] {
  const commit = <D extends Diff>(mutation: Mutation<D>) => commitMutation(mutation.data, mutation.diff);
  const lastCol = data.headers.length - 1;
  const headerName = data.headers[col] || `Column ${col + 1}`;
  return [
    {
      label: 'Rename column',
      icon: pencilIcon,
      onSelect: () => {
        const name = prompt('Column name', data.headers[col]);
        if (name === null) return;
        commit(renameColumn(data, col, name));
      },
    },
    { label: 'Insert column left', icon: plusIcon, onSelect: () => commit(insertColumn(data, col)) },
    { label: 'Insert column right', icon: plusIcon, onSelect: () => commit(insertColumn(data, col + 1)) },
    {
      label: 'Move left',
      icon: arrowUpIcon,
      iconClass: 'icon-rot-270',
      disabled: col === 0,
      onSelect: () => commit(reorderColumn(data, col, col - 1)),
    },
    {
      label: 'Move right',
      icon: arrowUpIcon,
      iconClass: 'icon-rot-90',
      disabled: col === lastCol,
      onSelect: () => commit(reorderColumn(data, col, col + 1)),
    },
    {
      label: 'Delete column',
      icon: trashIcon,
      danger: true,
      onSelect: () => {
        if (!confirm(`Delete column "${headerName}"?`)) return;
        commit(deleteColumn(data, col));
      },
    },
  ];
}

/** Header options-icon click (grid.ts) — opens the same menu as right-clicking the header. */
function handleColumnOptions(col: number, x: number, y: number): void {
  const tab = getActiveTab();
  if (!tab) return;
  showContextMenu(x, y, withFocus(buildColumnActionItems(tab.data, col)));
}

function handleContextMenu(target: ContextMenuTarget): void {
  const tab = getActiveTab();
  if (!tab) return;
  const data = tab.data;
  const commit = <D extends Diff>(mutation: Mutation<D>) => commitMutation(mutation.data, mutation.diff);

  if (target.zone === 'row') {
    const realRow = toRealRow(computeRowOrder(tab), target.row);
    const items: ContextMenuItem[] = [
      { label: 'Insert row above', onSelect: () => commit(insertRow(data, realRow)) },
      { label: 'Insert row below', onSelect: () => commit(insertRow(data, realRow + 1)) },
      { label: 'Duplicate row', onSelect: () => commit(duplicateRow(data, realRow)) },
      {
        label: 'Delete row',
        danger: true,
        onSelect: () => {
          if (!confirm(`Delete row ${target.row + 1}?`)) return;
          commit(deleteRow(data, realRow));
        },
      },
    ];
    showContextMenu(target.x, target.y, withFocus(items));
    return;
  }

  if (target.zone === 'col') {
    showContextMenu(target.x, target.y, withFocus(buildColumnActionItems(data, target.col)));
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
  grid.commitPendingEdit();
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
  grid.commitPendingEdit();
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
  // grid.setData() (tab switch) and grid.refresh() don't themselves fire onSelectionChange, so
  // this is the one place — called on every mutation and every tab switch — that keeps the
  // status bar's selection text from going stale relative to whichever tab is actually active.
  updateSelectionStatus(tab ? grid.getSelection() : null);

  if (!tab) {
    statusCounts.textContent = '';
    document.title = 'csvomg';
    renderTabs();
    persistSession();
    return;
  }
  const rows = countDataRows(tab.data);
  const cols = countDataColumns(tab.data);
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
  } else if (key === 'h') {
    e.preventDefault();
    openFind(true);
  }
});

async function restoreSession(): Promise<void> {
  const session = await loadSession().catch(() => null);
  if (!session || session.tabs.length === 0) return;

  for (const ref of session.tabs) {
    if (ref.kind === 'draft') {
      const draft = await loadDraft(ref.id).catch(() => null);
      if (!draft) continue;
      const rawData = createDataModel(draft.headers, draft.rows, draft.filename, draft.delimiter);
      if (!hasContent(rawData)) continue;
      const data = normalizeTrailingBuffer(rawData).data;
      tabs.push({ id: ref.id, data, handle: null, fileType: draft.fileType, dirty: true, history: createHistory(), find: createFindState(), sort: null });
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
          find: createFindState(),
          sort: null,
          needsReconnect: true,
        });
        continue;
      }
      const file = await handle.getFile();
      const opened: OpenedFile = { name: file.name, text: await file.text(), handle };
      const parsed = parseOpenedFile(opened);
      tabs.push({
        id: ref.id,
        data: normalizeTrailingBuffer(parsed.data).data,
        handle,
        fileType: parsed.type,
        dirty: false,
        history: createHistory(),
        find: createFindState(),
        sort: null,
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
