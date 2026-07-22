/**
 * Fills the empty <dialog id="dialog-save-as"> scaffold — the single format-picker window every
 * Save-As entry point (the split-button's "Save As..." item and Ctrl+Shift+S) now opens before the
 * native save picker, letting the user pick the target file type (and, for delimited text, the
 * delimiter) instead of always re-saving in the tab's current format. Converting between CSV/TSV
 * and JSON is safe in both directions: JSON import already flattens into the same headers/rows
 * shape CSV uses, and un-flattens back out symmetrically on export (see core/parser.ts).
 *
 * Same native <dialog> pattern as settings-dialog.ts/export-dialog.ts (built once, content
 * re-synced per call). Cancel/Save rather than auto-apply-on-change, like export-dialog.ts — the
 * choice only takes effect once, when the user commits to a save location.
 */

import { CANDIDATE_DELIMITERS } from '../core/parser.ts';
import type { FileType } from '../types/index.ts';

export interface SaveAsChoice {
  fileType: FileType;
  /** Meaningful only when fileType === 'csv'. */
  delimiter: string;
}

const DELIMITER_LABELS: Record<string, string> = { ',': 'Comma', '\t': 'Tab', ';': 'Semicolon', '|': 'Pipe' };

let dialog: HTMLDialogElement | null = null;
let csvRadio: HTMLInputElement;
let jsonRadio: HTMLInputElement;
let delimiterGroup: HTMLDivElement;
let delimiterSelect: HTMLSelectElement;
let saveBtn: HTMLButtonElement;

function syncDelimiterVisibility(): void {
  delimiterGroup.classList.toggle('hidden', !csvRadio.checked);
}

function buildDialog(): HTMLDialogElement {
  const el = document.getElementById('dialog-save-as') as HTMLDialogElement;
  el.className = 'save-as-dialog';

  const title = document.createElement('h3');
  title.textContent = 'Save As';
  el.appendChild(title);

  const typeGroup = document.createElement('fieldset');
  typeGroup.className = 'settings-group';
  const typeLegend = document.createElement('legend');
  typeLegend.textContent = 'File type';
  typeGroup.appendChild(typeLegend);

  const csvLabel = document.createElement('label');
  csvRadio = document.createElement('input');
  csvRadio.type = 'radio';
  csvRadio.name = 'save-as-type';
  csvRadio.value = 'csv';
  csvRadio.addEventListener('change', () => {
    if (csvRadio.checked) syncDelimiterVisibility();
  });
  csvLabel.append(csvRadio, ' CSV / delimited text');
  typeGroup.appendChild(csvLabel);

  const jsonLabel = document.createElement('label');
  jsonRadio = document.createElement('input');
  jsonRadio.type = 'radio';
  jsonRadio.name = 'save-as-type';
  jsonRadio.value = 'json';
  jsonRadio.addEventListener('change', () => {
    if (jsonRadio.checked) syncDelimiterVisibility();
  });
  jsonLabel.append(jsonRadio, ' JSON');
  typeGroup.appendChild(jsonLabel);

  el.appendChild(typeGroup);

  delimiterGroup = document.createElement('div');
  delimiterGroup.className = 'settings-group';
  const delimLabel = document.createElement('label');
  delimLabel.textContent = 'Delimiter';
  delimiterSelect = document.createElement('select');
  for (const d of CANDIDATE_DELIMITERS) {
    const opt = document.createElement('option');
    opt.value = d;
    opt.textContent = DELIMITER_LABELS[d] ?? d;
    delimiterSelect.appendChild(opt);
  }
  delimLabel.appendChild(delimiterSelect);
  delimiterGroup.appendChild(delimLabel);
  el.appendChild(delimiterGroup);

  const actions = document.createElement('div');
  actions.className = 'export-dialog-actions';

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'btn btn-secondary';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.addEventListener('click', () => el.close());
  actions.appendChild(cancelBtn);

  saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.className = 'btn btn-primary';
  saveBtn.textContent = 'Save';
  actions.appendChild(saveBtn);

  el.appendChild(actions);

  // Same "outside the dialog's own content box" backdrop-click-to-close as settings-dialog.ts —
  // native <dialog> only closes on Escape by default.
  el.addEventListener('click', (event) => {
    const rect = el.getBoundingClientRect();
    const inside =
      event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom;
    if (!inside) el.close();
  });

  return el;
}

export function showSaveAsDialog(current: SaveAsChoice, onConfirm: (choice: SaveAsChoice) => void): void {
  if (!dialog) dialog = buildDialog();

  csvRadio.checked = current.fileType === 'csv';
  jsonRadio.checked = current.fileType === 'json';
  delimiterSelect.value = current.delimiter || ',';
  syncDelimiterVisibility();

  // Rebound on every call rather than added once — avoids stacking a new listener (and thus
  // calling a stale onConfirm from a previous invocation) each time the dialog is reopened.
  saveBtn.onclick = () => {
    onConfirm({ fileType: jsonRadio.checked ? 'json' : 'csv', delimiter: delimiterSelect.value });
    dialog?.close();
  };

  if (!dialog.open) dialog.showModal();
}
