// What this plugin needs from a connected host's Paseo API. The app's client loader hands one
// out per host through getPaseoClient(serverId); tests pass small fakes of the same shape.
export interface HostProjectEntry {
  projectId: string;
  projectKey?: string | null;
  projectDisplayName: string;
  projectCustomName?: string | null;
  projectRootPath: string;
}
export interface HostApi {
  projects: { list(): Promise<{ projects: readonly HostProjectEntry[] }> };
  workspaces: {
    list(options: { page: { limit: number; cursor?: string } }): Promise<{
      entries: readonly { id: string; projectId: string }[];
      pageInfo: { hasMore: boolean; nextCursor?: string | null };
    }>;
  };
}
export type HostLookup = (serverId: string) => HostApi;

export interface HostProject {
  viewKey: string;
  name: string;
  serverId: string;
  path: string;
}

/** Sidebar workspace rows are keyed `serverId:workspaceId`. */
export function parseWorkspaceKey(key: string): { serverId: string; workspaceId: string } | null {
  const colon = key.indexOf(":");
  if (colon <= 0 || colon === key.length - 1) return null;
  return { serverId: key.slice(0, colon), workspaceId: key.slice(colon + 1) };
}

/**
 * The sidebar's view key for each of a host's projects: the project key when no other project
 * on that host shares it, otherwise a [serverId, projectId] pair.
 */
export function viewKeys(serverId: string, projects: readonly HostProjectEntry[]) {
  const seen = new Map<string, number>();
  for (const { projectKey } of projects)
    if (projectKey) seen.set(projectKey, (seen.get(projectKey) ?? 0) + 1);
  return new Map(
    projects.map((p) => [
      p.projectId,
      p.projectKey && seen.get(p.projectKey) === 1
        ? p.projectKey
        : JSON.stringify([serverId, p.projectId]),
    ]),
  );
}

export async function listHostProjects(api: HostApi, serverId: string): Promise<HostProject[]> {
  const { projects } = await api.projects.list();
  const keys = viewKeys(serverId, projects);
  return projects.map((p) => ({
    viewKey: keys.get(p.projectId)!,
    name: p.projectCustomName || p.projectDisplayName,
    serverId,
    path: p.projectRootPath,
  }));
}

/** Workspace id → its project's view key, for every workspace on the host. */
export async function listHostPlacements(api: HostApi, serverId: string) {
  const keys = viewKeys(serverId, (await api.projects.list()).projects);
  const placements = new Map<string, string>();
  const visited = new Set<string>();
  let cursor: string | undefined;
  for (;;) {
    const page = await api.workspaces.list({ page: { limit: 200, ...(cursor && { cursor }) } });
    for (const { id, projectId } of page.entries) {
      const key = keys.get(projectId);
      if (key) placements.set(id, key);
    }
    cursor = page.pageInfo.hasMore ? (page.pageInfo.nextCursor ?? undefined) : undefined;
    if (!cursor || visited.has(cursor)) return placements;
    visited.add(cursor);
  }
}
