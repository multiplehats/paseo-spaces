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

// A workspace row as Paseo renders it: details at the end of the title row and, while the jump
// modifier is held, a number badge laid over them on the first nine rows of the whole sidebar.
const workspaceRow = (key: string, number?: number) =>
  `<div data-testid="sidebar-workspace-row-${key}" id="${key}"><div class="content">` +
  `<div class="main"><i></i><div class="column"><div class="title"><div>${key}</div>` +
  `<div class="trailing"><div>3</div></div></div><div class="meta"></div></div></div>` +
  (number ? `<div class="theirs"><div class="badge"><div>${number}</div></div></div>` : "") +
  `</div></div>`;
// Main holds ten workspaces, so Paseo numbers nine of them and none of Clients'.
const numbered = (held: boolean) => `<html><head></head><body><aside>
<div data-testid="sidebar-project-workspace-list-scroll">
<div role="group" id="api"><div data-testid="sidebar-project-row-host:srv_mini:/dev/api">API</div>
${Array.from({ length: 10 }, (_, i) => workspaceRow(`a${i + 1}`, held && i < 9 ? i + 1 : undefined)).join("")}</div>
<div role="group" id="web"><div data-testid="sidebar-project-row-remote:github.com/acme/web">Acme web</div>
${workspaceRow("w1")}${workspaceRow("w2")}</div>
</div></aside><main></main></body></html>`;

async function jumping(held = false, values: unknown = layout) {
  const { document, window } = parseHTML(numbered(held));
  // A browser's document says whether the page is visible.
  Object.defineProperty(Object.getPrototypeOf(document), "visibilityState", {
    configurable: true,
    get: () => "visible",
  });
  const store = createStore({ rpc: fakeSettings(values).rpc });
  await store.reload();
  const pressed: string[] = [];
  for (const row of document.querySelectorAll('[data-testid^="sidebar-workspace-row-"]'))
    row.addEventListener("click", () => pressed.push(row.id));
  // Paseo's own listener: there first, standing aside only while the page is not visible.
  let dispatching: Event | undefined;
  const paseo: string[] = [];
  document.addEventListener(
    "keydown",
    (event) => {
      dispatching = event;
      if ((document as unknown as Document).visibilityState === "visible")
        paseo.push((event as KeyboardEvent).code);
    },
    true,
  );
  let changed = () => {};
  const unmount = mountSidebar(document as unknown as Document, store, {
    jump: "meta",
    keyTarget: document as unknown as Document,
    currentEvent: () => dispatching,
    observe: (onChange) => {
      changed = onChange;
      return { disconnect() {} };
    },
  });
  await settle();
  const press = (code: string, mods: Partial<KeyboardEvent> = { metaKey: true }) => {
    const event = new window.Event("keydown", { bubbles: true, cancelable: true });
    Object.assign(event, { code, metaKey: false, altKey: false, ctrlKey: false, shiftKey: false });
    Object.assign(event, mods);
    document.querySelector("main")!.dispatchEvent(event);
    dispatching = undefined;
    return event.defaultPrevented;
  };
  const badges = () =>
    [...document.querySelectorAll('[data-spaces-owned="number"]')].map(
      (badge) => `${badge.closest("[data-testid]")!.id}=${badge.textContent}`,
    );
  return { document, store, pressed, paseo, press, badges, unmount, rerender: () => changed() };
}

test("Sidebar: the jump digits count the workspaces of the current Space", async () => {
  const { store, pressed, paseo, press, unmount } = await jumping();
  store.select("s2");
  await settle();
  assert.equal(press("Digit1"), true);
  assert.equal(press("Digit2"), true);
  assert.deepEqual(pressed, ["w1", "w2"]);
  assert.equal(press("Digit3"), false, "no third workspace here: nothing opens");
  assert.deepEqual(pressed, ["w1", "w2"]);
  assert.deepEqual(paseo, [], "Paseo does not also jump, to the workspaces it numbers 1 to 3");

  press("Digit1", { metaKey: true, shiftKey: true });
  press("Digit1", { altKey: true });
  press("KeyK");
  assert.deepEqual(paseo, ["Digit1", "Digit1", "KeyK"], "other keys stay Paseo's");
  assert.deepEqual(pressed, ["w1", "w2"]);

  unmount();
  press("Digit1");
  assert.deepEqual(paseo.at(-1), "Digit1", "stopped, the digits are Paseo's again");
  assert.deepEqual(pressed, ["w1", "w2"]);
});

test("Sidebar: with nothing hidden the jump digits stay Paseo's", async () => {
  // Every project in one Space: Paseo's numbers are already right.
  const { document, pressed, paseo, press, badges, unmount } = await jumping(true, {});
  assert.equal(press("Digit1"), false);
  assert.deepEqual(pressed, []);
  assert.deepEqual(paseo, ["Digit1"]);
  assert.deepEqual(badges(), []);
  assert.equal(document.querySelector("[data-spaces-covered]"), null);
  unmount();
});

test("Sidebar: number badges count the current Space's rows while Paseo shows its own", async () => {
  const { document, store, badges, rerender, unmount } = await jumping(true);
  // In Main, the tenth workspace has no number, as in Paseo.
  assert.deepEqual(
    badges(),
    Array.from({ length: 9 }, (_, i) => `a${i + 1}=${i + 1}`),
  );
  assert.equal(document.querySelectorAll(".theirs[data-spaces-covered]").length, 9);

  store.select("s2");
  await settle();
  assert.deepEqual(badges(), ["w1=1", "w2=2"], "rows Paseo left unnumbered get numbers");
  assert.equal(
    document.querySelector("#w1 .trailing")!.hasAttribute("data-spaces-covered"),
    true,
    "the details under the badge make way, as under Paseo's",
  );
  assert.equal(
    document.querySelector("#w1 .title > div")!.hasAttribute("data-spaces-covered"),
    false,
  );
  rerender();
  await settle();
  assert.deepEqual(badges(), ["w1=1", "w2=2"], "and are not added twice");

  // The modifier is let go: Paseo takes its badges down, and ours go with them.
  for (const badge of document.querySelectorAll(".theirs")) badge.remove();
  rerender();
  await settle();
  assert.deepEqual(badges(), []);
  assert.equal(document.querySelector("[data-spaces-covered]"), null);

  unmount();
});

test("Sidebar: stopping takes the number badges down and uncovers Paseo's", async () => {
  const { document, badges, unmount } = await jumping(true);
  assert.equal(badges().length, 9);
  unmount();
  assert.deepEqual(badges(), []);
  assert.equal(document.querySelector("[data-spaces-covered]"), null);
  assert.equal(document.querySelectorAll(".theirs").length, 9);
});
