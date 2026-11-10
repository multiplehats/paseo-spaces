// Desktop and web sidebar: hides other Spaces' projects and adds the "Move to space" menu
// section. Paseo has no API for these, so they work on the sidebar's own elements, found by
// the test IDs Paseo gives them. Everything added is removed again when the plugin stops.
import { spaceFor } from "../shared/layout";
import { parseWorkspaceKey } from "./hosts";
import type { Snapshot, Store } from "./store";

const HIDDEN = "data-spaces-hidden";
const OWNED = "data-spaces-owned";
const PROJECT_ROW = "sidebar-project-row-";
const WORKSPACE_ROW = "sidebar-workspace-row-";
const MENU_MARKER = "sidebar-project-menu-open-settings-";
const PROJECT_LIST = '[data-testid="sidebar-project-workspace-list-scroll"]';
const PINNED_SECTION = '[data-testid="sidebar-pinned-section"]';
const PINNED_MORE = '[data-testid="sidebar-pinned-show-more"]';
const HEADING_MARKER = '[data-testid="sidebar-display-preferences-menu"]';

const CSS = `
[${HIDDEN}]{display:none!important}
[${OWNED}="move"]{display:flex;flex-direction:column;gap:1px;margin-top:4px;padding:4px 0 2px;border-top:1px solid rgba(128,128,128,.25)}
[${OWNED}="move"]>span{padding:4px 8px 2px 38px;font-size:11px;opacity:.6}
[${OWNED}="move"] button{display:flex;align-items:center;gap:10px;width:100%;padding:6px 8px 6px 14px;border:0;border-radius:6px;background:none;color:inherit;font:inherit;text-align:left;cursor:pointer}
[${OWNED}="move"] button:hover:not(:disabled){background:rgba(128,128,128,.14)}
[${OWNED}="move"] button:disabled{opacity:.5;cursor:default}
[${OWNED}="move"] button>span:first-child{flex:0 0 14px;text-align:center}
[${OWNED}="move"] button>span:last-child{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
[${OWNED}="move"] [role=alert]{padding:2px 8px 2px 38px;font-size:12px;color:#e5484d}
`;

// The address Paseo gives an open workspace.
const WORKSPACE_PATH = /^\/h\/([^/]+)\/workspace\/([^/]+)\/?$/;
/** On a row being unfolded, so another plugin doing the same does not press it closed again. */
const UNFOLDING = "data-paseo-unfolding";
const UNFOLDING_MS = 1_500;
const RENDER_MS = 150;

export interface SidebarOptions {
  /** Calls `onChange` when the sidebar may have re-rendered. Defaults to a MutationObserver. */
  observe?: (onChange: () => void) => { disconnect(): void };
  /** The address the app is showing. Defaults to the window's. */
  path?: () => string;
}

function workspaceAt(path: string) {
  const match = WORKSPACE_PATH.exec(path);
  if (!match) return null;
  try {
    return { serverId: decodeURIComponent(match[1]), workspaceId: decodeURIComponent(match[2]) };
  } catch {
    return null;
  }
}

const keyOf = (element: Element, prefix: string) =>
  (element.getAttribute("data-testid") ?? "").slice(prefix.length);

/** The first element under `root` whose content is only text, outside `skip`. */
function textLeaf(root: Element, skip: Element): Element | null {
  for (const element of root.querySelectorAll("*")) {
    if (skip.contains(element) || element.children.length > 0) continue;
    if (element.textContent?.trim()) return element;
  }
  return null;
}

