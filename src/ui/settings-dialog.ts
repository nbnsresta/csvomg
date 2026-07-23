/**
 * Fills the empty <dialog id="dialog-settings"> scaffold that's existed since the Phase 1
 * scaffold. Uses the real native <dialog> API (showModal()/close()) rather than
 * reconnect-dialog.ts's hand-rolled full-viewport overlay div — that overlay exists specifically
 * because that dialog must stay non-dismissible while a permission request is pending; a plain
 * settings panel has no such requirement, so Escape/backdrop-dismiss are both fine and native
 * <dialog> gives them (almost) for free.
 *
 * Built once (content wired on first call, like find-bar.ts). Every control change calls
 * onChange immediately with the full updated Settings — no separate Save/Cancel step, a setting
 * takes effect right away.
 */

import type { Settings } from '../io/settings.ts';

let dialog: HTMLDialogElement | null = null;
let themeDarkInput: HTMLInputElement;
let themeLightInput: HTMLInputElement;
let autoSaveInput: HTMLInputElement;

let current: Settings = { theme: 'dark', autoSave: false, uiScale: 1 };
let onChangeCallback: (next: Settings) => void = () => {};

function emitChange(patch: Partial<Settings>): void {
  current = { ...current, ...patch };
  onChangeCallback(current);
}

function buildDialog(): HTMLDialogElement {
  const el = document.getElementById('dialog-settings') as HTMLDialogElement;
  el.className = 'settings-dialog';

  const title = document.createElement('h3');
  title.textContent = 'Settings';
  el.appendChild(title);

  const themeGroup = document.createElement('fieldset');
  themeGroup.className = 'settings-group';
  const themeLegend = document.createElement('legend');
  themeLegend.textContent = 'Theme';
  themeGroup.appendChild(themeLegend);

  const darkLabel = document.createElement('label');
  themeDarkInput = document.createElement('input');
  themeDarkInput.type = 'radio';
  themeDarkInput.name = 'settings-theme';
  themeDarkInput.value = 'dark';
  themeDarkInput.addEventListener('change', () => {
    if (themeDarkInput.checked) emitChange({ theme: 'dark' });
  });
  darkLabel.append(themeDarkInput, ' Dark');
  themeGroup.appendChild(darkLabel);

  const lightLabel = document.createElement('label');
  themeLightInput = document.createElement('input');
  themeLightInput.type = 'radio';
  themeLightInput.name = 'settings-theme';
  themeLightInput.value = 'light';
  themeLightInput.addEventListener('change', () => {
    if (themeLightInput.checked) emitChange({ theme: 'light' });
  });
  lightLabel.append(themeLightInput, ' Light');
  themeGroup.appendChild(lightLabel);

  el.appendChild(themeGroup);

  const autoSaveGroup = document.createElement('div');
  autoSaveGroup.className = 'settings-group';
  const autoSaveLabel = document.createElement('label');
  autoSaveInput = document.createElement('input');
  autoSaveInput.type = 'checkbox';
  autoSaveInput.addEventListener('change', () => emitChange({ autoSave: autoSaveInput.checked }));
  autoSaveLabel.append(autoSaveInput, ' Automatically save to the linked file after editing');
  autoSaveGroup.appendChild(autoSaveLabel);
  el.appendChild(autoSaveGroup);

  const doneBtn = document.createElement('button');
  doneBtn.type = 'button';
  doneBtn.className = 'btn btn-primary settings-done';
  doneBtn.textContent = 'Done';
  doneBtn.addEventListener('click', () => el.close());
  el.appendChild(doneBtn);

  // Native <dialog> only closes on Escape by default — a click on the ::backdrop still dispatches
  // a click on the dialog element itself (there's no way to target ::backdrop directly), so a
  // click outside the dialog's own content box is what "outside click" means here.
  el.addEventListener('click', (event) => {
    const rect = el.getBoundingClientRect();
    const inside =
      event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom;
    if (!inside) el.close();
  });

  return el;
}

export function showSettingsDialog(settings: Settings, onChange: (next: Settings) => void): void {
  current = settings;
  onChangeCallback = onChange;
  if (!dialog) dialog = buildDialog();
  themeDarkInput.checked = settings.theme === 'dark';
  themeLightInput.checked = settings.theme === 'light';
  autoSaveInput.checked = settings.autoSave;
  if (!dialog.open) dialog.showModal();
}
