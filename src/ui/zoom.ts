/**
 * UI scale ("zoom") control — a status-bar slider that scales the grid's data for readability.
 * Implemented via the CSS `zoom` property on `#grid-container` (index.html), not
 * `transform: scale()`: `zoom` changes *used values* for layout the same way real browser
 * page-zoom does, so grid.ts's virtualization math (which reads/writes raw pixel values like
 * ROW_HEIGHT) stays correct with zero changes — both the values it reads (scrollTop,
 * clientHeight) and the values it writes (style.top) live in the same zoomed pixel space.
 *
 * Deliberately scoped to just the grid, not the whole app (an earlier version zoomed the entire
 * app shell — toolbar, tab bar, status bar included — but that shifted buttons and controls
 * around every time the slider moved, which read as a UX downgrade rather than a reading aid).
 * Scoping it this far down a side effect: dialogs, the context menu, and the drag-to-reorder
 * ghost (all appended as plain `document.body` children, well outside `#grid-container`) never
 * need any special handling to stay at native scale — they were never at risk of inheriting the
 * zoom to begin with, since they're not descendants of the zoomed element. See STATUS.md's
 * "Zoom / scale slider" notes for the full history, including why a *whole-app* zoom needed that
 * extra care and this one doesn't.
 *
 * ZOOM_MIN/ZOOM_MAX live in io/settings.ts (the single source of truth also used for validating
 * the persisted value) — this module imports them rather than redeclaring the range.
 */

import { ZOOM_MAX, ZOOM_MIN } from '../io/settings.ts';

/** Slider granularity — independent of the min/max bounds, tune separately. */
export const ZOOM_STEP = 0.1;

function gridContainer(): HTMLElement {
  return document.getElementById('grid-container') as HTMLElement;
}

export function clampZoom(scale: number): number {
  if (!Number.isFinite(scale)) return 1;
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, scale));
}

export function applyZoom(scale: number): void {
  gridContainer().style.zoom = String(clampZoom(scale));
}

/** Reads back the zoom `applyZoom()` last set — grid.ts uses this to un-scale a raw
 * clientX/clientY drag delta before adding it to a local/zoomed-space CSS size (column resize). */
export function getCurrentZoom(): number {
  return parseFloat(gridContainer().style.zoom) || 1;
}

export function initZoomControl(container: HTMLElement, initial: number, onChange: (scale: number) => void): void {
  const slider = document.createElement('input');
  slider.type = 'range';
  slider.className = 'status-zoom-slider';
  slider.min = String(ZOOM_MIN);
  slider.max = String(ZOOM_MAX);
  slider.step = String(ZOOM_STEP);
  slider.setAttribute('aria-label', 'UI scale');

  const label = document.createElement('span');
  label.className = 'status-zoom-label';

  const setLabel = (scale: number): void => {
    label.textContent = `${Math.round(scale * 100)}%`;
  };

  const start = clampZoom(initial);
  slider.value = String(start);
  setLabel(start);

  slider.addEventListener('input', () => {
    const scale = clampZoom(Number(slider.value));
    applyZoom(scale);
    setLabel(scale);
  });
  slider.addEventListener('change', () => {
    onChange(clampZoom(Number(slider.value)));
  });

  container.append(slider, label);
}
