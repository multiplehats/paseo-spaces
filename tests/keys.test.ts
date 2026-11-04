import assert from "node:assert/strict";
import test from "node:test";
import { parseHTML } from "linkedom";
import { bindKeys } from "../client/keys";
import { readyStore } from "./helpers";

const layout = {
  spaces: [
    { id: "s1", name: "Main" },
    { id: "s2", name: "Clients" },
    { id: "s3", name: "Infra" },
  ],
};

async function setup() {
  const { document, window } = parseHTML(
    "<html><body><textarea id=composer></textarea><main></main></body></html>",
  );
  const { store } = await readyStore(layout);
  const toggles: (Element | null)[] = [];
  const unbind = bindKeys(document as unknown as Document, store, {
    toggle: (from) => toggles.push(from),
  });
  const press = (key: string, code: string, mods: Partial<KeyboardEvent> = {}) => {
    const event = new window.Event("keydown", { bubbles: true, cancelable: true });
    Object.assign(event, {
      key,
      code,
      metaKey: false,
      altKey: false,
      ctrlKey: false,
      shiftKey: false,
      ...mods,
    });
    document.querySelector("main")!.dispatchEvent(event);
    return event.defaultPrevented;
  };
  return { document, store, toggles, unbind, press };
}

test("Keyboard: ⌘J toggles the switcher and remembers where focus was", async () => {
  const { document, toggles, unbind, press } = await setup();
  const composer = document.querySelector("#composer");
  Object.defineProperty(document, "activeElement", { configurable: true, get: () => composer });
  assert.equal(press("j", "KeyJ", { metaKey: true }), true);
  assert.deepEqual(toggles, [composer]);
  assert.equal(press("Dead", "KeyJ", { metaKey: true }), true, "falls back to the key position");
  unbind();
  assert.equal(press("j", "KeyJ", { metaKey: true }), false, "unbinding removes the listener");
});

test("Keyboard: ⌘⌥↑ and ⌘⌥↓ step through Spaces", async () => {
  const { store, press } = await setup();
  assert.equal(press("ArrowDown", "ArrowDown", { metaKey: true, altKey: true }), true);
  assert.equal(store.getSnapshot().current, "s2");
  press("ArrowDown", "ArrowDown", { metaKey: true, altKey: true });
  press("ArrowDown", "ArrowDown", { metaKey: true, altKey: true });
  assert.equal(store.getSnapshot().current, "s3");
  press("ArrowUp", "ArrowUp", { metaKey: true, altKey: true });
  assert.equal(store.getSnapshot().current, "s2");
});

test("Keyboard: Paseo's own chords and other modifiers pass through", async () => {
  const { store, toggles, press } = await setup();
  assert.equal(press("[", "BracketLeft", { metaKey: true }), false, "⌘[ is Paseo's");
  assert.equal(press("]", "BracketRight", { metaKey: true }), false, "⌘] is Paseo's");
  assert.equal(press("ArrowUp", "ArrowUp", { metaKey: true, altKey: true, shiftKey: true }), false);
  assert.equal(press("ArrowUp", "ArrowUp", { metaKey: true }), false);
  assert.equal(press("j", "KeyJ", { ctrlKey: true }), false);
  assert.equal(press("j", "KeyJ", { metaKey: true, shiftKey: true }), false);
  assert.equal(press("j", "KeyJ", { metaKey: true, isComposing: true }), false);
  assert.equal(press("2", "Digit2"), false, "digits only act inside the open switcher");
  assert.equal(toggles.length, 0);
  assert.equal(store.getSnapshot().current, "s1");
});
