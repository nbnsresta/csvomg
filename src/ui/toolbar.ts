/**
 * Wires up the toolbar's already-static markup in index.html (unlike find-bar.ts, which builds
 * its own DOM) — New/Open/Save landed directly in main.ts on 2026-07-16; this just relocates that
 * wiring into its own module and adds the Settings button alongside it.
 */

import chevronDownIcon from '../icons/chevron-down.svg?raw';
import infoCircleIcon from '../icons/info-circle.svg?raw';
import slidersIcon from '../icons/sliders.svg?raw';
import { createIcon } from '../utils/icons.ts';
import { showContextMenu } from './context-menu.ts';

export interface ToolbarOptions {
  onNew: VoidFunction;
  onOpen: VoidFunction;
  onSave: VoidFunction;
  onSaveAs: VoidFunction;
  onAbout: VoidFunction;
  onSettings: VoidFunction;
}

export interface ToolbarController {
  setSaveEnabled: (enabled: boolean) => void;
}

export function initToolbar(options: ToolbarOptions): ToolbarController {
  const btnNew = document.getElementById('btn-toolbar-new') as HTMLButtonElement;
  const btnOpen = document.getElementById('btn-toolbar-open') as HTMLButtonElement;
  const btnSave = document.getElementById('btn-toolbar-save') as HTMLButtonElement;
  const btnSaveMenu = document.getElementById('btn-toolbar-save-menu') as HTMLButtonElement;
  const btnAbout = document.getElementById('btn-toolbar-about') as HTMLButtonElement;
  const btnSettings = document.getElementById('btn-toolbar-settings') as HTMLButtonElement;
  btnSaveMenu.appendChild(createIcon(chevronDownIcon));
  btnAbout.appendChild(createIcon(infoCircleIcon));
  btnSettings.appendChild(createIcon(slidersIcon));

  btnNew.addEventListener('click', options.onNew);
  btnOpen.addEventListener('click', options.onOpen);
  btnSave.addEventListener('click', options.onSave);
  btnSaveMenu.addEventListener('click', () => {
    const rect = btnSaveMenu.getBoundingClientRect();
    showContextMenu(rect.left, rect.bottom + 4, [{ label: 'Save As...', onSelect: options.onSaveAs }]);
  });
  btnAbout.addEventListener('click', options.onAbout);
  btnSettings.addEventListener('click', options.onSettings);

  return {
    setSaveEnabled: (enabled) => {
      btnSave.disabled = !enabled;
      btnSaveMenu.disabled = !enabled;
    },
  };
}
