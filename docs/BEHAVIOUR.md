# Spaces: behaviour

What the plugin does, written before the code and kept in step with it. Tests cite these
sections.

## Data

- A **layout** is stored once per host, in host settings `layout` (version 1):
  `{ spaces: [{ id, name }], assignments: { [projectViewKey]: spaceId } }`.
- A project is identified by its **sidebar view key**, the key Paseo's own sidebar uses for a
  project row: the project key when it is unique on its host, otherwise
  `JSON.stringify([serverId, projectId])`. The same project on two hosts shares one key.
- A project without an assignment, or assigned to a Space that no longer exists, belongs to the
  **first** Space.
- **New projects** join the current Space. A project that appears on a host after a desktop or
  web window first listed that host gets the window's current Space, as soon as its row shows
  in the sidebar. When no window has focus at that moment (a folder picker is open, say), the
  next window to get focus places it as soon as it does. Only the window with focus places
  projects, so two open windows do not race. Phones never place projects: their sidebar is not filtered.
- Projects a host already has when a window first lists it keep their place, and a project
  whose key already has a Space (one removed and added again, say) keeps that Space. A project
  created while no desktop or web window is open belongs to the first Space.
- The default layout is one Space, "Main".
- Space names are trimmed, 1 to 60 characters. A new Space is named "Space N", N being one more
  than the number of Spaces, or the next number not already taken.
- Removing a Space needs at least two. Its projects move to the first remaining Space.

## Current Space

- Each client keeps its own **current Space**. It is remembered across restarts where the client
  has local storage, and falls back to the first Space when the remembered one is gone.
- Switching never touches agents, workspaces or the open chat.

## Switcher (sidebar header item)

- A header row, built on Paseo's `SidebarRow`, labelled with the current Space and a
  chevrons icon. Users show, hide and reorder it in Settings, Sidebar.
- **Phones (the native apps)** get a plain "Spaces" row instead, which opens the manage screen.
  Paseo gives plugins no way to hide sidebar rows there, so switching would change nothing.
  The row keeps the switcher's id, so where it sits in Settings, Sidebar carries over.
- Pressing it opens a popover (a bottom sheet on compact layouts) with:
  - every Space, the current one checked; on keyboard clients each of the first nine shows the
    digit that picks it
  - New space, which creates and switches to it
  - Rename "X"…, an inline field: Enter or Save saves, Cancel or Escape discards, blank is refused
  - Remove "X"…, a confirmation: "Remove “X”? Its projects move to Y." with Remove and Cancel
    (Cancel holds focus). Disabled when only one Space is left.
  - Manage spaces…, which opens the manage screen
- Spaces load when the app starts. A host reached through another host (a phone paired with
  one host, using a plugin on a second) can take a while to reconnect, so a failed first load
  is tried again after 1, 2, 4 and 8 seconds, then every 15, and shows as loading meanwhile.
  Only after about 45 seconds of failures does the popover show the error, with Try again,
  which starts over.
- Once loaded, Spaces refresh every 15 seconds and whenever the app comes back to the
  foreground. A refresh that fails keeps the Spaces as they were and shows nothing.
- A change that cannot be saved shows why in the popover.

## Keyboard (desktop app on macOS)

- ⌘J opens the switcher, or closes it when open. While it is open, 1 to 9 pick that Space and
  focus returns to where it was before ⌘J.
- ⌘⌥↑ and ⌘⌥↓ switch to the previous or next Space, stopping at the first and last.
- Paseo binds ⌘[ and ⌘] (previous and next workspace) and ⌘⇧ with arrows, so these are not used.
- Keys are handled before the focused element, so a terminal or editor does not swallow them.

## Command center (⌘K)

- "Switch to space: X" for every Space, "New space" and "Manage spaces". Phones get only
  "New space" and "Manage spaces".

## Sidebar (desktop app and web)

- Project groups whose project belongs to another Space are hidden. Switching slides the project
  list in from the side of travel, unless reduced motion is on.
- The project section heading shows the current Space's name, restored when the plugin stops.
- Pinned workspace rows follow their project's Space. Each pinned row is keyed
  `serverId:workspaceId`; its project is looked up on its own host. A row whose project is not
  known yet (host offline, still loading) stays visible.
- When every pinned row belongs to another Space, the Pinned section hides, unless rows are
  paged behind "Show more".
- Each project's menu gains a "Move to space" section listing every Space, the current one
  checked. Choosing one saves and closes the menu; a failed save keeps it open with the error.
- While the layout cannot be loaded, nothing is hidden.
- Stopping the plugin removes everything it added and shows every row again.

## Manage screen (all clients)

- Lists the Spaces (rename, remove, add) and every project on every connected host, each with a
  Space picker. On clients where the sidebar cannot be filtered, this is how Spaces are used.

## Data access

- Reads the project and workspace lists of every connected host through the client's own
  connection. Stores the layout in this host's plugin settings. No network access of its own.
