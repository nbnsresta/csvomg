import { DRAFTS_STORE, runTransaction } from './local-db.ts';
import type { ColumnType, DataModel, FileType } from '../types/index.ts';

/**
 * Shadow-persists handle-less ("New") tabs to browser-local storage so they survive an
 * accidental tab close without ever being explicitly saved. Web-only (indexedDB is a browser
 * API) — like web-fs.ts, this isn't part of FileSystemAdapter since a future non-browser venue
 * wouldn't share it; main.ts calls it directly.
 *
 * A failed write here must never interrupt editing; callers treat this as best-effort.
 */

export interface DraftRecord {
  id: string;
  headers: string[];
  rows: string[][];
  filename: string;
  delimiter: string;
  fileType: FileType;
  columnTypes?: Record<string, ColumnType>;
}

export async function saveDraft(id: string, data: DataModel, fileType: FileType): Promise<void> {
  const record: DraftRecord = {
    id,
    headers: data.headers,
    rows: data.rows,
    filename: data.meta.filename,
    delimiter: data.meta.delimiter,
    fileType,
    ...(data.meta.columnTypes ? { columnTypes: data.meta.columnTypes } : {}),
  };
  await runTransaction(DRAFTS_STORE, 'readwrite', (store) => store.put(record));
}

export async function loadDraft(id: string): Promise<DraftRecord | null> {
  const record = await runTransaction<DraftRecord | undefined>(DRAFTS_STORE, 'readonly', (store) => store.get(id));
  return record ?? null;
}

export async function deleteDraft(id: string): Promise<void> {
  await runTransaction(DRAFTS_STORE, 'readwrite', (store) => store.delete(id));
}
