import type { PluginClientContext } from "@getpaseo/plugin/client";
import { getPaseoClient } from "@getpaseo/plugin/client";
import { AppState, Platform } from "react-native";
import { registerCommands } from "./client/commands";
import type { HostApi } from "./client/hosts";
import { bindKeys } from "./client/keys";
import { createManageScreen } from "./client/manage";
import { mountSidebar } from "./client/sidebar";
import { createStore, type Memory, type Store } from "./client/store";
import { createSwitcher } from "./client/switcher";

const web = Platform.OS === "web" && typeof document !== "undefined";
const desktopMac =
  web &&
  typeof navigator !== "undefined" &&
  /Electron\//.test(navigator.userAgent) &&
  /Mac/.test(navigator.userAgent);

// The current Space is per client, so it lives in this client's storage when there is any.
const memory: Memory | undefined =
  typeof localStorage === "undefined"
    ? undefined
    : {
        read: () => {
          try {
            return localStorage.getItem("paseo-spaces:current");
          } catch {
            return null;
          }
        },
        write: (id) => {
          try {
            localStorage.setItem("paseo-spaces:current", id);
          } catch {
            /* Storage full or blocked: the Space is just not remembered. */
          }
        },
      };

// Adding a project opens a folder picker, so the window may not have focus when the project
// appears. It waits, and is placed as soon as the window has focus again.
function placeOnFocus(store: Store) {
  const place = () => {
    if (document.visibilityState === "visible") void store.placeNow();
  };
  window.addEventListener("focus", place);
  document.addEventListener("visibilitychange", place);
  return () => {
    window.removeEventListener("focus", place);
    document.removeEventListener("visibilitychange", place);
  };
}

// Back in the foreground (the phone app reopened, a laptop woken), the host connection may have
// been down: catch up now rather than at the next refresh.
function resumeOnForeground(store: Store) {
  const subscription = AppState.addEventListener("change", (state) => {
    if (state === "active") store.resume();
  });
  return () => subscription.remove();
}

export default function contribute(client: PluginClientContext) {
  const store = createStore({
    rpc: client.rpc.bind(client),
    lookup: (serverId) => getPaseoClient(serverId) as HostApi,
    memory,
    // New projects join the current Space of the window in use. Phones do not hide projects,
    // so their current Space says nothing about where someone is working.
    placeNew: web ? () => document.hasFocus() : undefined,
  });
  const switcher = createSwitcher(store, { keyboard: web, shortcut: desktopMac });
  const cleanups = [
    store.start(),
    client.addSidebarHeaderItem({ id: "switcher", title: "Spaces", Component: switcher.Item }),
    client.addScreen({ id: "manage", title: "Spaces", Component: createManageScreen(store) }),
    registerCommands(client, store),
    web ? mountSidebar(document, store) : () => {},
    desktopMac ? bindKeys(document, store, switcher.control) : () => {},
    web ? placeOnFocus(store) : () => {},
    resumeOnForeground(store),
  ];
  return () => {
    for (const cleanup of cleanups.reverse()) cleanup();
  };
}
