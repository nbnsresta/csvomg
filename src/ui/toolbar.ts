/**
 * Wires up the toolbar's already-static markup in index.html (unlike find-bar.ts, which builds
 * its own DOM) — New/Open/Save landed directly in main.ts on 2026-07-16; this just relocates that
 * wiring into its own module and adds the Settings button alongside it.
 */

import slidersIcon from '../icons/sliders.svg?raw';
import { createIcon } from '../utils/icons.ts';

export interface ToolbarOptions {
  onNew: VoidFunction;
  onOpen: VoidFunction;
  onSave: VoidFunction;
  onSettings: VoidFunction;
}

export interface ToolbarController {
  setSaveEnabled: (enabled: boolean) => void;
}

export function initToolbar(options: ToolbarOptions): ToolbarController {
  const btnNew = document.getElementById('btn-toolbar-new') as HTMLButtonElement;
  const btnOpen = document.getElementById('btn-toolbar-open') as HTMLButtonElement;
  const btnSave = document.getElementById('btn-toolbar-save') as HTMLButtonElement;
  const btnSettings = document.getElementById('btn-toolbar-settings') as HTMLButtonElement;
  btnSettings.appendChild(createIcon(slidersIcon));

  btnNew.addEventListener('click', options.onNew);
  btnOpen.addEventListener('click', options.onOpen);
  btnSave.addEventListener('click', options.onSave);
  btnSettings.addEventListener('click', options.onSettings);

  return {
    setSaveEnabled: (enabled) => {
      btnSave.disabled = !enabled;
    },
  };
}
