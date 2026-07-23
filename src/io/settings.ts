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
  uiScale: number;
}

export const DEFAULT_SETTINGS: Settings = { theme: 'dark', autoSave: false, uiScale: 1 };

/** Bounds for the zoom/scale slider (src/ui/zoom.ts) — the single source of truth other modules
 * import rather than redeclaring, so retuning the range only ever means changing it here. */
export const ZOOM_MIN = 1;
export const ZOOM_MAX = 1.5;

const STORAGE_KEY = 'csvomg-settings';

function isValidTheme(value: unknown): value is Settings['theme'] {
  return value === 'dark' || value === 'light';
}

function isValidUiScale(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= ZOOM_MIN && value <= ZOOM_MAX;
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
      uiScale: isValidUiScale(parsed.uiScale) ? parsed.uiScale : DEFAULT_SETTINGS.uiScale,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: Settings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}
