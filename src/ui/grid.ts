import type { DataModel, Selection } from '../types/index.ts';

// Mirrors the --row-height / --header-height / --gutter-width tokens in style.css.
const ROW_HEIGHT = 28;
const HEADER_HEIGHT = 32;
const GUTTER_WIDTH = 48;
const COL_WIDTH = 140;
const OVERSCAN = 4;
const DOUBLE_CLICK_MS = 400;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

interface CellPos {
  row: number;
  col: number;
}

export type ContextMenuTarget =
  | { zone: 'row'; row: number; x: number; y: number }
  | { zone: 'col'; col: number; x: number; y: number }
  | { zone: 'cell'; row: number; col: number; x: number; y: number };

export interface GridOptions {
  onCellEdit: (row: number, col: number, value: string) => void;
  onSelectionChange?: (selection: Selection | null) => void;
  onContextMenu?: (target: ContextMenuTarget) => void;
}

export class Grid {
  private container: HTMLElement;
  private options: GridOptions;
  private data: DataModel = { headers: [], rows: [], meta: { filename: '', delimiter: ',' } };

  private root: HTMLDivElement;
  private scrollEl: HTMLDivElement;
  private headerWrap: HTMLDivElement;
  private headerCellsEl: HTMLDivElement;
  private body: HTMLDivElement;
  private gutterWrap: HTMLDivElement;
  private cellsEl: HTMLDivElement;

  private anchor: CellPos | null = null;
  private active: CellPos | null = null;
  private editing: CellPos | null = null;
  private activeInputEl: HTMLInputElement | null = null;
  private dragging = false;
  private rafHandle: number | null = null;
  private lastClickTime = 0;
  private lastClickPos: CellPos | null = null;

  constructor(container: HTMLElement, options: GridOptions) {
    this.container = container;
    this.options = options;

    this.root = document.createElement('div');
    this.root.className = 'grid-root';

    this.scrollEl = document.createElement('div');
    this.scrollEl.className = 'grid-scroll';
    this.scrollEl.tabIndex = 0;

    // Header row + corner are `position: sticky` (nested, for the pinned corner) so the browser's
    // native scroll keeps them pinned — no manual scroll-offset transform needed or wanted.
    this.headerWrap = document.createElement('div');
    this.headerWrap.className = 'grid-header-wrap';
    const corner = document.createElement('div');
    corner.className = 'grid-corner';
    this.headerCellsEl = document.createElement('div');
    this.headerCellsEl.className = 'grid-header-cells';
    this.headerWrap.append(corner, this.headerCellsEl);

    // Body holds the sticky-left gutter and the (plain, natively-scrolling) data cells.
    this.body = document.createElement('div');
    this.body.className = 'grid-body';
    this.gutterWrap = document.createElement('div');
    this.gutterWrap.className = 'grid-gutter-wrap';
    this.cellsEl = document.createElement('div');
    this.cellsEl.className = 'grid-cells';
    this.body.append(this.gutterWrap, this.cellsEl);

    this.scrollEl.append(this.headerWrap, this.body);
    this.root.appendChild(this.scrollEl);
    this.container.appendChild(this.root);

    this.scrollEl.addEventListener('scroll', this.handleScroll, { passive: true });
    this.scrollEl.addEventListener('keydown', this.handleKeyDown);
    this.scrollEl.addEventListener('mousedown', this.handleMouseDown);
    this.scrollEl.addEventListener('contextmenu', this.handleContextMenu);
    // Not a native 'dblclick' listener: handleMouseDown does a synchronous full re-render on
    // every click (replacing the cell's DOM node), and Chromium's native double-click detection
    // requires the *same* node across both clicks — so dblclick silently never fires here.
    // Double-clicks are detected manually in handleMouseDown instead (time + position based).
    // Without a native text selection (user-select: none — see style.css), the browser dispatches
    // copy/paste on document/body rather than the focused element, so it never reaches a listener
    // on scrollEl. Listening at the document level and checking activeElement in the handler is
    // the reliable way to scope this to "the grid is the focused context" (which also correctly
    // excludes the edit <input>, since IT holds activeElement while editing, not scrollEl).
    document.addEventListener('copy', this.handleCopy);
    document.addEventListener('cut', this.handleCut);
    document.addEventListener('paste', this.handlePaste);
  }

