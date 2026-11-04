import type { PluginClientContext } from "@getpaseo/plugin/client";
import { getPaseoClient } from "@getpaseo/plugin/client";
import { Platform } from "react-native";
import { registerCommands } from "./client/commands";
import type { HostApi } from "./client/hosts";
import { bindKeys } from "./client/keys";
import { createManageScreen } from "./client/manage";
import { mountSidebar } from "./client/sidebar";
import { createStore, type Memory } from "./client/store";
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

export default function contribute(client: PluginClientContext) {
  const store = createStore({
    rpc: client.rpc.bind(client),
    lookup: (serverId) => getPaseoClient(serverId) as HostApi,
    memory,
  });
  const switcher = createSwitcher(store, { keyboard: web, shortcut: desktopMac });
  const cleanups = [
    store.start(),
    client.addSidebarHeaderItem({ id: "switcher", title: "Spaces", Component: switcher.Item }),
    client.addScreen({ id: "manage", title: "Spaces", Component: createManageScreen(store) }),
    registerCommands(client, store),
    web ? mountSidebar(document, store) : () => {},
    desktopMac ? bindKeys(document, store, switcher.control) : () => {},
  ];
  return () => {
    for (const cleanup of cleanups.reverse()) cleanup();
  };
}
