/**
 * Small persistent find bar: built once, shown/hidden via the .hidden utility class like
 * everything else in the app. Overrides the browser's native Ctrl+F (wired in main.ts) because
 * the grid is virtualized — native find can only see rendered (in-viewport) DOM text, so it
 * would silently miss anything off-screen. Ctrl+H (wired in main.ts) opens the same bar with
 * the replace row already expanded; the caret button lets a mouse user reveal it either way.
 *
 * Purely a declarative view: it holds no state of its own (query text, replace-row-open, match
 * position are all per-tab state owned by main.ts) — render(state) is the only way its visible
 * state changes, so main.ts can restore a different tab's find session verbatim on tab switch.
 */

import arrowUpIcon from '../icons/arrow-up.svg?raw';
import chevronDownIcon from '../icons/chevron-down.svg?raw';
import crossIcon from '../icons/cross.svg?raw';
import replaceIcon from '../icons/replace.svg?raw';
import replaceAllIcon from '../icons/replace-all.svg?raw';
import { createIcon } from '../utils/icons.ts';

export interface FindBarOptions {
  onSearch: (query: string) => void;
  onNext: VoidFunction;
  onPrev: VoidFunction;
  onClose: VoidFunction;
  onReplace: (replacement: string) => void;
  onReplaceAll: (replacement: string) => void;
  onReplacementInput: (replacement: string) => void;
  onToggleReplace: VoidFunction;
}

export interface FindBarState {
  open: boolean;
  query: string;
  replacement: string;
  replaceOpen: boolean;
  /** 1-based; 0 when there are no matches. */
  matchCurrent: number;
  matchTotal: number;
}

export interface FindBar {
  render(state: FindBarState): void;
  focusQuery(): void;
  focusReplacement(): void;
}

export function createFindBar(options: FindBarOptions): FindBar {
  const bar = document.createElement('div');
  bar.className = 'find-bar hidden';

  const row = document.createElement('div');
  row.className = 'find-row';

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'find-input';
  input.placeholder = 'Find in sheet';

  const status = document.createElement('span');
  status.className = 'find-status';
  status.textContent = '0 / 0';

  const prevBtn = document.createElement('button');
  prevBtn.className = 'find-btn';
  prevBtn.appendChild(createIcon(arrowUpIcon));
  prevBtn.setAttribute('aria-label', 'Previous match');

  const nextBtn = document.createElement('button');
  nextBtn.className = 'find-btn find-btn-reverse';
  nextBtn.appendChild(createIcon(arrowUpIcon));
  nextBtn.setAttribute('aria-label', 'Next match');

  const toggleBtn = document.createElement('button');
  toggleBtn.className = 'find-btn';
  toggleBtn.appendChild(createIcon(chevronDownIcon));
  toggleBtn.setAttribute('aria-label', 'Toggle replace');

  const closeBtn = document.createElement('button');
  closeBtn.className = 'find-btn';
  closeBtn.appendChild(createIcon(crossIcon));
  closeBtn.setAttribute('aria-label', 'Close find');

  row.append(toggleBtn, input, status, prevBtn, nextBtn, closeBtn);

  const replaceRow = document.createElement('div');
  replaceRow.className = 'find-replace-row hidden';

  // Matches toggleBtn's footprint so replaceInput lines up under the query input, since
  // toggleBtn leads the find row but the replace row has nothing to put in that slot.
  const replaceSpacer = document.createElement('span');
  replaceSpacer.className = 'find-btn-spacer';

  const replaceInput = document.createElement('input');
  replaceInput.type = 'text';
  replaceInput.className = 'find-input';
  replaceInput.placeholder = 'Replace with';

  const replaceBtn = document.createElement('button');
  replaceBtn.className = 'find-btn replace-btn';
  replaceBtn.appendChild(createIcon(replaceIcon));
  replaceBtn.setAttribute('aria-label', 'Replace current match');
  replaceBtn.title = 'Replace';
  replaceBtn.disabled = true;

  const replaceAllBtn = document.createElement('button');
  replaceAllBtn.className = 'find-btn replace-btn';
  replaceAllBtn.appendChild(createIcon(replaceAllIcon));
  replaceAllBtn.setAttribute('aria-label', 'Replace all matches');
  replaceAllBtn.title = 'Replace All';
  replaceAllBtn.disabled = true;

  replaceRow.append(replaceSpacer, replaceInput, replaceBtn, replaceAllBtn);

  bar.append(row, replaceRow);
  document.body.appendChild(bar);

  input.addEventListener('input', () => options.onSearch(input.value));
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      if (event.shiftKey) options.onPrev();
      else options.onNext();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      options.onClose();
    }
  });
  prevBtn.addEventListener('click', () => options.onPrev());
  nextBtn.addEventListener('click', () => options.onNext());
  toggleBtn.addEventListener('click', () => options.onToggleReplace());
  closeBtn.addEventListener('click', () => options.onClose());

  replaceInput.addEventListener('input', () => options.onReplacementInput(replaceInput.value));
  replaceInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      options.onReplace(replaceInput.value);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      options.onClose();
    }
  });
  replaceBtn.addEventListener('click', () => options.onReplace(replaceInput.value));
  replaceAllBtn.addEventListener('click', () => options.onReplaceAll(replaceInput.value));

  return {
    render(state: FindBarState): void {
      bar.classList.toggle('hidden', !state.open);
      // Guarded so a render() triggered by the user's own keystroke (which already updated the
      // input directly) doesn't stomp on cursor position by reassigning an unchanged value.
      if (input.value !== state.query) input.value = state.query;
      if (replaceInput.value !== state.replacement) replaceInput.value = state.replacement;
      replaceRow.classList.toggle('hidden', !state.replaceOpen);
      toggleBtn.classList.toggle('find-toggle-open', state.replaceOpen);
      status.textContent = `${state.matchCurrent} / ${state.matchTotal}`;
      replaceBtn.disabled = state.matchTotal === 0;
      replaceAllBtn.disabled = state.matchTotal === 0;
    },
    focusQuery(): void {
      input.focus();
      input.select();
    },
    focusReplacement(): void {
      replaceInput.focus();
      replaceInput.select();
    },
  };
}