  setData(data: DataModel): void {
    this.data = data;
    const maxRow = data.rows.length - 1;
    const maxCol = data.headers.length - 1;
    if (this.active) {
      this.active = { row: clamp(this.active.row, 0, Math.max(0, maxRow)), col: clamp(this.active.col, 0, Math.max(0, maxCol)) };
    }
    if (this.anchor) {
      this.anchor = { row: clamp(this.anchor.row, 0, Math.max(0, maxRow)), col: clamp(this.anchor.col, 0, Math.max(0, maxCol)) };
    }
    if (data.rows.length === 0 || data.headers.length === 0) {
      this.active = null;
      this.anchor = null;
    } else if (!this.active) {
      this.active = { row: 0, col: 0 };
      this.anchor = { row: 0, col: 0 };
    }
    this.updateSizer();
    this.renderNow();
  }

  getSelection(): Selection | null {
    if (!this.anchor || !this.active) return null;
    return {
      startRow: this.anchor.row,
      startCol: this.anchor.col,
      endRow: this.active.row,
      endCol: this.active.col,
    };
  }

  focus(): void {
    this.scrollEl.focus();
  }

  /** Forces a re-render — call after the container becomes visible (e.g. leaving display:none). */
  refresh(): void {
    this.renderNow();
  }

  destroy(): void {
    this.scrollEl.removeEventListener('scroll', this.handleScroll);
    this.scrollEl.removeEventListener('keydown', this.handleKeyDown);
    this.scrollEl.removeEventListener('mousedown', this.handleMouseDown);
    this.scrollEl.removeEventListener('contextmenu', this.handleContextMenu);
    document.removeEventListener('copy', this.handleCopy);
    document.removeEventListener('cut', this.handleCut);
    document.removeEventListener('paste', this.handlePaste);
    this.root.remove();
  }

  /**
   * The header row + body are stacked in normal block flow (header first, fixed height; body
   * second, height = row count * ROW_HEIGHT). Their combined size IS grid-scroll's scrollable
   * range — no separate spacer element needed. Both need the same explicit width so horizontal
   * scroll reveals the same range for header cells and data cells alike.
   */
  private updateSizer(): void {
    const width = GUTTER_WIDTH + this.data.headers.length * COL_WIDTH;
    const height = this.data.rows.length * ROW_HEIGHT;
    this.headerWrap.style.width = `${width}px`;
    this.body.style.width = `${width}px`;
    this.body.style.height = `${height}px`;
  }

  /** Batches rendering to animation frames. Only used for scroll — the one high-frequency path. */
  private scheduleRender(): void {
    if (this.rafHandle !== null) return;
    this.rafHandle = requestAnimationFrame(() => {
      this.rafHandle = null;
      this.render();
    });
  }

  /**
   * Renders immediately and cancels any pending scroll-triggered render. Used for discrete
   * interactions (selection, edit start/commit/cancel, data load) — without the cancel, a stale
   * rAF render queued moments earlier (e.g. by the click that started this edit) can fire after
   * the fact, tear down the now-focused edit `<input>`, and trigger a spurious blur/commit.
   */
  private renderNow(): void {
    if (this.rafHandle !== null) {
      cancelAnimationFrame(this.rafHandle);
      this.rafHandle = null;
    }
    this.render();
  }

