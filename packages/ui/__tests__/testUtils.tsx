import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";

/**
 * Minimal render harness for the shared components.
 *
 * `@testing-library/react` is hoisted to the repo root where React 18 is
 * installed, while this package renders with React 19; the two element
 * runtimes are incompatible, so the tests mount through `react-dom/client`
 * (this package's own copy) and query the resulting DOM directly.
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

/** Mounted tree plus the handles needed to drive or tear it down. */
export interface Mounted {
  container: HTMLElement;
  rerender: (node: ReactNode) => void;
  unmount: () => void;
}

/** Every tree mounted by {@link render} that has not been unmounted yet. */
const mounted: Mounted[] = [];

/** Mounts `node` into a fresh container appended to `<body>`. */
export function render(node: ReactNode): Mounted {
  const container = document.createElement("div");
  document.body.appendChild(container);

  let root: Root | undefined;
  act(() => {
    root = createRoot(container);
    root.render(node);
  });

  const entry: Mounted = {
    container,
    rerender: (next: ReactNode) =>
      act(() => {
        root!.render(next);
      }),
    unmount: () => {
      act(() => {
        root!.unmount();
      });
      container.remove();
    },
  };
  mounted.push(entry);
  return entry;
}

/**
 * Unmounts every tree this file mounted and empties `<body>`.
 *
 * Roots must be unmounted through React rather than by clearing `innerHTML`:
 * a wiped DOM leaves the tree's event listeners attached, so a later test's
 * keystroke would still reach the previous test's component.
 */
export function cleanupDom(): void {
  while (mounted.length > 0) {
    mounted.pop()!.unmount();
  }
  document.body.innerHTML = "";
}

/** Finds the first element matching `selector`, failing loudly when absent. */
export function query<T extends Element>(container: ParentNode, selector: string): T {
  const el = container.querySelector<T>(selector);
  if (!el) throw new Error(`No element matching ${selector}`);
  return el;
}

/** All elements matching `selector` as an array. */
export function queryAll<T extends Element>(
  container: ParentNode,
  selector: string,
): T[] {
  return Array.from(container.querySelectorAll<T>(selector));
}

/** Dispatches a click and flushes the resulting React update. */
export function click(el: Element): void {
  act(() => {
    (el as HTMLElement).click();
  });
}

/** Dispatches a bubbling `mousedown` — what outside-click handlers listen for. */
export function mouseDown(el: Element): void {
  act(() => {
    el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
  });
}

/** Dispatches a `keydown` on the document, as a real Escape press would. */
export function keyDown(key: string): void {
  act(() => {
    document.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
  });
}

/** Dispatches one of the HTML5 drag events React listens for. */
export function dragEvent(type: "dragstart" | "dragover" | "drop" | "dragend", el: Element): void {
  act(() => {
    el.dispatchEvent(new Event(type, { bubbles: true, cancelable: true }));
  });
}
