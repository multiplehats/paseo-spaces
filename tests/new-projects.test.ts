import assert from "node:assert/strict";
import test from "node:test";
import type { HostApi, HostProjectEntry } from "../client/hosts";
import type { StoreOptions } from "../client/store";
import { fakeHost, project, readyStore, settle, sleep } from "./helpers";

const saved = {
  spaces: [
    { id: "s1", name: "Main" },
    { id: "s2", name: "Clients" },
    { id: "s3", name: "Infra" },
  ],
  assignments: { "remote:github.com/acme/web": "s2" },
};

/** A store on hosts whose project lists the test can add to; the window is in use. */
async function setup(options: Partial<StoreOptions> = {}, values: unknown = saved) {
  const lists: Record<string, HostProjectEntry[]> = {
    srv_a: [project("p1", "remote:github.com/acme/web"), project("p2", "host:srv_a:/dev/api")],
    srv_b: [project("p9", "host:srv_b:/dev/ops")],
  };
  const apis: Record<string, HostApi> = {
    srv_a: fakeHost(lists.srv_a, []),
    srv_b: fakeHost(lists.srv_b, []),
  };
  const ready = await readyStore(values, {
    lookup: (serverId) => apis[serverId],
    placeNew: () => true,
    ...options,
  });
  return { ...ready, lists };
}

test("Data: the projects a host already has stay where they are", async () => {
  const { store, settings } = await setup();
  store.select("s3");
  await store.setHosts(["srv_a"]);
  await store.notice(["remote:github.com/acme/web", "host:srv_a:/dev/api"]);
  assert.equal(settings.host.writes, 0);
  assert.deepEqual(store.getSnapshot().layout.assignments, saved.assignments);
});

test("Data: a project created later joins the current Space", async () => {
  const { store, settings, lists } = await setup();
  await store.setHosts(["srv_a"]);
  store.select("s3");
  lists.srv_a.push(project("p3", "host:srv_a:/dev/new"));
  await store.notice(["host:srv_a:/dev/new"]);
  assert.equal(store.getSnapshot().layout.assignments["host:srv_a:/dev/new"], "s3");
  assert.equal(store.getSnapshot().layout.assignments["host:srv_a:/dev/api"], undefined);
  assert.equal(settings.host.writes, 1);
  await store.notice(["host:srv_a:/dev/new"]);
  assert.equal(settings.host.writes, 1, "a placed project is not placed again");
});

test("Data: a host that comes online later keeps its projects where they are", async () => {
  const { store, settings } = await setup();
  await store.setHosts(["srv_a"]);
  store.select("s2");
  await store.setHosts(["srv_a", "srv_b"]);
  assert.equal(settings.host.writes, 0);
  assert.equal(store.getSnapshot().layout.assignments["host:srv_b:/dev/ops"], undefined);
});

test("Data: a new project that already has a Space keeps it", async () => {
  const values = {
    ...saved,
    assignments: { ...saved.assignments, "remote:github.com/acme/old": "s1" },
  };
  const { store, settings, lists } = await setup({}, values);
  await store.setHosts(["srv_a"]);
  store.select("s3");
  // Removed once and added back: the project key, and so its Space, is remembered.
  lists.srv_a.push(project("p3", "remote:github.com/acme/old"));
  await store.notice(["remote:github.com/acme/old"]);
  await store.setHosts(["srv_a", "srv_b"]);
  assert.equal(store.getSnapshot().layout.assignments["remote:github.com/acme/old"], "s1");
  assert.equal(settings.host.writes, 0);
});

test("Data: a project that shares a project key leaves the older one alone", async () => {
  const { store, lists } = await setup();
  await store.setHosts(["srv_a"]);
  store.select("s3");
  // Both projects now show under [serverId, projectId] keys; only the new one is placed.
  lists.srv_a.push(project("p3", "remote:github.com/acme/web"));
  await store.notice(['["srv_a","p1"]', '["srv_a","p3"]']);
  const { assignments } = store.getSnapshot().layout;
  assert.equal(assignments['["srv_a","p3"]'], "s3");
  assert.equal(assignments['["srv_a","p1"]'], undefined);
});

test("Data: another client placing the project first is not an error", async () => {
  const { store, settings, lists } = await setup();
  await store.setHosts(["srv_a"]);
  store.select("s3");
  lists.srv_a.push(project("p3", "host:srv_a:/dev/new"));
  settings.host.values = {
    ...saved,
    assignments: { ...saved.assignments, "host:srv_a:/dev/new": "s2" },
  };
  settings.host.revision++;
  await store.notice(["host:srv_a:/dev/new"]);
  const snap = store.getSnapshot();
  assert.equal(snap.error, null);
  assert.equal(snap.layout.assignments["host:srv_a:/dev/new"], "s2");
  assert.equal(settings.host.writes, 0);
});

test("Data: new projects wait for the window in use", async () => {
  let focused = false;
  const { store, settings, lists } = await setup({ placeNew: () => focused });
  await store.setHosts(["srv_a"]);
  store.select("s2");
  lists.srv_a.push(project("p3", "host:srv_a:/dev/new"));
  await store.notice(["host:srv_a:/dev/new"]);
  assert.equal(settings.host.writes, 0);
  focused = true;
  const stop = store.start(5);
  try {
    await sleep(40);
    assert.equal(store.getSnapshot().layout.assignments["host:srv_a:/dev/new"], "s2");
  } finally {
    stop();
  }
});

test("Data: a client that does not place new projects never writes", async () => {
  const { store, settings, lists } = await setup({ placeNew: undefined });
  await store.setHosts(["srv_a"]);
  lists.srv_a.push(project("p3", "host:srv_a:/dev/new"));
  await store.notice(["host:srv_a:/dev/new"]);
  assert.equal(settings.host.writes, 0);
});

test("Switcher: a change made while a new project is being placed waits its turn", async () => {
  const { store, settings, lists } = await setup();
  await store.setHosts(["srv_a"]);
  store.select("s3");
  settings.host.writeMs = 20;
  lists.srv_a.push(project("p3", "host:srv_a:/dev/new"));
  const placing = store.notice(["host:srv_a:/dev/new"]);
  await settle();
  assert.equal(await store.rename("s2", "Agency"), true);
  await placing;
  const snap = store.getSnapshot();
  assert.equal(snap.error, null);
  assert.equal(snap.layout.spaces[1].name, "Agency");
  assert.equal(snap.layout.assignments["host:srv_a:/dev/new"], "s3");
  assert.equal(settings.host.writes, 2);
});