  private render(): void {
    const scrollTop = this.scrollEl.scrollTop;
    const scrollLeft = this.scrollEl.scrollLeft;
    const viewportHeight = this.scrollEl.clientHeight;
    const viewportWidth = this.scrollEl.clientWidth;

    const rowCount = this.data.rows.length;
    const colCount = this.data.headers.length;

    // scrollTop/scrollLeft are measured from grid-scroll's content origin, which includes the
    // header/gutter band; row/col positions below are local to body/header-wrap (which already
    // start right after that band), so the header/gutter size has to be subtracted back out here.
    const bodyTop = Math.max(0, scrollTop - HEADER_HEIGHT);
    const bodyLeft = Math.max(0, scrollLeft - GUTTER_WIDTH);

    const firstRow = clamp(Math.floor(bodyTop / ROW_HEIGHT) - OVERSCAN, 0, Math.max(0, rowCount - 1));
    const lastRow = clamp(Math.ceil((bodyTop + viewportHeight) / ROW_HEIGHT) + OVERSCAN, 0, Math.max(0, rowCount - 1));
    const firstCol = clamp(Math.floor(bodyLeft / COL_WIDTH) - OVERSCAN, 0, Math.max(0, colCount - 1));
    const lastCol = clamp(Math.ceil((bodyLeft + viewportWidth) / COL_WIDTH) + OVERSCAN, 0, Math.max(0, colCount - 1));

    this.renderHeader(firstCol, lastCol);
    this.renderGutter(firstRow, lastRow);
    this.renderCells(firstRow, lastRow, firstCol, lastCol);
  }

  private renderHeader(firstCol: number, lastCol: number): void {
    this.headerCellsEl.replaceChildren();
    if (this.data.headers.length === 0) return;
    for (let c = firstCol; c <= lastCol; c++) {
      const cell = document.createElement('div');
      cell.className = 'grid-header-cell';
      cell.style.left = `${GUTTER_WIDTH + c * COL_WIDTH}px`;
      cell.style.width = `${COL_WIDTH}px`;
      cell.dataset.col = String(c);
      cell.textContent = this.data.headers[c] ?? '';
      this.headerCellsEl.appendChild(cell);
    }
  }

  private renderGutter(firstRow: number, lastRow: number): void {
    this.gutterWrap.replaceChildren();
    for (let r = firstRow; r <= lastRow; r++) {
      const cell = document.createElement('div');
      cell.className = 'grid-gutter-cell';
      cell.style.top = `${r * ROW_HEIGHT}px`;
      cell.dataset.row = String(r);
      cell.textContent = String(r + 1);
      this.gutterWrap.appendChild(cell);
    }
  }

  private renderCells(firstRow: number, lastRow: number, firstCol: number, lastCol: number): void {
    this.cellsEl.replaceChildren();
    for (let r = firstRow; r <= lastRow; r++) {
      const row = this.data.rows[r];
      if (!row) continue;
      for (let c = firstCol; c <= lastCol; c++) {
        const cell = document.createElement('div');
        cell.className = 'grid-cell';
        if (this.active && this.active.row === r && this.active.col === c) cell.classList.add('active');
        if (this.isInSelection(r, c)) cell.classList.add('selected');
        cell.style.top = `${r * ROW_HEIGHT}px`;
        cell.style.left = `${GUTTER_WIDTH + c * COL_WIDTH}px`;
        cell.style.width = `${COL_WIDTH}px`;
        cell.dataset.row = String(r);
        cell.dataset.col = String(c);

        if (this.editing && this.editing.row === r && this.editing.col === c) {
          const input = document.createElement('input');
          input.className = 'grid-cell-input';
          input.value = row[c] ?? '';
          input.addEventListener('keydown', this.handleInputKeyDown);
          input.addEventListener('blur', this.handleInputBlur);
          cell.appendChild(input);
          this.activeInputEl = input;
        } else {
          cell.textContent = row[c] ?? '';
        }

        this.cellsEl.appendChild(cell);
      }
    }
  }

  private isInSelection(row: number, col: number): boolean {
    if (!this.anchor || !this.active) return false;
    const minRow = Math.min(this.anchor.row, this.active.row);
    const maxRow = Math.max(this.anchor.row, this.active.row);
    const minCol = Math.min(this.anchor.col, this.active.col);
    const maxCol = Math.max(this.anchor.col, this.active.col);
    return row >= minRow && row <= maxRow && col >= minCol && col <= maxCol;
  }

