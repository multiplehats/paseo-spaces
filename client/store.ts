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
  spaceFor,
  stepFrom,
} from "../shared/layout";
import { type HostLookup, listHostPlacements, viewKeys } from "./hosts";

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
  /**
   * Whether this client may put new projects in its current Space right now. Leave it out on
   * clients that never should; the client the person is using should answer true.
   */
  placeNew?: () => boolean;
  /**
   * Waits between attempts at loading Spaces before a failure shows. A host reached through
   * another host can take a while to reconnect, so this is about 45 seconds in all.
   */
  retryDelays?: readonly number[];
}

const RETRY_DELAYS = [1_000, 2_000, 4_000, 8_000, 15_000, 15_000];

export type Store = ReturnType<typeof createStore>;

/** A project that turned up on a host after this client first listed it. */
interface Arrival {
  serverId: string;
  projectId: string;
  viewKey: string;
}

export function createStore({
  rpc,
  lookup,
  memory,
  placeNew,
  retryDelays = RETRY_DELAYS,
}: StoreOptions) {
  const contract = settingsRpc(layoutSettings.id);
  const listeners = new Set<() => void>();
  const hosts = new Set<string>();
  // For new projects: the hosts online now, the projects each host had when this client first
  // listed it (by project id, which never changes), every view key listed so far, and the
  // sidebar keys that already prompted a listing.
  let online: string[] = [];
  const known = new Map<string, Set<string>>();
  const listed = new Set<string>();
  const asked = new Set<string>();
  let placing: Promise<void> | null = null;
  let placeAgain = false;
  let writes: Promise<unknown> = Promise.resolve();
  let revision: string | null = null;
  let loading: Promise<string | null> | null = null;
  let connecting = false;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
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

  /** Read the layout once. A read already under way is shared. Resolves to why it failed. */
  function read() {
    loading ??= (async () => {
      try {
        const result = await rpc(contract.read, {});
        if (result.status !== "ready") throw new Error(result.error);
        revision = result.revision;
        set({ status: "ready", error: null, layout: LayoutSchema.parse(result.values) });
        return null;
      } catch (error) {
        return message(error, "Spaces could not be loaded.");
      }
    })().finally(() => {
      loading = null;
    });
    return loading;
  }

  /** Reload, and say why if it fails. */
  async function reload() {
    const problem = await read();
    if (problem) set({ status: snapshot.status === "ready" ? "ready" : "error", error: problem });
  }

  /** Reload in the background. A failure changes nothing: the last layout stays, unremarked. */
  async function refresh() {
    if (!connecting) await read();
  }

  /**
   * Load Spaces, trying again quickly while the host connection comes up, and say it failed
   * only once every attempt has.
   */
  function connect() {
    if (stopped || connecting) return;
    connecting = true;
    if (snapshot.status !== "ready") set({ status: "loading", error: null });
    let attempt = 0;
    const tryOnce = async () => {
      retryTimer = null;
      const problem = await read();
      if (stopped) return;
      if (problem && attempt < retryDelays.length) {
        retryTimer = setTimeout(() => void tryOnce(), retryDelays[attempt++]);
        return;
      }
      connecting = false;
      if (problem && snapshot.status !== "ready") set({ status: "error", error: problem });
    };
    void tryOnce();
  }

  /** Writes go one at a time, so a write made in the background never races the person's. */
  function serial(task: () => Promise<boolean>) {
    const run = writes.then(task, task);
    writes = run.catch(() => {});
    return run;
  }

  /** A change the person asked for: it shows while saving, and says why if it fails. */
  function save(change: (layout: Layout) => Layout): Promise<boolean> {
    if (snapshot.status !== "ready" || snapshot.saving) return Promise.resolve(false);
    set({ saving: true, error: null });
    return serial(async () => {
      let values: Layout;
      try {
        values = change(snapshot.layout);
      } catch (error) {
        set({ saving: false, error: message(error, "That change could not be made.") });
        return false;
      }
      try {
        const result = await rpc(contract.write, { revision: revision ?? "", values });
        if (result.status === "saved") {
          revision = result.revision;
          set({ saving: false, layout: LayoutSchema.parse(result.values) });
          return true;
        }
        // Reload first: a successful reload clears errors, and this one should stay visible.
        if (result.status === "conflict") await read();
        set({ saving: false, error: conflictMessage(result) });
        return false;
      } catch (error) {
        set({ saving: false, error: message(error, "Spaces could not be saved.") });
        return false;
      }
    });
  }

  /**
   * A change made on the person's behalf: nothing shows while it saves or if it fails. A lost
   * race reloads and works the change out again on the newer layout, once.
   */
  function saveQuietly(change: (layout: Layout) => Layout): Promise<boolean> {
    return serial(async () => {
      for (let attempt = 0; attempt < 2; attempt++) {
        if (snapshot.status !== "ready" || revision === null) return false;
        try {
          const values = change(snapshot.layout);
          if (values === snapshot.layout) return true;
          const result = await rpc(contract.write, { revision, values });
          if (result.status === "saved") {
            revision = result.revision;
            set({ layout: LayoutSchema.parse(result.values) });
            return true;
          }
          if (result.status !== "conflict") return false;
        } catch {
          return false;
        }
        await read();
      }
      return false;
    });
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

  // The first time a host is listed, its projects are taken as they are. A project that turns
  // up on it later is new.
  async function arrivals(serverId: string): Promise<Arrival[]> {
    if (!lookup) return [];
    let projects;
    try {
      ({ projects } = await lookup(serverId).projects.list());
    } catch {
      return [];
    }
    const keys = viewKeys(serverId, projects);
    for (const key of keys.values()) listed.add(key);
    const before = known.get(serverId);
    if (!before) {
      known.set(serverId, new Set(projects.map((p) => p.projectId)));
      return [];
    }
    return projects
      .filter((p) => !before.has(p.projectId))
      .map((p) => ({ serverId, projectId: p.projectId, viewKey: keys.get(p.projectId)! }));
  }

  // New projects join the current Space, unless they already have one.
  async function placeArrivals() {
    const found = (await Promise.all(online.map(arrivals))).flat();
    // Until this is the client the person is using, new projects wait for one that is.
    if (found.length === 0 || !placeNew?.()) return;
    const ok = await saveQuietly((layout) => {
      let next = layout;
      for (const { viewKey } of found)
        if (next.assignments[viewKey] === undefined) next = assign(next, viewKey, snapshot.current);
      return next;
    });
    if (ok) for (const { serverId, projectId } of found) known.get(serverId)?.add(projectId);
  }

  /** List the hosts for new projects. Asking during a listing runs one more after it. */
  function place() {
    if (!placeNew || stopped) return Promise.resolve();
    if (placing) {
      placeAgain = true;
      return placing;
    }
    placing = (async () => {
      do {
        placeAgain = false;
        await placeArrivals();
      } while (placeAgain && !stopped);
    })().finally(() => {
      placing = null;
    });
    return placing;
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
    /** Try loading Spaces again, quickly at first, as when they first load. */
    retry: connect,
    /** The app is in use again: catch up now, or start loading again if Spaces never loaded. */
    resume() {
      if (snapshot.status === "ready") void refresh();
      else connect();
    },
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
    /**
     * Show the Space this workspace's project is in, and say which project that is. An unknown
     * workspace changes nothing. A project no listing has seen was only just created, so it is
     * left to be placed, which puts it in the current Space.
     */
    async reveal(serverId: string, workspaceId: string): Promise<string | null> {
      const key = `${serverId}:${workspaceId}`;
      if (snapshot.placements[key] === undefined) {
        hosts.add(serverId);
        await loadPlacements([serverId]);
      }
      const project = snapshot.placements[key];
      if (project === undefined || snapshot.status !== "ready") return null;
      if (snapshot.layout.assignments[project] !== undefined || listed.has(project))
        select(spaceFor(snapshot.layout, project));
      return project;
    },
    /** The hosts online now. One not listed before is listed straight away. */
    setHosts(serverIds: Iterable<string>) {
      online = [...new Set(serverIds)];
      if (online.some((id) => !known.has(id))) return place();
      return Promise.resolve();
    },
    /** List the hosts for new projects now, say when this window gets focus back. */
    placeNow: place,
    /**
     * The sidebar shows these project view keys. One with no Space that no listing has
     * returned yet may be a project just created, so the hosts are listed again now.
     */
    notice(keys: Iterable<string>) {
      if (!placeNew || snapshot.status !== "ready") return Promise.resolve();
      let fresh = false;
      for (const key of keys) {
        if (snapshot.layout.assignments[key] !== undefined || listed.has(key) || asked.has(key))
          continue;
        asked.add(key);
        fresh = true;
      }
      return fresh ? place() : Promise.resolve();
    },
    /** Load now and refresh every `intervalMs`, so changes from other clients arrive. */
    start(intervalMs = 15_000) {
      if (snapshot.status === "ready") void refresh();
      else connect();
      const timer = setInterval(() => {
        void refresh();
        void loadPlacements(hosts);
        void place();
      }, intervalMs);
      return () => {
        clearInterval(timer);
        if (retryTimer) clearTimeout(retryTimer);
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
