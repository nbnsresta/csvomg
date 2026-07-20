/**
 * The app's first use of localStorage — everywhere else (drafts/session/recent-files) uses
 * IndexedDB via local-db.ts. Deliberate, not an oversight: settings are a few small scalars,
 * read-mostly, and the theme specifically needs a synchronous read at boot (see the inline
 * script in index.html's <head>) to avoid a flash of the wrong theme before first paint, which
 * an async IndexedDB round-trip can't give cleanly.
 */

export interface Settings {
  theme: 'dark' | 'light';
  autoSave: boolean;
  /** One of parser.ts's CANDIDATE_DELIMITERS. Only affects newFile()'s default — an already-open
   * file keeps using its own detected/stored delimiter regardless of this setting. */
  defaultDelimiter: string;
}

export const DEFAULT_SETTINGS: Settings = { theme: 'dark', autoSave: false, defaultDelimiter: ',' };

const STORAGE_KEY = 'csvomg-settings';

function isValidTheme(value: unknown): value is Settings['theme'] {
  return value === 'dark' || value === 'light';
}

/** Tolerant of missing/corrupt/partial stored data — always returns a fully-populated Settings. */
export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return {
      theme: isValidTheme(parsed.theme) ? parsed.theme : DEFAULT_SETTINGS.theme,
      autoSave: typeof parsed.autoSave === 'boolean' ? parsed.autoSave : DEFAULT_SETTINGS.autoSave,
      defaultDelimiter: typeof parsed.defaultDelimiter === 'string' ? parsed.defaultDelimiter : DEFAULT_SETTINGS.defaultDelimiter,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: Settings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}
