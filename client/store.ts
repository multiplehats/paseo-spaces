import { settingsRpc } from "@getpaseo/plugin";
import type { PluginClientContext } from "@getpaseo/plugin/client";
import {
  addSpace,
  assign,
  defaultLayout,
  hasSpace,
  type Layout,
  LayoutError,
  LayoutSchema,
  layoutSettings,
  removeSpace,
  renameSpace,
  stepFrom,
} from "../shared/layout";
import { type HostLookup, listHostPlacements } from "./hosts";

export interface Snapshot {
  status: "loading" | "ready" | "error";
  /** The last load or save problem, for the switcher to show; null when all is well. */
  error: string | null;
  saving: boolean;
  layout: Layout;
  /** This client's current Space. */
  current: string;
  /** `serverId:workspaceId` → project view key, for workspaces on tracked hosts. */
  placements: Readonly<Record<string, string>>;
}

/** Where the current Space is remembered between sessions, if anywhere. */
export interface Memory {
  read(): string | null;
  write(id: string): void;
}

export interface StoreOptions {
  rpc: PluginClientContext["rpc"];
  lookup?: HostLookup;
  memory?: Memory;
}

export type Store = ReturnType<typeof createStore>;

export function createStore({ rpc, lookup, memory }: StoreOptions) {
  const contract = settingsRpc(layoutSettings.id);
  const listeners = new Set<() => void>();
  const hosts = new Set<string>();
  let revision: string | null = null;
  let loading: Promise<void> | null = null;
  let stopped = false;
  let snapshot: Snapshot = {
    status: "loading",
    error: null,
    saving: false,
    layout: defaultLayout(),
    current: memory?.read() ?? "s1",
    placements: {},
  };

  function set(patch: Partial<Snapshot>) {
    if (stopped) return;
    const next = { ...snapshot, ...patch };
    // Only a loaded layout can say a remembered Space is gone.
    if (next.status === "ready" && !hasSpace(next.layout, next.current))
      next.current = next.layout.spaces[0].id;
    snapshot = next;
    for (const listener of listeners) listener();
  }

  async function readLayout() {
    try {
      const result = await rpc(contract.read, {});
      if (result.status !== "ready") throw new Error(result.error);
      revision = result.revision;
      set({ status: "ready", error: null, layout: LayoutSchema.parse(result.values) });
    } catch (error) {
      set({
        status: snapshot.status === "ready" ? "ready" : "error",
        error: message(error, "Spaces could not be loaded."),
      });
    }
  }

  /** Reload the layout; a reload already under way is shared, not repeated. */
  function reload() {
    loading ??= readLayout().finally(() => {
      loading = null;
    });
    return loading;
  }

  async function save(change: (layout: Layout) => Layout): Promise<boolean> {
    if (snapshot.status !== "ready" || snapshot.saving || revision === null) return false;
    let values: Layout;
    try {
      values = change(snapshot.layout);
    } catch (error) {
      set({ error: message(error, "That change could not be made.") });
      return false;
    }
    set({ saving: true, error: null });
    try {
      const result = await rpc(contract.write, { revision, values });
      if (result.status === "saved") {
        revision = result.revision;
        set({ saving: false, layout: LayoutSchema.parse(result.values) });
        return true;
      }
      // Reload first: a successful reload clears errors, and this one should stay visible.
      if (result.status === "conflict") await reload();
      set({ saving: false, error: conflictMessage(result) });
      return false;
    } catch (error) {
      set({ saving: false, error: message(error, "Spaces could not be saved.") });
      return false;
    }
  }

  // Each tracked host's placements load on their own. A host that cannot be reached keeps
  // what it had and reports nothing: its pinned rows simply stay visible.
  async function loadPlacements(serverIds: Iterable<string>) {
    if (!lookup) return;
    await Promise.all(
      [...serverIds].map(async (serverId) => {
        let found: Map<string, string>;
        try {
          found = await listHostPlacements(lookup(serverId), serverId);
        } catch {
          return;
        }
        const next: Record<string, string> = {};
        for (const [key, view] of Object.entries(snapshot.placements))
          if (!key.startsWith(`${serverId}:`)) next[key] = view;
        for (const [workspaceId, view] of found) next[`${serverId}:${workspaceId}`] = view;
        set({ placements: next });
      }),
    );
  }

  function select(id: string) {
    if (!hasSpace(snapshot.layout, id) || id === snapshot.current) return;
    memory?.write(id);
    set({ current: id });
  }

  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    reload,
    select,
    step(delta: number) {
      select(stepFrom(snapshot.layout, snapshot.current, delta));
    },
    async create() {
      let created = "";
      const ok = await save((layout) => {
        const result = addSpace(layout);
        created = result.id;
        return result.layout;
      });
      if (ok) select(created);
      return ok;
    },
    rename: (id: string, name: string) => save((layout) => renameSpace(layout, id, name)),
    async remove(id: string) {
      let target = "";
      const ok = await save((layout) => {
        const result = removeSpace(layout, id);
        target = result.target;
        return result.layout;
      });
      if (ok && snapshot.current === id) select(target);
      return ok;
    },
    assign: (viewKey: string, spaceId: string) =>
      save((layout) => assign(layout, viewKey, spaceId)),
    /** Look pinned rows up on these hosts too; new hosts load straight away. */
    track(serverIds: Iterable<string>) {
      const added = [...serverIds].filter((id) => !hosts.has(id));
      for (const id of added) hosts.add(id);
      if (added.length) void loadPlacements(added);
    },
    /** Load now and refresh every `intervalMs`, so changes from other clients arrive. */
    start(intervalMs = 15_000) {
      void reload();
      const timer = setInterval(() => {
        void reload();
        void loadPlacements(hosts);
      }, intervalMs);
      return () => {
        clearInterval(timer);
        stopped = true;
        listeners.clear();
      };
    },
  };
}

function message(error: unknown, fallback: string) {
  if (error instanceof LayoutError) return error.message;
  return error instanceof Error && error.message ? error.message : fallback;
}

function conflictMessage(result: { status: string; error?: string }) {
  return result.status === "conflict"
    ? "Spaces changed somewhere else. They have been reloaded; try again."
    : (result.error ?? "Spaces could not be saved.");
}