export function mountSidebar(doc: Document, store: Store, options: SidebarOptions = {}) {
  const style = doc.createElement("style");
  style.setAttribute(OWNED, "style");
  style.textContent = CSS;
  doc.head.appendChild(style);

  const hidden = new Set<Element>();
  const sections = new Set<Element>();
  let heading: { text: Text; original: string } | null = null;
  let failedMove: string | null = null;
  let shown: string | null = null;
  const pathNow = options.path ?? (() => doc.defaultView?.location?.pathname ?? "");
  const placeOf = (path: string) => {
    const workspace = workspaceAt(path);
    return workspace ? `${workspace.serverId}:${workspace.workspaceId}` : path;
  };
  let followed = placeOf(pathNow());
  let scheduled = false;
  let stopped = false;

  function hide(element: Element, hide: boolean) {
    if (hide && !element.hasAttribute(HIDDEN)) {
      element.setAttribute(HIDDEN, "");
      hidden.add(element);
    } else if (!hide && element.hasAttribute(HIDDEN)) {
      element.removeAttribute(HIDDEN);
      hidden.delete(element);
    }
  }
  function revealAll() {
    for (const element of hidden) element.removeAttribute(HIDDEN);
    hidden.clear();
  }

  function filterProjects({ layout, current }: Snapshot) {
    const keys: string[] = [];
    for (const row of doc.querySelectorAll(`[data-testid^="${PROJECT_ROW}"]`)) {
      const key = keyOf(row, PROJECT_ROW);
      keys.push(key);
      const group = row.closest('[role="group"]') ?? row;
      hide(group, spaceFor(layout, key) !== current);
    }
    // A row the store has not heard of may be a project just created, for the current Space.
    void store.notice(keys);
  }

  function filterPinned({ layout, current, placements }: Snapshot) {
    const section = doc.querySelector(PINNED_SECTION);
    if (!section) return;
    const rows = [...section.querySelectorAll(`[data-testid^="${WORKSPACE_ROW}"]`)];
    const hosts = new Set<string>();
    let visible = 0;
    for (const row of rows) {
      const key = keyOf(row, WORKSPACE_ROW);
      const workspace = parseWorkspaceKey(key);
      if (workspace) hosts.add(workspace.serverId);
      const project = placements[key];
      const away = project !== undefined && spaceFor(layout, project) !== current;
      hide(row, away);
      if (!away) visible++;
    }
    store.track(hosts);
    // Rows paged behind "Show more" may belong here, so keep the section while they exist.
    hide(section, rows.length > 0 && visible === 0 && !section.querySelector(PINNED_MORE));
  }

  function showHeading({ layout, current }: Snapshot) {
    const marker = doc.querySelector(HEADING_MARKER);
    if (heading && !heading.text.isConnected) heading = null;
    if (!heading && marker) {
      // The heading is the nearest text beside the display preferences button.
      for (let row = marker.parentElement; row && row !== doc.body; row = row.parentElement) {
        const leaf = textLeaf(row, marker);
        if (leaf?.firstChild?.nodeType === 3) {
          const text = leaf.firstChild as Text;
          heading = { text, original: text.data };
          break;
        }
      }
    }
    const name = layout.spaces.find((space) => space.id === current)?.name;
    if (heading && name && heading.text.data !== name) heading.text.data = name;
  }
  function restoreHeading() {
    if (heading?.text.isConnected) heading.text.data = heading.original;
    heading = null;
  }

  // Paseo's menus close on Escape and hand focus back themselves.
  function closeMenu(menu: Element) {
    const view = doc.defaultView;
    const Event = view?.KeyboardEvent ?? view?.Event;
    if (!Event) return;
    const escape = new Event("keydown", { key: "Escape", bubbles: true, cancelable: true });
    if ((escape as KeyboardEvent).key !== "Escape")
      Object.defineProperty(escape, "key", { value: "Escape" });
    menu.dispatchEvent(escape);
  }

  function decorateMenus({ layout, saving, error }: Snapshot) {
    for (const marker of doc.querySelectorAll(`[data-testid^="${MENU_MARKER}"]`)) {
      const key = keyOf(marker, MENU_MARKER);
      const menu = marker.closest('[role="menu"]') ?? marker.parentElement;
      if (!menu) continue;
      let section = [...menu.children].find((child) => child.getAttribute(OWNED) === "move");
      const problem = failedMove === key ? error : null;
      const stamp = JSON.stringify([key, layout.spaces, spaceFor(layout, key), saving, problem]);
      if (section?.getAttribute("data-stamp") === stamp) continue;
      if (!section) {
        section = doc.createElement("div");
        section.setAttribute(OWNED, "move");
        menu.appendChild(section);
        sections.add(section);
      }
      section.setAttribute("data-stamp", stamp);
      // The menu colours its items inline per theme; borrow its own text style.
      const look = doc.defaultView?.getComputedStyle?.(textLeaf(marker, section) ?? marker);
      if (look)
        Object.assign((section as HTMLElement).style, { color: look.color, font: look.font });
      section.replaceChildren();
      const label = doc.createElement("span");
      label.textContent = "Move to space";
      section.appendChild(label);
      for (const space of layout.spaces) {
        const item = doc.createElement("button");
        item.type = "button";
        item.setAttribute("role", "menuitemradio");
        const checked = spaceFor(layout, key) === space.id;
        item.setAttribute("aria-checked", String(checked));
        item.disabled = saving;
        // Check in the icon column, where Paseo's own menu items put their icons.
        const check = doc.createElement("span");
        check.textContent = checked ? "✓" : "";
        const name = doc.createElement("span");
        name.textContent = space.name;
        item.append(check, name);
        item.addEventListener("click", () => {
          void store.assign(key, space.id).then((ok) => {
            failedMove = ok ? null : key;
            if (ok && menu.isConnected) closeMenu(menu);
            else schedule();
          });
        });
        section.appendChild(item);
      }
      if (problem) {
        const alert = doc.createElement("div");
        alert.setAttribute("role", "alert");
        alert.textContent = problem;
        section.appendChild(alert);
      }
    }
    for (const section of sections) if (!section.isConnected) sections.delete(section);
  }

  // Switching slides the project list in from the side of travel.
  function slide({ layout, current }: Snapshot) {
    const previous = shown;
    shown = current;
    if (previous === null || previous === current) return;
    const list = doc.querySelector(PROJECT_LIST) as HTMLElement | null;
    const reduce = doc.defaultView?.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (!list?.animate || reduce) return;
    const ids = layout.spaces.map((space) => space.id);
    const from = ids.indexOf(current) > ids.indexOf(previous) ? 24 : -24;
    list.animate(
      [
        { transform: `translateX(${from}px)`, opacity: 0 },
        { transform: "translateX(0)", opacity: 1 },
      ],
      { duration: 160, easing: "cubic-bezier(.2,.8,.2,1)" },
    );
  }

  function rowFor(prefix: string, key: string) {
    for (const row of doc.querySelectorAll(`[data-testid^="${prefix}"]`))
      if (keyOf(row, prefix) === key) return row as HTMLElement;
    return null;
  }

  function unfold(project: string, workspaceKey: string) {
    const row = rowFor(PROJECT_ROW, project);
    const group = row?.closest('[role="group"]');
    // A folded project renders no workspace rows, and pressing an open one would fold it.
    if (
      row &&
      group &&
      !rowFor(WORKSPACE_ROW, workspaceKey) &&
      !group.querySelector(`[data-testid^="${WORKSPACE_ROW}"]`) &&
      !row.hasAttribute(UNFOLDING)
    ) {
      row.setAttribute(UNFOLDING, "");
      row.click();
      setTimeout(() => row.removeAttribute(UNFOLDING), UNFOLDING_MS);
    }
    // Once the sidebar has rendered, a long one may need to scroll to the row.
    setTimeout(
      () => rowFor(WORKSPACE_ROW, workspaceKey)?.scrollIntoView?.({ block: "nearest" }),
      RENDER_MS,
    );
  }

  // A workspace opened from outside the sidebar (⌘K, a notification, another plugin) is shown
  // here. Only a change of workspace counts: switching Spaces must not snap back to the open one.
  function follow() {
    const path = pathNow();
    const place = placeOf(path);
    if (place === followed) return;
    followed = place;
    const workspace = workspaceAt(path);
    if (!workspace) return;
    void store.reveal(workspace.serverId, workspace.workspaceId).then((project) => {
      if (project !== null && !stopped) unfold(project, place);
    });
  }

  function apply() {
    scheduled = false;
    if (stopped) return;
    const snapshot = store.getSnapshot();
    if (snapshot.status !== "ready") {
      revealAll();
      restoreHeading();
      return;
    }
    filterProjects(snapshot);
    filterPinned(snapshot);
    showHeading(snapshot);
    decorateMenus(snapshot);
    slide(snapshot);
    follow();
  }
  function schedule() {
    if (scheduled || stopped) return;
    scheduled = true;
    queueMicrotask(apply);
  }

  const observer =
    options.observe?.(schedule) ??
    (() => {
      const observer = new MutationObserver(schedule);
      observer.observe(doc.body, { childList: true, subtree: true, characterData: true });
      return observer;
    })();
  const unsubscribe = store.subscribe(schedule);
  apply();

  return () => {
    stopped = true;
    observer.disconnect();
    unsubscribe();
    revealAll();
    restoreHeading();
    for (const section of sections) section.remove();
    sections.clear();
    style.remove();
  };
}
