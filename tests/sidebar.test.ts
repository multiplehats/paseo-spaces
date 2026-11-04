import assert from "node:assert/strict";
import test from "node:test";
import { parseHTML } from "linkedom";
import { mountSidebar } from "../client/sidebar";
import { createStore } from "../client/store";
import { fakeHost, fakeSettings, project, settle } from "./helpers";

// Shaped like Paseo's sidebar: the same test IDs, project blocks as role="group".
const page = ({ pinned = "", more = "" } = {}) => `<html><head></head><body><aside>
<div id="nav"><div data-testid="sidebar-sessions">History</div></div>
<div data-testid="sidebar-pinned-section" id="pinned"><div>Pinned</div>${pinned}${more}</div>
<div id="section-header"><div><span>Workspaces</span></div><button data-testid="sidebar-display-preferences-menu"><svg></svg></button></div>
<div data-testid="sidebar-project-workspace-list-scroll">
<div role="group" id="web"><div data-testid="sidebar-project-row-remote:github.com/acme/web">Acme web</div><div>fix-login</div></div>
<div role="group" id="api"><div data-testid="sidebar-project-row-host:srv_mini:/dev/api">API</div></div>
</div></aside><main>Chat</main>
<div role="menu" id="menu"><div data-testid="sidebar-project-menu-open-settings-remote:github.com/acme/web">Open settings</div></div>
</body></html>`;
const pin = (id: string, key: string) =>
  `<div data-testid="sidebar-workspace-row-${key}" id="${id}">${id}</div>`;

const layout = {
  spaces: [
    { id: "s1", name: "Main" },
    { id: "s2", name: "Clients" },
  ],
  assignments: { "remote:github.com/acme/web": "s2" },
};
const mini = fakeHost(
  [project("p1", "remote:github.com/acme/web"), project("p2", "host:srv_mini:/dev/api")],
  [
    { id: "w_team", projectId: "p1" },
    { id: "w_api", projectId: "p2" },
  ],
);

async function setup(html = page(), values: unknown = layout) {
  const { document, window } = parseHTML(html);
  const settings = fakeSettings(values);
  const store = createStore({ rpc: settings.rpc, lookup: () => mini });
  await store.reload();
  let changed = () => {};
  const unmount = mountSidebar(document as unknown as Document, store, {
    observe: (onChange) => {
      changed = onChange;
      return { disconnect() {} };
    },
  });
  await settle();
  const $ = (selector: string) => document.querySelector(selector)!;
  const isHidden = (selector: string) => $(selector).hasAttribute("data-spaces-hidden");
  return { document, window, store, settings, unmount, $, isHidden, rerender: () => changed() };
}

test("Sidebar: other Spaces' project groups are hidden, and switching shows them", async () => {
  const { store, isHidden, unmount } = await setup();
  assert.equal(isHidden("#web"), true);
  assert.equal(isHidden("#api"), false);
  store.select("s2");
  await settle();
  assert.equal(isHidden("#web"), false);
  assert.equal(isHidden("#api"), true);
  unmount();
});

test("Sidebar: rows Paseo re-renders are filtered again", async () => {
  const { $, isHidden, rerender, unmount } = await setup();
  $("#web").removeAttribute("data-spaces-hidden");
  rerender();
  await settle();
  assert.equal(isHidden("#web"), true);
  unmount();
});

test("Sidebar: the heading shows the current Space and comes back when stopped", async () => {
  const { $, store, unmount } = await setup();
  const heading = $("#section-header span");
  assert.equal(heading.textContent, "Main");
  store.select("s2");
  await settle();
  assert.equal(heading.textContent, "Clients");
  unmount();
  assert.equal(heading.textContent, "Workspaces");
});

test("Sidebar: pinned rows follow their project's Space on any host", async () => {
  const html = page({ pinned: pin("team", "srv_mini:w_team") + pin("api", "srv_mini:w_api") });
  const { store, isHidden, unmount } = await setup(html);
  await settle();
  assert.equal(isHidden("#team"), true, "Acme web lives in Clients");
  assert.equal(isHidden("#api"), false);
  assert.equal(isHidden("#pinned"), false);
  store.select("s2");
  await settle();
  assert.equal(isHidden("#team"), false);
  unmount();
});

test("Sidebar: an empty Pinned section hides, unless rows are paged behind Show more", async () => {
  const only = await setup(page({ pinned: pin("team", "srv_mini:w_team") }));
  await settle();
  assert.equal(only.isHidden("#pinned"), true);
  only.store.select("s2");
  await settle();
  assert.equal(only.isHidden("#pinned"), false);
  only.unmount();

  const paged = await setup(
    page({
      pinned: pin("team", "srv_mini:w_team"),
      more: '<div data-testid="sidebar-pinned-show-more">Show more</div>',
    }),
  );
  await settle();
  assert.equal(paged.isHidden("#pinned"), false);
  paged.unmount();
});

