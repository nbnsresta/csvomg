/**
 * Native-<dialog> replacements for the browser's own alert()/confirm()/prompt() — those can't be
 * restyled at all (theme, dark/light, layout, nothing), so they visually clash with the rest of
 * the app. One shared <dialog> scaffold (`#dialog-modal` in index.html), rebuilt per call — same
 * built-once/content-resynced-per-call pattern as settings-dialog.ts/export-dialog.ts, except the
 * content itself (message, buttons, optional text field) is driven by the call site instead of
 * being fixed, since alert/confirm/prompt are otherwise structurally identical.
 *
 * Promise-based, matching the ergonomics of what they replace — `if (await showConfirmDialog(...))`
 * reads the same as the `if (confirm(...))` it's replacing, so call sites mostly just gain
 * `async`/`await`, no restructuring. Only one of these is ever open at a time in practice, so a
 * single shared dialog with buttons rebound per call (not stacked — `.onclick =`, same
 * avoid-duplicate-listener pattern export-dialog.ts already uses) is enough; no queueing needed.
 */

let dialog: HTMLDialogElement | null = null;
let messageEl: HTMLParagraphElement;
let inputEl: HTMLInputElement;
let cancelBtn: HTMLButtonElement;
let primaryBtn: HTMLButtonElement;

function buildDialog(): HTMLDialogElement {
  const el = document.getElementById('dialog-modal') as HTMLDialogElement;
  el.className = 'modal-dialog';

  messageEl = document.createElement('p');
  el.appendChild(messageEl);

  inputEl = document.createElement('input');
  inputEl.type = 'text';
  inputEl.className = 'modal-dialog-input hidden';
  el.appendChild(inputEl);

  const actions = document.createElement('div');
  actions.className = 'modal-dialog-actions';

  cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'btn btn-secondary';
  actions.appendChild(cancelBtn);

  primaryBtn = document.createElement('button');
  primaryBtn.type = 'button';
  primaryBtn.className = 'btn btn-primary';
  actions.appendChild(primaryBtn);

  el.appendChild(actions);

  // Same "outside the dialog's own content box" backdrop-click-to-close as settings-dialog.ts —
  // native <dialog> only closes on Escape by default. Both Escape and a backdrop click fire the
  // dialog's native 'close' event either way, which is what each show*Dialog() below resolves on.
  el.addEventListener('click', (event) => {
    const rect = el.getBoundingClientRect();
    const inside =
      event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom;
    if (!inside) el.close();
  });

  return el;
}

export function showAlertDialog(message: string): Promise<void> {
  if (!dialog) dialog = buildDialog();
  messageEl.textContent = message;
  inputEl.classList.add('hidden');
  cancelBtn.classList.add('hidden');
  primaryBtn.textContent = 'OK';
  primaryBtn.className = 'btn btn-primary';

  return new Promise((resolve) => {
    primaryBtn.onclick = () => dialog!.close();
    dialog!.addEventListener('close', () => resolve(), { once: true });
    if (!dialog!.open) dialog!.showModal();
    primaryBtn.focus();
  });
}

export interface ConfirmDialogOptions {
  confirmLabel?: string;
  cancelLabel?: string;
  /** Styles the confirm button as a destructive action (var(--danger)), matching the same
   * red used for "Delete row"/"Delete column" in the context menu (see context-menu.ts). */
  danger?: boolean;
}

export function showConfirmDialog(message: string, options: ConfirmDialogOptions = {}): Promise<boolean> {
  if (!dialog) dialog = buildDialog();
  messageEl.textContent = message;
  inputEl.classList.add('hidden');
  cancelBtn.classList.remove('hidden');
  cancelBtn.textContent = options.cancelLabel ?? 'Cancel';
  primaryBtn.textContent = options.confirmLabel ?? 'Confirm';
  primaryBtn.className = options.danger ? 'btn btn-danger' : 'btn btn-primary';

  return new Promise((resolve) => {
    let confirmed = false;
    cancelBtn.onclick = () => dialog!.close();
    primaryBtn.onclick = () => {
      confirmed = true;
      dialog!.close();
    };
    dialog!.addEventListener('close', () => resolve(confirmed), { once: true });
    if (!dialog!.open) dialog!.showModal();
    primaryBtn.focus();
  });
}

export function showPromptDialog(message: string, initialValue = ''): Promise<string | null> {
  if (!dialog) dialog = buildDialog();
  messageEl.textContent = message;
  inputEl.value = initialValue;
  inputEl.classList.remove('hidden');
  cancelBtn.classList.remove('hidden');
  cancelBtn.textContent = 'Cancel';
  primaryBtn.textContent = 'OK';
  primaryBtn.className = 'btn btn-primary';

  return new Promise((resolve) => {
    let result: string | null = null;
    const submit = () => {
      result = inputEl.value;
      dialog!.close();
    };
    cancelBtn.onclick = () => dialog!.close();
    primaryBtn.onclick = submit;
    inputEl.onkeydown = (e) => {
      if (e.key === 'Enter') submit();
    };
    dialog!.addEventListener('close', () => resolve(result), { once: true });
    if (!dialog!.open) dialog!.showModal();
    inputEl.focus();
    inputEl.select();
  });
}
