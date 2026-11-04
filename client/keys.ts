import type { Store } from "./store";

export interface SwitcherControl {
  /** Open the switcher, or close it when open. `from` gets focus back after a pick. */
  toggle(from: Element | null): void;
}

// ⌘J toggles the switcher; ⌘⌥↑ and ⌘⌥↓ step through Spaces. Paseo binds ⌘[ ⌘] (workspaces)
// and ⌘⇧ with arrows (panes), so neither is used. Listening in the capture phase keeps a
// focused terminal or editor from swallowing the keys first.
export function bindKeys(doc: Document, store: Store, switcher: SwitcherControl) {
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.isComposing || !event.metaKey || event.ctrlKey || event.shiftKey) return;
    const named = event.key && event.key !== "Dead" && event.key !== "Unidentified";
    const isJ = named ? event.key.toLowerCase() === "j" : event.code === "KeyJ";
    if (!event.altKey && isJ) {
      event.preventDefault();
      event.stopPropagation();
      switcher.toggle(doc.activeElement);
    } else if (event.altKey && (event.code === "ArrowUp" || event.code === "ArrowDown")) {
      event.preventDefault();
      event.stopPropagation();
      store.step(event.code === "ArrowUp" ? -1 : 1);
    }
  };
  doc.addEventListener("keydown", onKeyDown, true);
  return () => doc.removeEventListener("keydown", onKeyDown, true);
}
