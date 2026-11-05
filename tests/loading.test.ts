import assert from "node:assert/strict";
import test from "node:test";
import { createStore } from "../client/store";
import { fakeSettings, readyStore, sleep } from "./helpers";

const saved = {
  spaces: [
    { id: "s1", name: "Main" },
    { id: "s2", name: "Clients" },
  ],
  assignments: {},
};

test("Data: a first load that fails is tried again quickly, with no error meanwhile", async () => {
  const settings = fakeSettings(saved);
  settings.host.offline = true;
  const store = createStore({ rpc: settings.rpc, retryDelays: [5, 5, 5, 5] });
  const stop = store.start(60_000);
  try {
    await sleep(8);
    assert.equal(store.getSnapshot().status, "loading");
    assert.equal(store.getSnapshot().error, null, "a host still connecting is not an error yet");
    settings.host.offline = false;
    await sleep(30);
    const snap = store.getSnapshot();
    assert.equal(snap.status, "ready");
    assert.equal(snap.error, null);
    assert.equal(snap.layout.spaces[1].name, "Clients");
  } finally {
    stop();
  }
});

test("Data: a first load that keeps failing says why, and Try again starts over", async () => {
  const settings = fakeSettings(saved);
  settings.host.offline = true;
  const store = createStore({ rpc: settings.rpc, retryDelays: [1, 1] });
  const stop = store.start(60_000);
  try {
    await sleep(20);
    assert.equal(settings.host.reads, 3, "the first attempt and one per delay");
    assert.equal(store.getSnapshot().status, "error");
    assert.match(store.getSnapshot().error ?? "", /Transport not connected/);
    settings.host.offline = false;
    store.retry();
    assert.equal(store.getSnapshot().status, "loading");
    assert.equal(store.getSnapshot().error, null);
    await sleep(5);
    assert.equal(store.getSnapshot().status, "ready");
  } finally {
    stop();
  }
});

test("Data: a refresh that fails keeps the Spaces and shows nothing", async () => {
  const { store, settings } = await readyStore(saved);
  settings.host.offline = true;
  const stop = store.start(5);
  try {
    await sleep(25);
    assert.ok(settings.host.reads > 2, "refreshes kept trying");
    const snap = store.getSnapshot();
    assert.equal(snap.status, "ready");
    assert.equal(snap.error, null);
    assert.equal(snap.layout.spaces[1].name, "Clients");
  } finally {
    stop();
  }
});

test("Data: a change that cannot be saved still says why", async () => {
  const { store, settings } = await readyStore(saved);
  settings.host.offline = true;
  assert.equal(await store.rename("s2", "Agency"), false);
  assert.match(store.getSnapshot().error ?? "", /Transport not connected/);
});

test("Data: coming back to the app catches up, or starts loading again", async () => {
  const { store, settings } = await readyStore(saved);
  settings.host.values = { ...saved, spaces: [...saved.spaces, { id: "s3", name: "Infra" }] };
  store.resume();
  await sleep(1);
  assert.equal(store.getSnapshot().layout.spaces.length, 3);

  const offline = fakeSettings(saved);
  offline.host.offline = true;
  const failed = createStore({ rpc: offline.rpc, retryDelays: [] });
  const stop = failed.start(60_000);
  try {
    await sleep(2);
    assert.equal(failed.getSnapshot().status, "error");
    offline.host.offline = false;
    failed.resume();
    await sleep(2);
    assert.equal(failed.getSnapshot().status, "ready");
  } finally {
    stop();
  }
});

test("Data: stopping cancels a retry that is waiting", async () => {
  const settings = fakeSettings(saved);
  settings.host.offline = true;
  const store = createStore({ rpc: settings.rpc, retryDelays: [20] });
  const stop = store.start(60_000);
  await sleep(2);
  stop();
  await sleep(40);
  assert.equal(settings.host.reads, 1);
});
