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

## Home Assistant

| Setting | What it does |
| --- | --- |
| **Connect to Home Assistant** | Connects Ruru to the MQTT broker below. Off until you turn it on. |
| **Broker** and **Port** | The MQTT broker Home Assistant uses, such as `homeassistant.local`, on port 1883 (8883 with TLS). |
| **Use TLS** | Connects over TLS and checks the broker's certificate against the ones your computer trusts. |
| **Username** and **Password** | The broker login. Leave the password empty to keep the saved one. To remove the saved password, clear the username and save. |
| **Discovery prefix** | Where Home Assistant looks for new devices. Usually `homeassistant`. |
| **Frigate prefix** | The topic prefix set in Frigate's `mqtt` settings. Usually `frigate`. |
| **Test connection** | Connects to the broker once, and says whether it worked. |

Choose **Save** to connect, or to disconnect when **Connect to Home Assistant** is off. See [Home Assistant](/ruru/guides/home-assistant/).

## Appearance

| Setting | What it does |
| --- | --- |
| **Show activity** | Shows Frigate's motion, objects and alerts on each tile. On by default. Also in the wall's right-click menu. |
| **Activity style** | How a tile is marked for motion and alerts: **Outline between tiles** (the default), **Thin outline**, **Corner marks**, **Top edge** or **Name only**. See [Activity on the tiles](/ruru/guides/home-assistant/#activity-on-the-tiles). |
| **Show stream info** | Shows playback details on each tile. Also in the tile’s right-click menu. See [Stream info](/ruru/wall/streams/#stream-info). |
| **Dynamic wall** | Shows busy cameras large above the rest while Frigate sees objects. Off by default. The preview shows how it looks at your wall's size. Home Assistant's **Dynamic wall** switch changes it too. See [Dynamic wall](/ruru/wall/watch/#dynamic-wall). |
| **First hero slot**, **Second hero slot** | **Automatic**, or two tiles of your layout that busy cameras swap into. Saved for each Frigate server. |
| **Hero objects** | The objects Frigate tracks on your wall's cameras. Untick one, such as a dog, so it no longer makes a camera a hero. All are ticked by default. Saved for each Frigate server. |
| **Priority cameras** | Cameras that fill the wall while Frigate sees a person there. Press `Esc` to go back. Saved for each Frigate server. |

Choose **Save** to apply these settings. Card highlighting and the Dynamic wall use activity from the MQTT broker configured in **Settings → Home Assistant**.

## Updates

| Setting | What it does |
| --- | --- |
| **Update channel** | **Stable** or **Edge**. See [Updates](/ruru/get-started/updates/). |
| **Install updates automatically** | Off by default. When on, Ruru checks at startup and every 6 hours, then installs a newer version and restarts without asking. See [Automatic updates](/ruru/get-started/updates/#automatic-updates). |
| **Check for updates** | Checks the channel now. When there is a newer version, the button becomes **Install and restart**. |

Changes on this page save as you make them.

## On the wall

These are set on the wall itself and remembered for next time:

- **Lock to 16:9**, **Fit to window**, **Show stream info** and **Show activity**. See [Arrange the wall](/ruru/wall/arrange/), [Stream info](/ruru/wall/streams/#stream-info) and [Activity on the tiles](/ruru/guides/home-assistant/#activity-on-the-tiles).
- Each tile's position, size and stream choice, and which cameras are hidden, saved for each Frigate server.
- Whether Ruru was full screen.

## Where settings are kept

Ruru saves everything in `settings.json` in its config folder:

| Platform | Folder |
| --- | --- |
| Windows | `%APPDATA%\com.kerwincarpede.ruru\` |
| macOS | `~/Library/Application Support/com.kerwincarpede.ruru/` |
| Linux | `~/.config/com.kerwincarpede.ruru/` |

The MQTT broker password is kept in your computer's keychain: the macOS Keychain, Windows Credential Manager, or the Secret Service (such as GNOME Keyring) on Linux. When there is no keychain Ruru can use, including a locked one that would ask for its password, the password goes in `settings.json`, and **Settings → Home Assistant** says so.

To start again from **Connect to Frigate**, quit Ruru and delete `settings.json`.
