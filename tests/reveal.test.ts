import assert from "node:assert/strict";
import test from "node:test";
import { parseHTML } from "linkedom";
import { mountSidebar } from "../client/sidebar";
import { createStore } from "../client/store";
import { fakeHost, fakeSettings, project, readyStore, settle } from "./helpers";

const layout = {
  spaces: [
    { id: "s1", name: "Clients" },
    { id: "s2", name: "Internal" },
  ],
  assignments: { internal: "s2" },
};
const host = () =>
  fakeHost(
    [project("p1", "client"), project("p2", "internal")],
    [
      { id: "w1", projectId: "p1" },
      { id: "w2", projectId: "p2" },
    ],
  );

// The first listing is what tells an old project from one just created.
async function listedStore(options = {}) {
  const made = await readyStore(layout, { lookup: host, placeNew: () => false, ...options });
  await made.store.setHosts(["srv"]);
  return made;
}

test("reveal switches to the Space holding the workspace's project, and names it", async () => {
  const { store } = await listedStore();
  assert.equal(await store.reveal("srv", "w2"), "internal");
  assert.equal(store.getSnapshot().current, "s2");
});

test("reveal goes back to the first Space for a project with no Space of its own", async () => {
  const { store } = await listedStore();
  store.select("s2");
  await store.reveal("srv", "w1");
  assert.equal(store.getSnapshot().current, "s1");
});

test("a project just created stays where the person is, to be placed there", async () => {
  const { store } = await readyStore(layout, { lookup: host });
  store.select("s2");
  assert.equal(await store.reveal("srv", "w1"), "client");
  assert.equal(store.getSnapshot().current, "s2");
});

test("reveal leaves the Space alone for a workspace it cannot find", async () => {
  const { store } = await listedStore();
  store.select("s2");
  assert.equal(await store.reveal("srv", "nope"), null);
  assert.equal(store.getSnapshot().current, "s2");
});

test("reveal changes nothing when the host cannot be reached", async () => {
  const lookup = () => {
    throw new Error("offline");
  };
  const { store } = await readyStore(layout, { lookup });
  store.select("s2");
  assert.equal(await store.reveal("srv", "w1"), null);
  assert.equal(store.getSnapshot().current, "s2");
});

const workspaceRow = '<div data-testid="sidebar-workspace-row-srv:w2"></div>';
const page = (unfolded: boolean) => `<html><head></head><body>
<div role="group" id="client"><div data-testid="sidebar-project-row-client"></div></div>
<div role="group" id="internal"><div data-testid="sidebar-project-row-internal" id="row"></div>
${unfolded ? workspaceRow : ""}</div></body></html>`;

async function mounted(unfolded = false, startAt = "/h/srv/workspace/w1") {
  const { document } = parseHTML(page(unfolded));
  const settings = fakeSettings(layout);
  const store = createStore({ rpc: settings.rpc, lookup: host, placeNew: () => false });
  await store.reload();
  await store.setHosts(["srv"]);
  let changed = () => {};
  let path = startAt;
  const unmount = mountSidebar(document as unknown as Document, store, {
    observe: (onChange) => {
      changed = onChange;
      return { disconnect() {} };
    },
    path: () => path,
  });
  let presses = 0;
  document.querySelector("#row")!.addEventListener("click", () => presses++);
  return {
    store,
    unmount,
    presses: () => presses,
    async go(next: string) {
      path = next;
      changed();
      for (let i = 0; i < 6; i++) await settle();
    },
  };
}

test("opening a workspace elsewhere switches Space and unfolds its project", async () => {
  const { store, go, presses, unmount } = await mounted();
  await go("/h/srv/workspace/w2");
  assert.equal(store.getSnapshot().current, "s2");
  assert.equal(presses(), 1);
  unmount();
});

test("a project that is already open is not pressed closed", async () => {
  const { store, go, presses, unmount } = await mounted(true);
  await go("/h/srv/workspace/w2");
  assert.equal(store.getSnapshot().current, "s2");
  assert.equal(presses(), 0);
  unmount();
});

test("switching Spaces by hand does not snap back to the open workspace", async () => {
  const { store, go, unmount } = await mounted(false, "/h/srv/workspace/w2");
  store.select("s1");
  await go("/h/srv/workspace/w2");
  assert.equal(store.getSnapshot().current, "s1");
  unmount();
});

test("the workspace open when the plugin starts does not change the Space", async () => {
  const { store, go, unmount } = await mounted(false, "/h/srv/workspace/w2");
  await go("/h/srv/workspace/w2");
  assert.equal(store.getSnapshot().current, "s1");
  unmount();
});

test("coming back to a workspace from another screen follows it again", async () => {
  const { store, go, unmount } = await mounted(false, "/h/srv/workspace/w2");
  store.select("s1");
  await go("/h/srv/plugin/needs-you/surface/list");
  assert.equal(store.getSnapshot().current, "s1");
  await go("/h/srv/workspace/w2");
  assert.equal(store.getSnapshot().current, "s2");
  unmount();
});

test("addresses that are not a workspace are ignored", async () => {
  const { store, go, presses, unmount } = await mounted();
  await go("/settings");
  await go("/h/srv/workspace");
  assert.equal(store.getSnapshot().current, "s1");
  assert.equal(presses(), 0);
  unmount();
});
