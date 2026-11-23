---
title: Settings
description: Every Ruru setting, and where Ruru keeps them on your computer.
sidebar:
  order: 2
---

Open **Settings** from the gear at the top right, with `Ctrl+,` (`⌘ ,` on macOS), or by right-clicking the wall and choosing **Settings…**.

## Frigate

| Setting | What it does |
| --- | --- |
| **Frigate URL** | The address you open Frigate at, on its unauthenticated port (usually 5000), such as `http://frigate.local:5000`. |
| **Test connection** | Checks the address, and shows the Frigate version and how many cameras it has. |

Choose **Save** to use the address. See [Connect to Frigate](/ruru/get-started/connect/).

## Updates

| Setting | What it does |
| --- | --- |
| **Update channel** | **Stable** or **Edge**. See [Updates](/ruru/get-started/updates/). |
| **Check for updates** | Checks the channel now. When there is a newer version, the button becomes **Install and restart**. |

Changes on this page save as you make them.

## On the wall

These are set on the wall itself and remembered for next time:

- **Lock to 16:9**, **Fit to window** and **Show stream info**. See [Arrange the wall](/ruru/wall/arrange/) and [Stream info](/ruru/wall/streams/#stream-info).
- Each tile's position, size and stream choice, and which cameras are hidden, saved for each Frigate server.
- Whether Ruru was full screen.

## Where settings are kept

Ruru saves everything in `settings.json` in its config folder:

| Platform | Folder |
| --- | --- |
| Windows | `%APPDATA%\com.kerwincarpede.ruru\` |
| macOS | `~/Library/Application Support/com.kerwincarpede.ruru/` |
| Linux | `~/.config/com.kerwincarpede.ruru/` |

To start again from **Connect to Frigate**, quit Ruru and delete `settings.json`.
