/**
 * A real, blocking modal for re-requesting file-handle permission — replacing an immediate-fire
 * requestPermission() + alert() on failure. The browser's own permission prompt renders as a
 * separate OS-level window, not an in-page modal, and nothing in JS can force it to stay
 * foregrounded; this dialog can't fix that, but it can make our own side of the interaction
 * impossible to miss or background, and gives us a place to explain what's happening and offer a
 * retry without losing context.
 */

export interface ReconnectDialogOptions {
  filename: string;
  /** Performs the permission request + file read. Resolve on success, reject with a descriptive Error to show the retry state. */
  onAttempt: () => Promise<void>;
}

let activeOverlay: HTMLDivElement | null = null;

function closeActiveDialog(): void {
  activeOverlay?.remove();
  activeOverlay = null;
}

export function showReconnectDialog(options: ReconnectDialogOptions): void {
  closeActiveDialog();

  const overlay = document.createElement('div');
  overlay.className = 'reconnect-dialog-overlay';

  const dialog = document.createElement('div');
  dialog.className = 'reconnect-dialog';

  const title = document.createElement('h3');
  title.textContent = `Reconnect to "${options.filename}"?`;
  dialog.appendChild(title);

  const desc = document.createElement('p');
  desc.className = 'reconnect-dialog-desc';
  desc.textContent =
    'This needs permission to read the file again. After clicking Grant Access, check for a system permission prompt — it may open behind this window.';
  dialog.appendChild(desc);

  const actions = document.createElement('div');
  actions.className = 'reconnect-dialog-actions';

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'btn btn-secondary';
  cancelBtn.textContent = 'Cancel';

  const grantBtn = document.createElement('button');
  grantBtn.className = 'btn btn-primary';
  grantBtn.textContent = 'Grant Access';

  actions.append(cancelBtn, grantBtn);
  dialog.appendChild(actions);
  overlay.appendChild(dialog);
  document.body.appendChild(overlay);
  activeOverlay = overlay;

  cancelBtn.addEventListener('click', () => closeActiveDialog());

  function attempt(): void {
    grantBtn.disabled = true;
    cancelBtn.disabled = true;
    desc.classList.remove('reconnect-dialog-error');
    desc.textContent = 'Waiting for permission… check for a system dialog that may have opened behind this window.';

    options
      .onAttempt()
      .then(() => closeActiveDialog())
      .catch((err) => {
        grantBtn.disabled = false;
        cancelBtn.disabled = false;
        grantBtn.textContent = 'Try Again';
        desc.classList.add('reconnect-dialog-error');
        desc.textContent = `Couldn't reconnect: ${err instanceof Error ? err.message : String(err)}`;
      });
  }

  grantBtn.addEventListener('click', attempt);
}
