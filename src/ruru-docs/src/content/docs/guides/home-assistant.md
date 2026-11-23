---
title: Home Assistant
description: Show the wall in Home Assistant as a device, with its state, a problem sensor for each camera and controls for the wall, the display and updates, and show Frigate's activity on the tiles.
sidebar:
  order: 2
---

Ruru can connect to the MQTT broker that Home Assistant uses. Each computer running Ruru then shows up in Home Assistant as a device, found through [MQTT discovery](https://www.home-assistant.io/integrations/mqtt/#mqtt-discovery). Nothing is sent until you turn it on.

## Before you start

You need an MQTT broker that Home Assistant is connected to, such as the Mosquitto broker add-on, and a login for Ruru on it. With the add-on, a Home Assistant user works as the login.

## Connect

1. Open **Settings** and choose **Home Assistant**.
2. Turn on **Connect to Home Assistant**.
3. In **Broker**, enter the broker's address, such as `homeassistant.local`. Keep **Port** at 1883, or turn on **Use TLS** for 8883.
4. Enter the **Username** and **Password**.
5. Choose **Test connection**. Ruru says **Connected to the broker at homeassistant.local:1883.** when it works.
6. Choose **Save**.

Ruru keeps the password in your computer's keychain. When there is no keychain Ruru can use, such as on a Raspberry Pi without a desktop keyring, it keeps the password in `settings.json` and the page says so.

Ruru never asks you to unlock the keychain, so no password prompt covers the wall. On Linux the login keyring stays locked when the computer logs in automatically, and Ruru treats a locked keyring as one it can't use. If the password is already in a locked keyring, Ruru connects without it, and **Test connection** says the keychain is locked. Enter the password again and choose **Save** to keep it in `settings.json`.

## What Home Assistant sees

The device is called **Ruru on** and the computer's name, such as **Ruru on kitchen-pi**. It has:

| Entity | What it shows |
| --- | --- |
| **Version** | The version of Ruru running. |
| **Maximised camera** | The camera filling the window, or `none`. |
| **Full screen** | On while Ruru is full screen. |
| **Window shown** | Off while the window is minimised or hidden. |
| A **problem** sensor for each camera, such as **Front door problem** | On when the camera's tile can't play its stream, or has been frozen or reconnecting for 30 seconds. |

It also has controls:

| Entity | What it does |
| --- | --- |
| **Maximise** | A select: pick a camera to fill the window with it, or `none` to show the whole wall. |
| **Restore** | A button that shows the whole wall again. |
| **Full screen** | A switch that turns full screen on and off. |
| **Streams** | A switch that stops every tile's stream and starts them again. See [Streams](#streams). |
| **Update** | Shows when a newer version is out on your update channel, and installs it. |
| **Check for updates** | A button that checks your update channel now, rather than waiting for the next check. |
| **Display** | A switch that turns the screen off and on. Only where Ruru can do it: see [Display](#display). |

The wall’s entities show as unavailable while Ruru is disconnected. With [Ubuntu host controls](#ubuntu-host-controls) on, the agent’s entities follow its separate connection. Problem sensors follow the cameras on the wall: hiding a camera removes its sensor, and showing it adds it back. Tiles reconnect on their own, so there are no Reconnect buttons; Ruru removes any an earlier version added. **Maximise** offers only the cameras on the wall.

## Updates from Home Assistant

While connected, Ruru checks the update channel picked in **Settings → Updates** when it connects and then every 6 hours, and the **Update** entity shows what it found. Press **Check for updates** to check now, such as just after a new release is out. Choose **Install** in Home Assistant to download and install it. The wall shows how far the download has got, then restarts on the new version full screen, ready for a wall display. If the install fails, such as when its password prompt is cancelled, Ruru keeps running as it was and checks again, so **Install** can be tried again.

On Linux, a `.deb` or `.rpm` install may ask for your password on the computer running Ruru before it can finish. The AppImage updates without asking.

If the connection drops, Ruru connects again on its own, waiting a little longer after each failure, up to a minute.

## Display

The **Display** switch turns the computer's screen off and on, such as from an automation that turns the wall off at night or on when someone comes home. Ruru offers it only where it works:

| Platform | How Ruru does it | What it needs |
| --- | --- | --- |
| Windows | The system's monitor power message. | Nothing. |
| macOS | `pmset displaysleepnow` to turn it off, `caffeinate -u` to turn it on. | Nothing. |
| Linux with X11 | `xset dpms force off` and `xset dpms force on`. | `xset`, from the `x11-xserver-utils` package on Debian and Raspberry Pi OS, and an X server with DPMS. |
| Linux with Wayland | `wlopm --off '*'` and `wlopm --on '*'`. | `wlopm`, from the `wlopm` package, and a wlroots compositor that can turn its outputs off, such as labwc or Sway. |

Ruru checks when it connects. Where the tool is missing, or the compositor can't turn its outputs off, such as KDE on Wayland, or GNOME without host controls, the switch is not offered and Ruru says why in its log. Install the tool, then restart Ruru or save **Settings → Home Assistant** again, to get the switch. Whether cage can turn its outputs off is not yet verified.

Without Ubuntu host controls, the switch shows what Ruru last did. Touching the mouse or keyboard may wake the screen without the switch knowing, so it can show off while the screen is on. Turn it on, or off and on again, to match.

## Ubuntu host controls

With the Ubuntu `.deb` on GNOME Wayland, an optional user service can keep **Display** available after the Ruru window closes. It reads display power from GNOME so the switch follows changes such as wake from local input. It also adds these entities to the same Ruru device:

| Entity | What it shows or does |
| --- | --- |
| **Ruru** | Starts or stops the wall’s user service. It shows the confirmed service state and is unavailable during a transition. A failed start leaves the switch off and reports an error in the entity’s attributes and in Ruru. To relaunch, turn it off, wait for it to show off, then turn it on. |
| **Ruru CPU** | CPU usage for the service and its child processes over 30 seconds. One fully used logical core is 100%. The reading starts at zero on a new service invocation. |
| **Ruru memory** | Current service memory in MiB, including the service’s child processes. |

Both sensors show zero when the wall is stopped. All agent entities show as unavailable when the agent disconnects.

### Set up host controls

1. Save the Ruru connection in **Settings → Home Assistant**.
2. Create a separate account for the agent on the same MQTT 5-capable broker and grant the [permissions below](#broker-permissions).
3. Choose **Enable host controls**, enter the separate MQTT username and password, and choose **Test host controls connection**.
4. Confirm the startup change and choose **Enable and restart Ruru**. Ruru restarts under `ruru.service` and the agent runs under `ruru-host-agent.service`. Your previous user service file and matching GNOME autostart entries are saved and restored when you turn host controls off.
5. Open the Home Assistant page again and look for **Host controls connected**. Open the existing Ruru device in Home Assistant to see the new controls and sensors.

The wall starts whenever you sign into the graphical desktop, even if you turned it off in Home Assistant before signing out. Opening Ruru locally starts the service or raises the running window. The service also handles relaunches after in-app, Home Assistant, and automatic updates. Updates use the usual installer permissions. If you turn the wall off from Home Assistant during installation, the service stays on and reports that it is busy. Try again after the update finishes.

Choose **Disable host controls** to stop the agent, restore the previous startup settings and remove its Home Assistant controls. If you edited a startup file that Ruru replaced, move it aside when prompted, then retry to restore the saved file. If the broker is unreachable, the agent stops immediately and **Retry broker cleanup** appears. Use it once the broker is reachable. Ruru keeps the agent’s credentials until it can remove the retained messages.

The agent runs as your desktop user, connects only to your saved broker and sends the states listed here. Its MQTT credentials are in a separate user-readable file under Ruru’s local configuration directory. To see why the service could not start or connect, run `journalctl --user -u ruru-host-agent.service -u ruru.service -b` in the desktop session. The configuration folder’s `host-controls` directory holds the original startup files while the agent is enabled.

### Broker permissions

Substitute the discovery prefix and device ID from Ruru’s MQTT setup and `settings.json`. Give the agent account read access to `<discovery prefix>/status` and `ruru/<device id>/agent/command/+`. Give it write access to:

- `ruru/<device id>/agent/availability`
- `ruru/<device id>/agent/+/state`
- `ruru/<device id>/agent/+/availability`
- `ruru/<device id>/agent/+/attributes`
- `<discovery prefix>/switch/<device id>/display/config`
- `<discovery prefix>/switch/<device id>/ruru/config`
- `<discovery prefix>/sensor/<device id>/cpu/config`
- `<discovery prefix>/sensor/<device id>/memory/config`

Home Assistant needs to read the agent’s discovery, availability and state messages and publish to `ruru/<device id>/agent/command/+`. Keep all command messages non-retained. For the **Ruru** and **Display** switches, the payloads are `ON` and `OFF` and the command names are `ruru` and `display`. The agent rejects retained commands and broker redeliveries.

### Reboot the Ubuntu host

**Enable host reboot** is a separate setting under **Settings → Home Assistant → Host controls**. Turn it on after host controls connect. Before enabling it, add these permissions to the broker ACL:

- Let the agent read `ruru/<device id>/agent/command/reboot` and write `<discovery prefix>/button/<device id>/reboot/config`. The agent’s existing state permissions cover `agent/reboot/availability` and `agent/reboot/attributes`.
- Let Home Assistant read that discovery and availability data and publish `PRESS` to `ruru/<device id>/agent/command/reboot` as a non-retained message.

Ruru checks these permissions as you enable reboot. **Reboot host** appears on the same Home Assistant device and is available when the agent is connected and Ubuntu allows a normal reboot.

If the Settings page offers **Authorise host reboot**, choose it with a local administrator present. The agent runs as your desktop account. Its user service can need permission even when the desktop can reboot. If no approval prompt appears, open a terminal in the local desktop and run the following command as the desktop account. It needs the Ubuntu `pkexec` package.

```sh
pkexec /usr/share/ruru/host-controls/authorize-reboot
```

Approval grants only the standard Ubuntu reboot action to that account. It leaves approvals for rebooting with other users signed in and bypassing inhibitors under your existing system policy. Ruru requests a normal reboot and respects inhibitors. If a request fails, see **Reboot host** attributes or the host agent journal for the error.

The button becomes unavailable during reboot. It returns when you sign in and the agent reconnects. Ruru starts at graphical sign-in even if it was stopped in Home Assistant before the reboot. Set up automatic sign-in in Ubuntu if the wall should return without local input.

Untick **Enable host reboot** to stop accepting MQTT reboot commands and remove **Reboot host** when the broker is reachable. Keep the reboot ACL in place while Ruru finishes cleanup. The local administrator’s approval is saved separately so Ruru can reuse it. To revoke it, an administrator can delete `/etc/polkit-1/rules.d/90-ruru-reboot-<desktop UID>.rules`. The desktop account’s UID is shown by `id -u`. This also applies if you remove the package.

## Streams

Turn the **Streams** switch off to stop every tile's stream, such as overnight when nobody is watching. The wall shows a sleeping Ruru owl that says the streams are off and how to turn them back on, and Ruru stops pulling video and snapshots from Frigate, which saves network, CPU and power. Turn it on to start them all again. Pair it with the **Display** switch to turn the wall off at night without shutting the computer down.

You can also right-click the wall and choose **Stop streams** or **Start streams**. Ruru always starts with its streams on.

## Activity on the tiles

Frigate publishes what it sees to the same broker. While Ruru is connected, each tile shows its camera's activity:

- **Motion:** the tile is marked in yellow while Frigate sees motion.
- **Objects:** a chip at the top right for each kind of object moving in view, such as **Person**, or **Car ×2** for two. Parked and other still objects get no chip.
- **Alert:** the tile is marked in red, its object chips turn red, and its caption says **Alert**, while Frigate has an alert open for the camera. Which objects and zones raise an alert is set in Frigate's `review` settings.

Choose how tiles are marked with **Activity style** in **Settings → Appearance**. Every style leaves the picture clear apart from a few pixels at most:

| Style | Motion | Alert |
| --- | --- | --- |
| **Outline between tiles** (the default) | A yellow outline in the gap round the tile, outside the picture. | A red outline in the gap, and a red caption. |
| **Thin outline** | A thin yellow outline just inside the picture's edge. | A thin red outline, and a red caption. |
| **Corner marks** | Yellow marks on the picture's four corners. | Larger red corner marks. |
| **Top edge** | A thin yellow bar along the top of the picture. | A red bar. |
| **Name only** | A thin yellow outline. | A red caption with a pulsing dot, and no outline. |

A maximised tile has no gap round it, so **Outline between tiles** draws a thin outline inside its edge instead.

**Show activity** is on by default. Turn it off in **Settings → Appearance**, or right-click the wall and untick **Show activity**. The tiles go quiet while Ruru is not connected to the broker.

Frigate must have MQTT turned on with the same broker, and **Frigate prefix** must match the `topic_prefix` in Frigate's `mqtt` settings, usually `frigate`.

## Topics

Ruru publishes under `ruru/<device id>/`, where the device id is made once for each computer and kept in `settings.json`:

| Topic | Payload |
| --- | --- |
| `ruru/<device id>/availability` | `online`, or `offline` when Ruru goes away. |
| `ruru/<device id>/state` | JSON with `version`, `maximised`, `full_screen`, `window_shown` and `streams`. |
| `ruru/<device id>/problem/<camera>` | `ON` or `OFF`. |
| `ruru/<device id>/update` | JSON with `installed_version`, `latest_version`, `title`, `release_url` and `in_progress`, for the update entity. |
| `ruru/<device id>/display` | `ON` or `OFF`, as Ruru last turned the screen. Only where the **Display** switch is offered. |

Home Assistant sends commands to `ruru/<device id>/command/<command>`:

| Command | Payload |
| --- | --- |
| `maximise` | A camera's name, or `none` to restore. |
| `restore` | Anything. |
| `full_screen` | `ON` or `OFF`. |
| `streams` | `ON` or `OFF`. |
| `check_for_updates` | Anything. |
| `install` | Anything. |
| `display` | `ON` or `OFF`. |

Ruru ignores retained commands, unknown commands, and cameras that are not on the wall.

Discovery configs are retained under `<discovery prefix>/<component>/<device id>/<object id>/config`. Change **Discovery prefix** only if you changed it in Home Assistant's MQTT settings.

For activity, Ruru publishes `<frigate prefix>/onConnect` when it connects, so Frigate answers with every camera's activity on `<frigate prefix>/camera_activity`. It then follows `<camera>/motion`, `<camera>/<object>/active` and `<camera>/review_status` under the Frigate prefix. It never reads snapshots.
