const parser = new DOMParser();

/**
 * Turns a bundled SVG file's raw markup (import via the `?raw` suffix, e.g.
 * `import icon from '../icons/replace.svg?raw'`) into a live, appendable element.
 * Call once per usage site — DOM nodes can't be attached under two parents at once, so a shared
 * icon needs its own createIcon() call at each place it's used, not one node reused everywhere.
 */
export function createIcon(svgMarkup: string): SVGSVGElement {
  return parser.parseFromString(svgMarkup, 'image/svg+xml').documentElement as unknown as SVGSVGElement;
}
