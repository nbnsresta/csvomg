export interface ContextMenuItem {
  label: string;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
}

let activeMenu: HTMLDivElement | null = null;
let activeCleanup: (() => void) | null = null;

function closeActiveMenu(): void {
  activeCleanup?.();
  activeMenu?.remove();
  activeMenu = null;
  activeCleanup = null;
}

/** Shows a small positioned menu at (x, y), clamped to stay within the viewport. */
export function showContextMenu(x: number, y: number, items: ContextMenuItem[]): void {
  closeActiveMenu();

  const menu = document.createElement('div');
  menu.className = 'context-menu';

  for (const item of items) {
    const button = document.createElement('button');
    button.className = 'context-menu-item';
    if (item.danger) button.classList.add('danger');
    if (item.disabled) button.classList.add('disabled');
    button.textContent = item.label;
    button.disabled = !!item.disabled;
    button.addEventListener('click', () => {
      closeActiveMenu();
      item.onSelect();
    });
    menu.appendChild(button);
  }

  document.body.appendChild(menu);

  const rect = menu.getBoundingClientRect();
  const left = Math.min(x, window.innerWidth - rect.width - 4);
  const top = Math.min(y, window.innerHeight - rect.height - 4);
  menu.style.left = `${Math.max(4, left)}px`;
  menu.style.top = `${Math.max(4, top)}px`;

  const handlePointerDown = (event: MouseEvent): void => {
    if (!menu.contains(event.target as Node)) closeActiveMenu();
  };
  const handleKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') closeActiveMenu();
  };
  const handleScroll = (): void => closeActiveMenu();

  // Deferred so the click that opened the menu doesn't also immediately close it.
  const timer = setTimeout(() => {
    document.addEventListener('mousedown', handlePointerDown, true);
    document.addEventListener('keydown', handleKeyDown, true);
    document.addEventListener('scroll', handleScroll, true);
  }, 0);

  activeMenu = menu;
  activeCleanup = () => {
    clearTimeout(timer);
    document.removeEventListener('mousedown', handlePointerDown, true);
    document.removeEventListener('keydown', handleKeyDown, true);
    document.removeEventListener('scroll', handleScroll, true);
  };
}
