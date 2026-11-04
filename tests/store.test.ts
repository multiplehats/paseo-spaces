import assert from "node:assert/strict";
import test from "node:test";
import { createStore } from "../client/store";
import { fakeHost, fakeSettings, memoryOf, project, readyStore, settle } from "./helpers";

const saved = {
  spaces: [
    { id: "s1", name: "Main" },
    { id: "s2", name: "Clients" },
    { id: "s3", name: "Infra" },
  ],
  assignments: { "remote:github.com/acme/web": "s2" },
};

test("Data: an empty host starts with the default layout", async () => {
  const { store } = await readyStore({});
  const snap = store.getSnapshot();
  assert.equal(snap.status, "ready");
  assert.deepEqual(snap.layout.spaces, [{ id: "s1", name: "Main" }]);
  assert.equal(snap.current, "s1");
});

test("Current Space: remembered, kept while loading, and dropped when gone", async () => {
  const settings = fakeSettings(saved);
  const memory = memoryOf("s3");
  const store = createStore({ rpc: settings.rpc, memory });
  assert.equal(store.getSnapshot().current, "s3", "a remembered Space survives the loading phase");
  await store.reload();
  assert.equal(store.getSnapshot().current, "s3");
  store.select("s2");
  assert.equal(memory.value, "s2");
  store.select("nope");
  assert.equal(store.getSnapshot().current, "s2", "unknown Spaces are ignored");

  const gone = createStore({ rpc: fakeSettings(saved).rpc, memory: memoryOf("s7") });
  await gone.reload();
  assert.equal(gone.getSnapshot().current, "s1");
});

test("Current Space: stepping stops at the ends", async () => {
  const { store } = await readyStore(saved);
  store.step(-1);
  assert.equal(store.getSnapshot().current, "s1");
  store.step(1);
  store.step(1);
  store.step(1);
  assert.equal(store.getSnapshot().current, "s3");
});

test("Switcher: New space saves and switches to it", async () => {
  const { store, settings } = await readyStore(saved);
  assert.equal(await store.create(), true);
  const snap = store.getSnapshot();
  assert.equal(snap.current, "s4");
  assert.equal(snap.layout.spaces.at(-1)?.name, "Space 4");
  assert.equal(settings.host.writes, 1);
});

test("Switcher: removing the current Space moves to where its projects went", async () => {
  const { store } = await readyStore(saved);
  store.select("s2");
  assert.equal(await store.remove("s2"), true);
  const snap = store.getSnapshot();
  assert.equal(snap.current, "s1");
  assert.equal(snap.layout.assignments["remote:github.com/acme/web"], "s1");
});

test("Switcher: a refused change shows its message and writes nothing", async () => {
  const { store, settings } = await readyStore({});
  assert.equal(await store.remove("s1"), false);
  assert.equal(store.getSnapshot().error, "Keep at least one space.");
  assert.equal(await store.rename("s1", "  "), false);
  assert.equal(store.getSnapshot().error, "Enter a name.");
  assert.equal(settings.host.writes, 0);
});

test("Switcher: a save that lost a race reloads and asks to try again", async () => {
  const { store, settings } = await readyStore(saved);
  settings.host.values = { ...saved, spaces: [...saved.spaces, { id: "s4", name: "Elsewhere" }] };
  settings.host.revision++;
  assert.equal(await store.rename("s2", "Agency"), false);
  const snap = store.getSnapshot();
  assert.match(snap.error ?? "", /changed somewhere else/);
  assert.equal(snap.layout.spaces.at(-1)?.name, "Elsewhere", "the newer layout is loaded");
  assert.equal(await store.rename("s2", "Agency"), true);
});

test("Sidebar: nothing changes while the layout cannot be loaded", async () => {
  const settings = fakeSettings(saved);
  settings.host.offline = true;
  const store = createStore({ rpc: settings.rpc });
  await store.reload();
  assert.equal(store.getSnapshot().status, "error");
  assert.match(store.getSnapshot().error ?? "", /Transport not connected/);
  assert.equal(await store.assign("k", "s2"), false);
  settings.host.offline = false;
  await store.reload();
  assert.equal(store.getSnapshot().status, "ready");
  assert.equal(store.getSnapshot().error, null);
});

test("Sidebar: tracked hosts load placements; an unreachable host is not an error", async () => {
  const mini = fakeHost(
    [project("p1", "remote:github.com/acme/web")],
    [{ id: "w1", projectId: "p1" }],
  );
  const lookups: string[] = [];
  const { store } = await readyStore(saved, {
    lookup: (serverId) => {
      lookups.push(serverId);
      if (serverId !== "srv_mini") throw new Error(`Paseo host is disconnected: ${serverId}`);
      return mini;
    },
  });
  store.track(["srv_mini", "srv_offline"]);
  await settle();
  assert.deepEqual(store.getSnapshot().placements, {
    "srv_mini:w1": "remote:github.com/acme/web",
  });
  assert.equal(store.getSnapshot().error, null);
  store.track(["srv_mini"]);
  await settle();
  assert.equal(lookups.length, 2, "an already tracked host is not looked up again");
});
