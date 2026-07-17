/**
 * Small persistent find bar: built once, shown/hidden via the .hidden utility class like
 * everything else in the app. Overrides the browser's native Ctrl+F (wired in main.ts) because
 * the grid is virtualized — native find can only see rendered (in-viewport) DOM text, so it
 * would silently miss anything off-screen.
 */

export interface FindBarOptions {
  onSearch: (query: string) => void;
  onNext: () => void;
  onPrev: () => void;
  onClose: () => void;
}

export interface FindBar {
  show(): void;
  hide(): void;
  isOpen(): boolean;
  setMatchStatus(current: number, total: number): void;
  focusInput(): void;
}

export function createFindBar(options: FindBarOptions): FindBar {
  const bar = document.createElement('div');
  bar.className = 'find-bar hidden';

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'find-input';
  input.placeholder = 'Find in sheet';

  const status = document.createElement('span');
  status.className = 'find-status';
  status.textContent = '0 / 0';

  const prevBtn = document.createElement('button');
  prevBtn.className = 'find-btn';
  prevBtn.textContent = '↑';
  prevBtn.setAttribute('aria-label', 'Previous match');

  const nextBtn = document.createElement('button');
  nextBtn.className = 'find-btn';
  nextBtn.textContent = '↓';
  nextBtn.setAttribute('aria-label', 'Next match');

  const closeBtn = document.createElement('button');
  closeBtn.className = 'find-btn';
  closeBtn.textContent = '×';
  closeBtn.setAttribute('aria-label', 'Close find');

  bar.append(input, status, prevBtn, nextBtn, closeBtn);
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
  closeBtn.addEventListener('click', () => options.onClose());

  return {
    show(): void {
      bar.classList.remove('hidden');
    },
    hide(): void {
      bar.classList.add('hidden');
    },
    isOpen(): boolean {
      return !bar.classList.contains('hidden');
    },
    setMatchStatus(current: number, total: number): void {
      status.textContent = `${current} / ${total}`;
    },
    focusInput(): void {
      input.focus();
      input.select();
    },
  };
}
