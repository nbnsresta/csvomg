/**
 * Adapter seam for file I/O across venues (browser tab, PWA, extension, future VS Code host).
 * Only web-fs.ts implements this today. A new venue with different file-access primitives
 * (e.g. vscode.workspace.fs) gets its own adapter file implementing the same interface —
 * src/core and src/ui never need to know which one is active.
 */

/** Opaque per-adapter handle — pass back to the same adapter's methods, never inspect. */
export type FileHandle = unknown;

export interface OpenedFile {
  name: string;
  text: string;
  handle: FileHandle | null;
}

export interface FileSystemAdapter {
  /** Whether saveToHandle can write back without re-prompting the user. */
  readonly supportsDirectSave: boolean;
  openFiles(multiple?: boolean): Promise<OpenedFile[]>;
  saveToHandle(handle: FileHandle, text: string): Promise<void>;
  /**
   * Prompts for a save location. Returns the new handle and the name the user actually chose
   * (which may differ from suggestedName) when the adapter supports direct save, else null.
   */
  saveFileAs(text: string, suggestedName: string): Promise<{ handle: FileHandle; name: string } | null>;
}