  private setActive(row: number, col: number, extend: boolean): void {
    const maxRow = this.data.rows.length - 1;
    const maxCol = this.data.headers.length - 1;
    if (maxRow < 0 || maxCol < 0) return;
    const r = clamp(row, 0, maxRow);
    const c = clamp(col, 0, maxCol);
    this.active = { row: r, col: c };
    if (!extend || !this.anchor) this.anchor = { row: r, col: c };
    this.options.onSelectionChange?.(this.getSelection());
    this.scrollActiveIntoView();
    this.renderNow();
  }

  private moveActive(dRow: number, dCol: number, extend: boolean): void {
    if (!this.active) {
      this.setActive(0, 0, false);
      return;
    }
    this.setActive(this.active.row + dRow, this.active.col + dCol, extend);
  }

  private scrollActiveIntoView(): void {
    if (!this.active) return;
    const { row, col } = this.active;
    // Content-space coordinates (i.e. directly comparable to scrollTop/scrollLeft), so the
    // sticky header/gutter band has to be added back in here — see render()'s comment.
    const top = HEADER_HEIGHT + row * ROW_HEIGHT;
    const bottom = top + ROW_HEIGHT;
    const left = GUTTER_WIDTH + col * COL_WIDTH;
    const right = left + COL_WIDTH;

    const viewTop = this.scrollEl.scrollTop + HEADER_HEIGHT;
    const viewBottom = this.scrollEl.scrollTop + this.scrollEl.clientHeight;
    if (top < viewTop) this.scrollEl.scrollTop = top - HEADER_HEIGHT;
    else if (bottom > viewBottom) this.scrollEl.scrollTop = bottom - this.scrollEl.clientHeight;

    const viewLeft = this.scrollEl.scrollLeft + GUTTER_WIDTH;
    const viewRight = this.scrollEl.scrollLeft + this.scrollEl.clientWidth;
    if (left < viewLeft) this.scrollEl.scrollLeft = left - GUTTER_WIDTH;
    else if (right > viewRight) this.scrollEl.scrollLeft = right - this.scrollEl.clientWidth;
  }

  private startEdit(row: number, col: number, seed?: string): void {
    if (row < 0 || row >= this.data.rows.length || col < 0 || col >= this.data.headers.length) return;
    this.commitEdit();
    this.editing = { row, col };
    // Render immediately (not via rAF) so the input exists synchronously below —
    // deferring this raced with fast keystrokes and dropped seeded characters.
    this.renderNow();
    const input = this.activeInputEl;
    if (!input) return;
    if (seed !== undefined) {
      input.value = seed;
      input.focus();
      input.setSelectionRange(seed.length, seed.length);
    } else {
      input.focus();
      input.select();
    }
  }

  private commitEdit(): void {
    if (!this.editing) return;
    const { row, col } = this.editing;
    const input = this.activeInputEl;
    this.editing = null;
    this.activeInputEl = null;
    if (input) this.options.onCellEdit(row, col, input.value);
    this.renderNow();
  }

  private cancelEdit(): void {
    this.editing = null;
    this.activeInputEl = null;
    this.renderNow();
    this.scrollEl.focus();
  }

  private clearSelection(): void {
    if (!this.anchor || !this.active) return;
    const minRow = Math.min(this.anchor.row, this.active.row);
    const maxRow = Math.max(this.anchor.row, this.active.row);
    const minCol = Math.min(this.anchor.col, this.active.col);
    const maxCol = Math.max(this.anchor.col, this.active.col);
    for (let r = minRow; r <= maxRow; r++) {
      for (let c = minCol; c <= maxCol; c++) {
        this.options.onCellEdit(r, c, '');
      }
    }
  }

  private handleScroll = (): void => {
    this.scheduleRender();
  };

