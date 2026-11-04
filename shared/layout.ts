import { defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

export const MAX_NAME_LENGTH = 60;

const SpaceSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1).max(MAX_NAME_LENGTH),
});
export type Space = z.infer<typeof SpaceSchema>;

export const LayoutSchema = z
  .object({
    spaces: z
      .array(SpaceSchema)
      .min(1)
      .default(() => [{ id: "s1", name: "Main" }]),
    /** Sidebar project view key → Space id. Unassigned projects belong to the first Space. */
    assignments: z.record(z.string(), z.string()).default(() => ({})),
  })
  .refine(
    (layout) => new Set(layout.spaces.map((space) => space.id)).size === layout.spaces.length,
    "Space ids must be unique",
  );
export type Layout = z.infer<typeof LayoutSchema>;

export const layoutSettings = defineSettings({
  id: "layout",
  scope: "host",
  version: 1,
  schema: LayoutSchema,
});

/** A change the user asked for that the layout cannot take; the message is shown as is. */
export class LayoutError extends Error {}

export const defaultLayout = (): Layout => LayoutSchema.parse({});

export function hasSpace(layout: Layout, id: string) {
  return layout.spaces.some((space) => space.id === id);
}

export function spaceFor(layout: Layout, viewKey: string): string {
  const id = layout.assignments[viewKey];
  return id !== undefined && hasSpace(layout, id) ? id : layout.spaces[0].id;
}

function cleanName(name: string) {
  const trimmed = name.trim();
  if (!trimmed) throw new LayoutError("Enter a name.");
  if (trimmed.length > MAX_NAME_LENGTH)
    throw new LayoutError(`Keep names to ${MAX_NAME_LENGTH} characters.`);
  return trimmed;
}

export function addSpace(layout: Layout, name?: string): { layout: Layout; id: string } {
  const ids = new Set(layout.spaces.map((space) => space.id));
  const names = new Set(layout.spaces.map((space) => space.name));
  let n = 1;
  while (ids.has(`s${n}`)) n++;
  let label = layout.spaces.length + 1;
  while (names.has(`Space ${label}`)) label++;
  const id = `s${n}`;
  const space = { id, name: name === undefined ? `Space ${label}` : cleanName(name) };
  return { layout: { ...layout, spaces: [...layout.spaces, space] }, id };
}

export function renameSpace(layout: Layout, id: string, name: string): Layout {
  if (!hasSpace(layout, id)) throw new LayoutError("That space no longer exists.");
  const clean = cleanName(name);
  return {
    ...layout,
    spaces: layout.spaces.map((space) => (space.id === id ? { ...space, name: clean } : space)),
  };
}

/** Where a removed Space's projects go: the first Space left after removing it. */
export function removalTarget(layout: Layout, id: string): Space {
  if (!hasSpace(layout, id)) throw new LayoutError("That space no longer exists.");
  const remaining = layout.spaces.filter((space) => space.id !== id);
  if (remaining.length === 0) throw new LayoutError("Keep at least one space.");
  return remaining[0];
}

export function removeSpace(layout: Layout, id: string): { layout: Layout; target: string } {
  const target = removalTarget(layout, id).id;
  const assignments: Record<string, string> = {};
  for (const [key, space] of Object.entries(layout.assignments))
    assignments[key] = space === id ? target : space;
  return { layout: { spaces: layout.spaces.filter((s) => s.id !== id), assignments }, target };
}

export function assign(layout: Layout, viewKey: string, spaceId: string): Layout {
  if (!viewKey) throw new LayoutError("That project is no longer in the sidebar.");
  if (!hasSpace(layout, spaceId)) throw new LayoutError("That space no longer exists.");
  return { ...layout, assignments: { ...layout.assignments, [viewKey]: spaceId } };
}

/** The Space `delta` places away from `current`, stopping at either end. */
export function stepFrom(layout: Layout, current: string, delta: number): string {
  const index = Math.max(
    0,
    layout.spaces.findIndex((space) => space.id === current),
  );
  const next = Math.min(layout.spaces.length - 1, Math.max(0, index + delta));
  return layout.spaces[next].id;
}
