# csvomg

A free, browser-based CSV & JSON editor. Open, edit, and save files directly on your computer —
no uploads, no accounts, and nothing ever leaves your browser.

## What it does

- Opens and edits **CSV, TSV, and JSON** files, including converting between them on save
- Reads and writes files **directly on your drive** via the browser's File System Access API —
  no upload/download round-trip, no pile of duplicate downloaded copies
- **Fully client-side.** Every parse, edit, and format conversion happens locally; nothing is
  ever transmitted anywhere
- Multiple documents at once, each in its own tab
- Undo/redo, find & replace, sort, fill selections, drag-to-reorder rows/columns
- A zoom slider for the grid, dark/light theme, optional auto-save back to the linked file
- Installable as an offline-capable PWA

## What it's not

- **Not a spreadsheet editor** — no formulas, no cell references, no computed values
- **No formatting** — no fonts, colors, borders, or conditional formatting
- **No automation** — no macros or scripts beyond the built-in editing operations
- **No multi-sheet workbooks** — one flat table per document; multiple documents are separate
  tabs, not sheets within one file

See [`STATUS.md`](./STATUS.md) for the full implementation log, architecture notes, and open
ideas.

## Development

Requires Node.js and npm.

```bash
npm install
npm run dev
```

Opens the dev server (Vite) with hot module reload.

### Scripts

| Command             | Does                                              |
| -------------------- | -------------------------------------------------- |
| `npm run dev`         | Start the dev server                                |
| `npm run build`       | Typecheck + production build to `dist/`             |
| `npm run preview`     | Serve the production build locally                  |
| `npm test`            | Run the test suite once                             |
| `npm run test:watch`  | Run tests in watch mode                             |
| `npm run typecheck`   | `tsc --noEmit`                                       |
| `npm run lint`        | Lint `src/` with oxlint                              |
| `npm run deploy`      | Build and deploy to Cloudflare Pages via Wrangler    |

### Stack

Vite + TypeScript, zero runtime dependencies. `vite-plugin-pwa` for offline/installable support.
No frameworks — the UI is plain DOM construction (see `src/ui/`).

### Project layout

```
src/
  core/   parsing, data model, undo/redo history — no DOM
  io/     file system access, IndexedDB drafts/session/recent-files, settings
  ui/     grid rendering, toolbar, dialogs — all DOM, built with plain createElement
  types/  shared TypeScript types
tests/    vitest unit tests for core/
```

## License

[MIT](./LICENSE)
