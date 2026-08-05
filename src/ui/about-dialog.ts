/**
 * Fills the empty <dialog id="dialog-about"> scaffold — a plain-language explainer for what makes
 * csvomg different from a typical upload-a-file web tool, plus a quick tour of what it can do.
 * Same native <dialog> pattern as settings-dialog.ts/export-dialog.ts (built once, no state to
 * sync between calls since there's nothing to configure here — just a Close button).
 */

let dialog: HTMLDialogElement | null = null;

function section(heading: string, body: string): HTMLElement {
  const el = document.createElement('div');
  el.className = 'about-dialog-section';
  const h4 = document.createElement('h4');
  h4.textContent = heading;
  const p = document.createElement('p');
  p.textContent = body;
  el.append(h4, p);
  return el;
}

function buildDialog(): HTMLDialogElement {
  const el = document.getElementById('dialog-about') as HTMLDialogElement;
  el.className = 'about-dialog';

  const title = document.createElement('h3');
  title.textContent = 'What makes csvomg different';
  el.appendChild(title);

  el.append(
    section(
      'Direct file access — no uploading, no downloading',
      "csvomg reads and writes files straight from your computer's drive, using a feature modern browsers provide called the File System Access API. There's no uploading your file to a server and no downloading a modified copy afterward — you open the file, edit it, and save right back to that same file, so there's never a pile of duplicate downloaded copies to keep track of.",
    ),
    section(
      "Why you're asked for permission",
      "Browsers require a permission prompt before any website can read or write a file on your drive — every time, for every file. csvomg has no way to skip or pre-approve that; it's a security boundary the browser itself enforces, there specifically to stop a website from touching your files without you knowing. If a prompt shows up, that's the browser protecting you, not the app being clunky.",
    ),
    section(
      'Nothing ever leaves your browser',
      'csvomg is fully client-side. Every parse, edit, and format conversion happens locally, in your browser, on your machine. There is no server storing your data and nothing is ever transmitted anywhere — your file never leaves your computer unless you choose to share it yourself.',
    ),
  );

  const featuresHeading = document.createElement('h4');
  featuresHeading.textContent = 'What you can do';
  el.appendChild(featuresHeading);

  const list = document.createElement('ul');
  list.className = 'about-dialog-features';
  [
    'Open and edit CSV, TSV, and JSON files, including converting between them on save',
    'Work on several files at once, each in its own tab',
    'Undo/redo, find & replace, sort, and fill selections',
    'Drag to reorder rows and columns',
    'Zoom the grid in for readability without shifting the rest of the app around',
    'Optionally auto-save changes straight back to the linked file',
    'Install it like a native app and keep using it offline',
  ].forEach((text) => {
    const li = document.createElement('li');
    li.textContent = text;
    list.appendChild(li);
  });
  el.appendChild(list);

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

export function showAboutDialog(): void {
  if (!dialog) dialog = buildDialog();
  if (dialog.open) return;
  dialog.showModal();
  // The "Got it" button is the dialog's only focusable descendant, so showModal()'s own
  // autofocus step lands there — and since it sits below the fold in this scrollable dialog, the
  // browser scrolls straight to the bottom, hiding the title and opening section. Reset scroll
  // position on the next frame, after that autofocus-driven scroll has already happened.
  requestAnimationFrame(() => {
    dialog!.scrollTop = 0;
  });
}
