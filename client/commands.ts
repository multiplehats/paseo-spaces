import type { PluginClientContext } from "@getpaseo/plugin/client";
import type { Store } from "./store";

export interface CommandOptions {
  /** Offer "Switch to space" entries; off where switching cannot hide anything (phones). */
  switching?: boolean;
}

// ⌘K entries: switch to each Space, create one, or open the manage screen. Re-registered only
// when the Spaces change, not on every refresh.
export function registerCommands(
  client: Pick<PluginClientContext, "addCommandCenterItem">,
  store: Pick<Store, "getSnapshot" | "subscribe" | "select" | "create">,
  { switching = true }: CommandOptions = {},
) {
  let registered: (() => void)[] = [];
  let signature: string | null = null;
  const clear = () => {
    for (const unregister of registered) unregister();
    registered = [];
  };
  function sync() {
    const { status, layout } = store.getSnapshot();
    const next = status === "ready" ? JSON.stringify(layout.spaces) : "";
    if (next === signature) return;
    signature = next;
    clear();
    if (status !== "ready") return;
    if (switching)
      for (const space of layout.spaces)
        registered.push(
          client.addCommandCenterItem({
            id: `switch-${space.id}`,
            title: `Switch to space: ${space.name}`,
            icon: "Layers",
            keywords: ["spaces", "switch", space.name],
            context: "global",
            onSelect: () => store.select(space.id),
          }),
        );
    registered.push(
      client.addCommandCenterItem({
        id: "new-space",
        title: "New space",
        icon: "Plus",
        keywords: ["spaces", "create", "add"],
        context: "global",
        onSelect: async () => {
          await store.create();
        },
      }),
      client.addCommandCenterItem({
        id: "manage-spaces",
        title: "Manage spaces",
        icon: "Settings2",
        keywords: ["spaces", "assign", "projects"],
        context: "global",
        onSelect: ({ openScreen }) => openScreen({ screenId: "manage" }),
      }),
    );
  }
  const unsubscribe = store.subscribe(sync);
  sync();
  return () => {
    unsubscribe();
    clear();
  };
}
