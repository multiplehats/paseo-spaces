Spaces groups the projects in your sidebar into named sets, such as Work, Clients and Personal,
and shows one set at a time. Switching only changes what the sidebar shows: agents keep running
and the open chat stays where it is.

**Desktop and web only, for now.** Paseo's phone app doesn't let plugins change its sidebar, so
on a phone every project stays visible. The Spaces row there opens the screen where you sort
projects into Spaces. If you don't want the row on your phone, turn it off in the phone's
Settings, Sidebar, Header. That setting is kept per device, so the desktop keeps its switcher.

## Switching

A Spaces row in the sidebar header shows the current Space. Press it to see every Space and pick
one, create a new Space, rename or remove the current one, or open the manage screen. Removing a
Space asks first and moves its projects to the first remaining Space.

On the desktop app for macOS, ⌘J opens the switcher and the digits 1 to 9 then pick a Space,
returning focus to where you were. ⌘⌥↑ and ⌘⌥↓ go to the previous or next Space. The command
center (⌘K) lists "Switch to space" for every Space, "New space" and "Manage spaces".

Opening a workspace from the command center, a notification or another plugin switches to its
Space and unfolds its project on the desktop and web apps.

## Sorting projects

Each project's menu in the sidebar has a "Move to space" section. The manage screen lists every
project on every connected host with a Space picker for each. A project checked out on two hosts
belongs to one Space. A project you create joins the Space you are in, and projects you have not
sorted otherwise belong to the first Space.

## What changes in the sidebar

On the desktop app and the web app, projects in other Spaces are hidden, the project heading
shows the current Space's name, and pinned workspaces follow their project, including pinned
workspaces on other hosts. When none of the pinned workspaces belong to the current Space, the
Pinned section hides. On phones the sidebar is not filtered, so the Spaces row opens the manage
screen instead, where you sort projects.

## Setup

The switcher is added at the end of the sidebar header. Move it up with the arrows in Settings,
Sidebar, Header. Install Spaces on one host per desktop: each host keeps its own Spaces.

Requires Paseo 0.15 or later.

## Data and limits

Spaces reads the project and workspace lists of the hosts you are connected to, using the
app's own connection. The Spaces and which project belongs to which are stored in this host's
plugin settings. The current Space is stored on each device. Spaces makes no network requests of
its own.

Hiding projects, the heading and the menu section rely on how Paseo's sidebar is built, so a
Paseo update can affect them. The switcher and the manage screen use Paseo's plugin API. The
keyboard shortcuts are not part of Paseo's shortcut list and cannot be changed there.
