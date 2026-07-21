/**
 * Fills the empty <dialog id="dialog-export"> scaffold that's existed since the Phase 1 scaffold
 * — a narrow first slice of it, not the full delimiter/format/live-preview wizard `dialogs.ts`
 * still owes (see STATUS.md): just the one confirmation a JSON save needs when a column no longer
 * matches the type it was imported with (see findTypeMismatchedColumns in core/parser.ts).
 *
 * Same native <dialog> pattern as settings-dialog.ts (built once, content re-synced per call), but
 * unlike settings the resolution here is a single fixed action ("save the listed columns as
 * text") rather than live-editable controls, so this is Cancel/Confirm rather than auto-apply.
 */

let dialog: HTMLDialogElement | null = null;
let columnList: HTMLUListElement;
let confirmBtn: HTMLButtonElement;

function buildDialog(): HTMLDialogElement {
  const el = document.getElementById('dialog-export') as HTMLDialogElement;
  el.className = 'export-dialog';

  const title = document.createElement('h3');
  title.textContent = "Some columns don't match their type";
  el.appendChild(title);

  const body = document.createElement('p');
  body.textContent =
    'These columns contain values that no longer match the type they were imported with, and will be saved as plain text instead:';
  el.appendChild(body);

  columnList = document.createElement('ul');
  columnList.className = 'export-dialog-columns';
  el.appendChild(columnList);

  const actions = document.createElement('div');
  actions.className = 'export-dialog-actions';

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'btn btn-secondary';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.addEventListener('click', () => el.close());
  actions.appendChild(cancelBtn);

  confirmBtn = document.createElement('button');
  confirmBtn.type = 'button';
  confirmBtn.className = 'btn btn-primary';
  confirmBtn.textContent = 'Save as Text';
  actions.appendChild(confirmBtn);

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

export function showExportMismatchDialog(columns: string[], onConfirm: () => void): void {
  if (!dialog) dialog = buildDialog();

  columnList.replaceChildren(
    ...columns.map((name) => {
      const li = document.createElement('li');
      li.textContent = name;
      return li;
    }),
  );

  // Rebound on every call rather than added once — avoids stacking a new listener (and thus
  // calling a stale onConfirm from a previous invocation) each time the dialog is reopened.
  confirmBtn.onclick = () => {
    onConfirm();
    dialog?.close();
  };

  if (!dialog.open) dialog.showModal();
}
