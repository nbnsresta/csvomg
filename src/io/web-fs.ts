import type { FileHandle, FileSystemAdapter, OpenedFile } from './types.ts';

const PICKER_TYPES = [
  {
    description: 'CSV/TSV/JSON',
    accept: {
      'text/csv': ['.csv', '.tsv'],
      'application/json': ['.json'],
    },
  },
];

function supportsFileSystemAccess(): boolean {
  return typeof window !== 'undefined' && 'showOpenFilePicker' in window;
}

/** Opens one or more files. Uses the File System Access API when available, else an <input> fallback. */
async function openFiles(multiple = true): Promise<OpenedFile[]> {
  if (supportsFileSystemAccess()) {
    let handles: FileSystemFileHandle[];
    try {
      handles = await window.showOpenFilePicker({ multiple, types: PICKER_TYPES });
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return [];
      throw err;
    }
    return Promise.all(
      handles.map(async (handle) => {
        const file = await handle.getFile();
        return { name: file.name, text: await file.text(), handle };
      }),
    );
  }
  return openFilesFallback(multiple);
}

function openFilesFallback(multiple: boolean): Promise<OpenedFile[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.csv,.tsv,.json,text/csv,application/json';
    input.multiple = multiple;
    input.style.display = 'none';

    input.addEventListener(
      'change',
      () => {
        const files = Array.from(input.files ?? []);
        input.remove();
        Promise.all(
          files.map(async (file) => ({ name: file.name, text: await file.text(), handle: null })),
        ).then(resolve);
      },
      { once: true },
    );
    // Fires if the user dismisses the OS picker without choosing a file.
    window.addEventListener(
      'focus',
      () => {
        setTimeout(() => {
          if (!input.files || input.files.length === 0) {
            input.remove();
            resolve([]);
          }
        }, 300);
      },
      { once: true },
    );

    document.body.appendChild(input);
    input.click();
  });
}

/**
 * Resolves a dropped file, preferring a live FileSystemFileHandle (Chromium) so Ctrl+S can write
 * straight back to it, same as the Open File picker. Firefox/Safari, or a drop that isn't backed
 * by a real OS file, fall back to a plain File read with handle: null (Save As/download only).
 *
 * item.getAsFileSystemHandle() must be called synchronously within the drop handler, before any
 * await — DataTransferItems are invalidated once the handler yields to the event loop.
 */
async function openDroppedFile(dataTransfer: DataTransfer): Promise<OpenedFile | null> {
  const item = Array.from(dataTransfer.items).find((it) => it.kind === 'file');
  if (!item) return null;

  const handlePromise = item.getAsFileSystemHandle?.();
  if (handlePromise) {
    // Resolves to null (not a rejection) when the drop isn't backed by a real OS file —
    // e.g. a synthetic DataTransfer, or a drag origin that can't vend a handle.
    const handle = await handlePromise;
    if (handle && handle.kind === 'file') {
      const file = await handle.getFile();
      return { name: file.name, text: await file.text(), handle };
    }
  }

  const file = item.getAsFile();
  if (!file) return null;
  return { name: file.name, text: await file.text(), handle: null };
}

async function saveToHandle(handle: FileHandle, text: string): Promise<void> {
  const writable = await (handle as FileSystemFileHandle).createWritable();
  await writable.write(text);
  await writable.close();
}

/** Prompts for a new save location (Chromium) or triggers a download (fallback). Returns the new handle, if any. */
async function saveFileAs(text: string, suggestedName: string): Promise<FileHandle | null> {
  if (supportsFileSystemAccess()) {
    let handle: FileSystemFileHandle;
    try {
      handle = await window.showSaveFilePicker({ suggestedName, types: PICKER_TYPES });
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return null;
      throw err;
    }
    await saveToHandle(handle, text);
    return handle;
  }
  downloadFallback(text, suggestedName);
  return null;
}

function downloadFallback(text: string, filename: string): void {
  const blob = new Blob([text], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export { openDroppedFile };

export const webFileSystemAdapter: FileSystemAdapter = {
  supportsDirectSave: supportsFileSystemAccess(),
  openFiles,
  saveToHandle,
  saveFileAs,
};
