import { runTransaction, SESSION_STORE } from './local-db.ts';
import type { FileHandle } from './types.ts';
import type { FileType } from '../types/index.ts';

/**
 * Persists the whole open-tab set (not per-tab content — see drafts.ts for that) so a page
 * reload can restore the previous view: which tabs were open, in what order, and which was
 * active. Web-only, like drafts.ts/web-fs.ts — not part of FileSystemAdapter.
 */

const SESSION_KEY = 'current';

export interface SessionTabRef {
  id: string;
  /** Derived from handle presence at save time, not tracked separately. */
  kind: 'draft' | 'file';
  /** Present when kind === 'file'. FileSystemFileHandle is structured-cloneable and IndexedDB-storable by spec. */
  handle: FileHandle | null;
  filename: string;
  fileType: FileType;
}

export interface SessionState {
  tabs: SessionTabRef[];
  activeTabId: string | null;
}

interface SessionRecord extends SessionState {
  key: typeof SESSION_KEY;
}

export async function saveSession(state: SessionState): Promise<void> {
  const record: SessionRecord = { key: SESSION_KEY, ...state };
  await runTransaction(SESSION_STORE, 'readwrite', (store) => store.put(record));
}

export async function loadSession(): Promise<SessionState | null> {
  const record = await runTransaction<SessionRecord | undefined>(SESSION_STORE, 'readonly', (store) =>
    store.get(SESSION_KEY),
  );
  return record ? { tabs: record.tabs, activeTabId: record.activeTabId } : null;
}

export async function clearSession(): Promise<void> {
  await runTransaction(SESSION_STORE, 'readwrite', (store) => store.delete(SESSION_KEY));
}