test("Sidebar: a pinned row whose project is not known yet stays visible", async () => {
  const { isHidden, unmount } = await setup(page({ pinned: pin("new", "srv_mini:w_brand_new") }));
  await settle();
  assert.equal(isHidden("#new"), false);
  assert.equal(isHidden("#pinned"), false);
  unmount();
});

test("Sidebar: the project menu moves a project and then closes", async () => {
  const { $, store, unmount } = await setup();
  const section = $('#menu [data-spaces-owned="move"]');
  assert.match(section.textContent!, /Move to space/);
  const items = [...section.querySelectorAll('[role="menuitemradio"]')];
  assert.deepEqual(
    items.map((item) => [item.textContent, item.getAttribute("aria-checked")]),
    [
      ["Main", "false"],
      ["✓Clients", "true"],
    ],
  );
  let escaped = 0;
  $("#menu").addEventListener("keydown", (event) => {
    if ((event as KeyboardEvent).key === "Escape") escaped++;
  });
  (items[0] as HTMLElement).click();
  await settle();
  assert.equal(store.getSnapshot().layout.assignments["remote:github.com/acme/web"], "s1");
  assert.equal(escaped, 1, "the host menu is asked to close");
  unmount();
});

test("Sidebar: a failed move keeps the menu open and says why", async () => {
  const { $, settings, unmount } = await setup();
  let escaped = 0;
  $("#menu").addEventListener("keydown", () => escaped++);
  settings.host.offline = true;
  ($('#menu [data-spaces-owned="move"] [role="menuitemradio"]') as HTMLElement).click();
  await settle();
  await settle();
  assert.equal(escaped, 0);
  assert.match($('#menu [role="alert"]').textContent!, /Transport not connected/);
  unmount();
});

test("Sidebar: nothing is hidden while the layout cannot be loaded", async () => {
  const { document } = parseHTML(page());
  const settings = fakeSettings(layout);
  settings.host.offline = true;
  const store = createStore({ rpc: settings.rpc });
  await store.reload();
  const unmount = mountSidebar(document as unknown as Document, store, {
    observe: () => ({ disconnect() {} }),
  });
  await settle();
  assert.equal(document.querySelector("[data-spaces-hidden]"), null);
  assert.equal(document.querySelector("#section-header span")!.textContent, "Workspaces");
  unmount();
});

test("Sidebar: stopping removes everything the plugin added", async () => {
  const { document, unmount } = await setup(page({ pinned: pin("team", "srv_mini:w_team") }));
  await settle();
  unmount();
  assert.equal(document.querySelector("[data-spaces-hidden]"), null);
  assert.equal(document.querySelector("[data-spaces-owned]"), null);
  assert.equal(document.querySelector("#menu")!.textContent, "Open settings");
});

test("Sidebar: a project created in the sidebar shows up in the current Space", async () => {
  const { document } = parseHTML(page());
  const settings = fakeSettings(layout);
  const projects = [
    project("p1", "remote:github.com/acme/web"),
    project("p2", "host:srv_mini:/dev/api"),
  ];
  const store = createStore({
    rpc: settings.rpc,
    lookup: () => fakeHost(projects, []),
    placeNew: () => true,
  });
  await store.reload();
  await store.setHosts(["srv_mini"]);
  store.select("s2");
  let changed = () => {};
  const unmount = mountSidebar(document as unknown as Document, store, {
    observe: (onChange) => {
      changed = onChange;
      return { disconnect() {} };
    },
  });
  await settle();
  assert.equal(settings.host.writes, 0, "the projects already there are left alone");

  projects.push(project("p3", "host:srv_mini:/dev/new"));
  const group = document.createElement("div");
  group.setAttribute("role", "group");
  group.id = "new";
  group.innerHTML = '<div data-testid="sidebar-project-row-host:srv_mini:/dev/new">New</div>';
  document.querySelector('[data-testid="sidebar-project-workspace-list-scroll"]')!.append(group);
  changed();
  for (let i = 0; i < 5; i++) await settle();
  assert.equal(store.getSnapshot().layout.assignments["host:srv_mini:/dev/new"], "s2");
  assert.equal(document.querySelector("#new")!.hasAttribute("data-spaces-hidden"), false);
  assert.equal(document.querySelector("#api")!.hasAttribute("data-spaces-hidden"), true);
  unmount();
});
