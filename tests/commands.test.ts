import assert from "node:assert/strict";
import test from "node:test";
import { registerCommands } from "../client/commands";
import { readyStore } from "./helpers";

type Item = {
  id: string;
  title: string;
  keywords?: readonly string[];
  onSelect(context: unknown): unknown;
};

test("Command center: one entry per Space plus New space and Manage spaces", async () => {
  const { store } = await readyStore({
    spaces: [
      { id: "s1", name: "Main" },
      { id: "s2", name: "Clients" },
    ],
  });
  const items = new Map<string, Item>();
  let registrations = 0;
  const client = {
    addCommandCenterItem(item: Item) {
      registrations++;
      items.set(item.id, item);
      return () => items.delete(item.id);
    },
  } as unknown as Parameters<typeof registerCommands>[0];
  const unregister = registerCommands(client, store);
  assert.deepEqual(
    [...items.values()].map((item) => item.title),
    ["Switch to space: Main", "Switch to space: Clients", "New space", "Manage spaces"],
  );

  await items.get("switch-s2")!.onSelect({});
  assert.equal(store.getSnapshot().current, "s2");

  const opened: unknown[] = [];
  await items
    .get("manage-spaces")!
    .onSelect({ openScreen: (input: unknown) => opened.push(input) });
  assert.deepEqual(opened, [{ screenId: "manage" }]);

  const before = registrations;
  store.select("s1");
  assert.equal(registrations, before, "switching Space does not re-register");

  await items.get("new-space")!.onSelect({});
  assert.ok(items.has("switch-s3"), "a new Space gets its entry");
  assert.equal(store.getSnapshot().current, "s3");

  unregister();
  assert.equal(items.size, 0);
});

test("Command center: phones get no Switch to space entries, since switching hides nothing there", async () => {
  const { store } = await readyStore({
    spaces: [
      { id: "s1", name: "Main" },
      { id: "s2", name: "Clients" },
    ],
  });
  const titles: string[] = [];
  const client = {
    addCommandCenterItem(item: Item) {
      titles.push(item.title);
      return () => {};
    },
  } as unknown as Parameters<typeof registerCommands>[0];
  const unregister = registerCommands(client, store, { switching: false });
  assert.deepEqual(titles, ["New space", "Manage spaces"]);
  unregister();
});
