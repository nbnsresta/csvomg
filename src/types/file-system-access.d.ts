// TypeScript's bundled lib.dom.d.ts declares FileSystemFileHandle/FileSystemWritableFileStream
// but not the picker entry points yet. Minimal ambient declarations for what we use.
export {};

interface FilePickerAcceptType {
  description?: string;
  accept: Record<string, string | string[]>;
}

interface FilePickerOptions {
  types?: FilePickerAcceptType[];
  excludeAcceptAllOption?: boolean;
}

interface OpenFilePickerOptions extends FilePickerOptions {
  multiple?: boolean;
}

interface SaveFilePickerOptions extends FilePickerOptions {
  suggestedName?: string;
}

interface FileSystemHandlePermissionDescriptor {
  mode?: 'read' | 'readwrite';
}

declare global {
  interface Window {
    showOpenFilePicker(options?: OpenFilePickerOptions): Promise<FileSystemFileHandle[]>;
    showSaveFilePicker(options?: SaveFilePickerOptions): Promise<FileSystemFileHandle>;
  }

  interface DataTransferItem {
    // Chromium-only; part of the File System Access API, not yet in lib.dom.d.ts. Resolves to
    // null (not a rejection) when the drop isn't backed by a real OS file.
    getAsFileSystemHandle?(): Promise<FileSystemFileHandle | FileSystemDirectoryHandle | null>;
  }

  interface FileSystemHandle {
    // Not yet in lib.dom.d.ts. queryPermission doesn't need a user gesture; requestPermission does.
    queryPermission(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
    requestPermission(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
  }
}
