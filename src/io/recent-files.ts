import { deleteDraft } from './drafts.ts';
import { RECENT_FILES_STORE, runTransaction } from './local-db.ts';
import type { FileHandle } from './types.ts';
import type { FileType } from '../types/index.ts';

/**
 * A history of closed documents that can be reopened, distinct from session.ts (the *live* open
 * tab set, restored as-is on reload). Pure pointers, never content: draft-kind entries reference
 * the same id already used as a drafts.ts key, so no content is duplicated; file-kind entries
 * hold a live FileSystemFileHandle and re-read from disk on reopen, same as restoreSession() does.
 */

export type RecentFileKind = 'draft' | 'file';

export interface RecentFileEntry {
  id: string;
  kind: RecentFileKind;
  filename: string;
  fileType: FileType;
  handle: FileHandle | null;
  updatedAt: number;
}

export const MAX_RECENT_FILES = 15;

async function pruneToCap(): Promise<void> {
  const all = await runTransaction<RecentFileEntry[]>(RECENT_FILES_STORE, 'readonly', (store) => store.getAll());
  if (all.length <= MAX_RECENT_FILES) return;
  const overflow = all.sort((a, b) => b.updatedAt - a.updatedAt).slice(MAX_RECENT_FILES);
  for (const entry of overflow) {
    await runTransaction(RECENT_FILES_STORE, 'readwrite', (store) => store.delete(entry.id));
    if (entry.kind === 'draft') {
      await deleteDraft(entry.id).catch(() => {});
    }
  }
}

export async function recordRecentDraft(id: string, filename: string, fileType: FileType): Promise<void> {
  const entry: RecentFileEntry = { id, kind: 'draft', filename, fileType, handle: null, updatedAt: Date.now() };
  await runTransaction(RECENT_FILES_STORE, 'readwrite', (store) => store.put(entry));
  await pruneToCap();
}

export async function recordRecentFile(handle: FileHandle, filename: string, fileType: FileType): Promise<void> {
  const entry: RecentFileEntry = { id: `file:${filename}`, kind: 'file', filename, fileType, handle, updatedAt: Date.now() };
  await runTransaction(RECENT_FILES_STORE, 'readwrite', (store) => store.put(entry));
  await pruneToCap();
}

export async function listRecentFiles(): Promise<RecentFileEntry[]> {
  const all = await runTransaction<RecentFileEntry[]>(RECENT_FILES_STORE, 'readonly', (store) => store.getAll());
  return all.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function removeRecentFile(id: string): Promise<void> {
  await runTransaction(RECENT_FILES_STORE, 'readwrite', (store) => store.delete(id));
}