  private handleMouseDown = (event: MouseEvent): void => {
    // Right/middle-click: leave selection alone and let the contextmenu handler decide (it
    // preserves an existing multi-cell selection when the click landed inside it — this handler
    // would otherwise collapse it to a single cell before the contextmenu event even fires).
    if (event.button !== 0) return;
    const target = (event.target as HTMLElement).closest<HTMLElement>('.grid-cell');
    if (!target) return;
    // Without this, the browser's default mousedown action blurs the current focus
    // (since the click landed on a non-focusable cell div) right after our own
    // scrollEl.focus() call below runs, silently discarding it.
    event.preventDefault();
    if (this.editing) this.commitEdit();
    const row = Number(target.dataset.row);
    const col = Number(target.dataset.col);

    const now = Date.now();
    const isDoubleClick =
      this.lastClickPos?.row === row && this.lastClickPos?.col === col && now - this.lastClickTime < DOUBLE_CLICK_MS;
    this.lastClickTime = now;
    this.lastClickPos = { row, col };

    this.setActive(row, col, event.shiftKey);
    this.scrollEl.focus();

    if (isDoubleClick) {
      this.startEdit(row, col);
      return;
    }

    this.dragging = true;
    const onMove = (moveEvent: MouseEvent): void => {
      if (!this.dragging) return;
      const el = document.elementFromPoint(moveEvent.clientX, moveEvent.clientY);
      const cellEl = el?.closest<HTMLElement>('.grid-cell');
      if (!cellEl) return;
      this.setActive(Number(cellEl.dataset.row), Number(cellEl.dataset.col), true);
    };
    const onUp = (): void => {
      this.dragging = false;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  private handleContextMenu = (event: MouseEvent): void => {
    const el = event.target as HTMLElement;
    const cell = el.closest<HTMLElement>('.grid-cell');
    const header = el.closest<HTMLElement>('.grid-header-cell');
    const gutter = el.closest<HTMLElement>('.grid-gutter-cell');
    if (!cell && !header && !gutter) return;
    event.preventDefault();

    if (cell) {
      const row = Number(cell.dataset.row);
      const col = Number(cell.dataset.col);
      // Preserve an existing multi-cell selection if the right-click landed inside it (so
      // Cut/Copy/Clear from the menu act on the whole range, matching Ctrl+C's behavior) —
      // only collapse to a single cell when right-clicking outside the current selection.
      if (!this.isInSelection(row, col)) this.setActive(row, col, false);
      this.options.onContextMenu?.({ zone: 'cell', row, col, x: event.clientX, y: event.clientY });
      return;
    }
    if (header) {
      const col = Number(header.dataset.col);
      this.setActive(this.active?.row ?? 0, col, false);
      this.options.onContextMenu?.({ zone: 'col', col, x: event.clientX, y: event.clientY });
      return;
    }
    if (gutter) {
      const row = Number(gutter.dataset.row);
      this.setActive(row, this.active?.col ?? 0, false);
      this.options.onContextMenu?.({ zone: 'row', row, x: event.clientX, y: event.clientY });
    }
  };

  private handleKeyDown = (event: KeyboardEvent): void => {
    // While editing, the input's own keydown listener owns Enter/Tab/Escape and the
    // browser handles everything else natively. Without this guard, those keydown
    // events bubble from the input (a descendant of scrollEl) right back into this
    // handler and get processed a second time at the grid level.
    if (this.editing) return;
    if (!this.active) return;
    const ctrlOrCmd = event.ctrlKey || event.metaKey;

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      this.moveActive(-1, 0, event.shiftKey);
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      this.moveActive(1, 0, event.shiftKey);
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      this.moveActive(0, -1, event.shiftKey);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      this.moveActive(0, 1, event.shiftKey);
    } else if (event.key === 'Tab') {
      event.preventDefault();
      this.moveActive(0, event.shiftKey ? -1 : 1, false);
    } else if (event.key === 'Enter' || event.key === 'F2') {
      event.preventDefault();
      this.startEdit(this.active.row, this.active.col);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      this.anchor = { ...this.active };
      this.options.onSelectionChange?.(this.getSelection());
      this.renderNow();
    } else if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      this.clearSelection();
    } else if (ctrlOrCmd && event.key.toLowerCase() === 'a') {
      event.preventDefault();
      this.anchor = { row: 0, col: 0 };
      this.setActive(this.data.rows.length - 1, this.data.headers.length - 1, true);
    } else if (!ctrlOrCmd && !event.altKey && event.key.length === 1) {
      event.preventDefault();
      this.startEdit(this.active.row, this.active.col, event.key);
    }
  };

