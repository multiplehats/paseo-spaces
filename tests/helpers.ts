import type { HostApi, HostProjectEntry } from "../client/hosts";
import { createStore, type Memory, type StoreOptions } from "../client/store";

export const settle = () => new Promise((resolve) => setImmediate(resolve));
export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Host settings with revision checks, as the daemon keeps them. Writes take `writeMs`. */
export function fakeSettings(initial: unknown = {}) {
  const host = { values: initial, revision: 1, reads: 0, writes: 0, offline: false, writeMs: 0 };
  const rpc = (async (contract: { name: string }, input: { revision: string; values: unknown }) => {
    if (contract.name === "settings.layout.read") host.reads++;
    if (host.offline) throw new Error("Transport not connected");
    if (contract.name === "settings.layout.read")
      return { status: "ready", revision: String(host.revision), values: host.values };
    if (contract.name === "settings.layout.write") {
      if (host.writeMs) await sleep(host.writeMs);
      if (input.revision !== String(host.revision))
        return { status: "conflict", error: "Revision changed" };
      host.writes++;
      host.values = input.values;
      host.revision++;
      return { status: "saved", revision: String(host.revision), values: host.values };
    }
    throw new Error(`Unexpected rpc ${contract.name}`);
  }) as unknown as StoreOptions["rpc"];
  return { host, rpc };
}

export function memoryOf(value: string | null = null): Memory & { value: string | null } {
  const memory = {
    value,
    read: () => memory.value,
    write: (id: string) => {
      memory.value = id;
    },
  };
  return memory;
}

/** A host's project and workspace lists; workspaces come in pages of `pageSize`. */
export function fakeHost(
  projects: HostProjectEntry[],
  workspaces: { id: string; projectId: string }[],
  pageSize = 200,
): HostApi {
  return {
    projects: { list: async () => ({ projects }) },
    workspaces: {
      list: async ({ page }) => {
        const start = Number(page.cursor ?? 0);
        const end = start + Math.min(page.limit, pageSize);
        return {
          entries: workspaces.slice(start, end),
          pageInfo: { hasMore: end < workspaces.length, nextCursor: String(end) },
        };
      },
    },
  };
}

export const project = (
  projectId: string,
  projectKey: string | null,
  name = projectId,
): HostProjectEntry => ({
  projectId,
  projectKey,
  projectDisplayName: name,
  projectRootPath: `/dev/${name}`,
});

export async function readyStore(values: unknown, options: Partial<StoreOptions> = {}) {
  const settings = fakeSettings(values);
  const store = createStore({ rpc: settings.rpc, ...options });
  await store.reload();
  return { store, settings };
}
