import assert from "node:assert/strict";
import test from "node:test";
import { listHostPlacements, listHostProjects, parseWorkspaceKey, viewKeys } from "../client/hosts";
import { fakeHost, project } from "./helpers";

test("Sidebar: pinned rows are keyed serverId:workspaceId", () => {
  assert.deepEqual(parseWorkspaceKey("srv_9fK2dQx7LmPa:ws_1"), {
    serverId: "srv_9fK2dQx7LmPa",
    workspaceId: "ws_1",
  });
  assert.deepEqual(parseWorkspaceKey("srv:ws:with:colons"), {
    serverId: "srv",
    workspaceId: "ws:with:colons",
  });
  for (const bad of ["plain", ":ws", "srv:", ""]) assert.equal(parseWorkspaceKey(bad), null);
});

test("Data: a project's view key is its project key when unique on the host", () => {
  const keys = viewKeys("srv_a", [
    project("p1", "remote:github.com/acme/web"),
    project("p2", "host:srv_a:/dup"),
    project("p3", "host:srv_a:/dup"),
    project("p4", null),
  ]);
  assert.equal(keys.get("p1"), "remote:github.com/acme/web");
  assert.equal(keys.get("p2"), '["srv_a","p2"]');
  assert.equal(keys.get("p3"), '["srv_a","p3"]');
  assert.equal(keys.get("p4"), '["srv_a","p4"]');
});

test("Manage screen: projects carry their custom name when they have one", async () => {
  const host = fakeHost(
    [{ ...project("p1", "remote:github.com/acme/web", "web"), projectCustomName: "Acme web" }],
    [],
  );
  const [entry] = await listHostProjects(host, "srv_a");
  assert.deepEqual(entry, {
    viewKey: "remote:github.com/acme/web",
    name: "Acme web",
    serverId: "srv_a",
    path: "/dev/web",
  });
});

test("Sidebar: placements map every workspace, across pages, to its project's view key", async () => {
  const host = fakeHost(
    [project("p1", "remote:github.com/acme/web"), project("p2", null)],
    [
      { id: "w1", projectId: "p1" },
      { id: "w2", projectId: "p2" },
      { id: "w3", projectId: "p1" },
      { id: "w4", projectId: "missing" },
    ],
    2,
  );
  const placements = await listHostPlacements(host, "srv_a");
  assert.deepEqual(Object.fromEntries(placements), {
    w1: "remote:github.com/acme/web",
    w2: '["srv_a","p2"]',
    w3: "remote:github.com/acme/web",
  });
});

test("Sidebar: a host that repeats a page cursor does not loop forever", async () => {
  const host = fakeHost([project("p1", "k")], []);
  host.workspaces.list = async () => ({
    entries: [{ id: "w1", projectId: "p1" }],
    pageInfo: { hasMore: true, nextCursor: "same" },
  });
  assert.equal((await listHostPlacements(host, "srv_a")).size, 1);
});