  private handleInputKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      this.commitEdit();
      this.moveActive(1, 0, false);
      this.scrollEl.focus();
    } else if (event.key === 'Tab') {
      event.preventDefault();
      event.stopPropagation();
      this.commitEdit();
      this.moveActive(0, event.shiftKey ? -1 : 1, false);
      this.scrollEl.focus();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.cancelEdit();
    }
  };

  private handleInputBlur = (): void => {
    this.commitEdit();
  };

  /**
   * Scoped to the app's own cell selection (TSV, spreadsheet-interop format) rather than relying
   * on the browser's native text selection — with `user-select: none` on the grid (see style.css)
   * there normally isn't one anyway, but this also makes the copied range exactly match what's
   * highlighted regardless of how the selection was made. Guarded on activeElement rather than
   * bubbling through scrollEl: without a native selection, the browser dispatches copy/paste on
   * document/body directly, and that same check doubles as the "not editing" guard, since the
   * edit <input> — not scrollEl — holds activeElement while editing.
   */
  private buildCopyText(): string | null {
    if (!this.anchor || !this.active) return null;
    const minRow = Math.min(this.anchor.row, this.active.row);
    const maxRow = Math.max(this.anchor.row, this.active.row);
    const minCol = Math.min(this.anchor.col, this.active.col);
    const maxCol = Math.max(this.anchor.col, this.active.col);
    const lines: string[] = [];
    for (let r = minRow; r <= maxRow; r++) {
      const row = this.data.rows[r];
      const cells: string[] = [];
      for (let c = minCol; c <= maxCol; c++) {
        cells.push(row?.[c] ?? '');
      }
      lines.push(cells.join('\t'));
    }
    return lines.join('\n');
  }

  private handleCopy = (event: ClipboardEvent): void => {
    if (document.activeElement !== this.scrollEl) return;
    const text = this.buildCopyText();
    if (text === null) return;
    event.clipboardData?.setData('text/plain', text);
    event.preventDefault();
  };

  /** Simplified cut: copies then clears immediately (not Excel's "marked, cleared only on paste"). */
  private handleCut = (event: ClipboardEvent): void => {
    if (document.activeElement !== this.scrollEl) return;
    const text = this.buildCopyText();
    if (text === null) return;
    event.clipboardData?.setData('text/plain', text);
    event.preventDefault();
    this.clearSelection();
  };

  /** Applies TSV/plain text starting at the active cell, clipped to the sheet's current bounds. */
  private applyPastedText(text: string): void {
    if (!this.active || !text) return;
    const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
    const pasted = lines.map((line) => line.split('\t'));
    const { row: startRow, col: startCol } = this.active;
    for (let i = 0; i < pasted.length; i++) {
      const targetRow = startRow + i;
      if (targetRow >= this.data.rows.length) break;
      for (let j = 0; j < pasted[i].length; j++) {
        const targetCol = startCol + j;
        if (targetCol >= this.data.headers.length) break;
        this.options.onCellEdit(targetRow, targetCol, pasted[i][j]);
      }
    }
  }

  private handlePaste = (event: ClipboardEvent): void => {
    if (document.activeElement !== this.scrollEl) return;
    const text = event.clipboardData?.getData('text/plain') ?? '';
    if (!text) return;
    event.preventDefault();
    this.applyPastedText(text);
  };

  /**
   * Pastes text at the active cell from outside a native 'paste' event — e.g. a context-menu
   * "Paste" item reading `navigator.clipboard.readText()`, since `execCommand('paste')` is
   * blocked by Chromium by default and can't be used to simulate the real event instead.
   */
  pasteText(text: string): void {
    this.applyPastedText(text);
  }
}
