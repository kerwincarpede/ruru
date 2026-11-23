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
| A **Reconnect** button for each camera, such as **Reconnect Front door** | Drops the tile's stream and connects it again. |
| **Update** | Shows when a newer version is out on your update channel, and installs it. |
| **Display** | A switch that turns the screen off and on. Only where Ruru can do it: see [Display](#display). |

Every entity shows as unavailable while Ruru is not connected, such as when the computer is off. Problem sensors and Reconnect buttons follow the cameras on the wall: hiding a camera removes them, and showing it adds them back. **Maximise** offers only the cameras on the wall.

## Updates from Home Assistant

While connected, Ruru checks the update channel picked in **Settings → Updates** when it connects and then every 6 hours, and the **Update** entity shows what it found. Choose **Install** in Home Assistant to download and install it. Ruru then restarts on the new version full screen, ready for a wall display. If the install fails, such as when its password prompt is cancelled, Ruru keeps running as it was and checks again, so **Install** can be tried again.

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

Ruru checks when it connects. Where the tool is missing, or the compositor can't turn its outputs off, such as GNOME or KDE on Wayland, the switch is not offered and Ruru says why in its log. Install the tool, then restart Ruru or save **Settings → Home Assistant** again, to get the switch. Whether cage can turn its outputs off is not yet verified.

The switch shows what Ruru last did. Touching the mouse or keyboard may wake the screen without the switch knowing, so it can show off while the screen is on. Turn it on, or off and on again, to match.

## Streams

Turn the **Streams** switch off to stop every tile's stream, such as overnight when nobody is watching. The tiles show their last snapshots and Ruru stops pulling video from Frigate, which saves network, CPU and power. Turn it on to start them all again. Pair it with the **Display** switch to turn the wall off at night without shutting the computer down.

You can also right-click the wall and choose **Stop streams** or **Start streams**. Ruru always starts with its streams on.

## Activity on the tiles

Frigate publishes what it sees to the same broker. While Ruru is connected, each tile shows its camera's activity:

- **Motion:** the tile is marked in yellow while Frigate sees motion.
- **Objects:** a chip at the top right for each kind of object moving in view, such as **Person**, or **Car ×2** for two. Parked and other still objects get no chip.
- **Alert:** the tile is marked in red, its object chips turn red, and its caption says **Alert**, while Frigate has an alert open for the camera. Which objects and zones raise an alert is set in Frigate's `review` settings.

Choose how tiles are marked with **Activity style** in **Settings → Home Assistant**. Every style leaves the picture clear apart from a few pixels at most:

| Style | Motion | Alert |
| --- | --- | --- |
| **Outline between tiles** (the default) | A yellow outline in the gap round the tile, outside the picture. | A red outline in the gap, and a red caption. |
| **Thin outline** | A thin yellow outline just inside the picture's edge. | A thin red outline, and a red caption. |
| **Corner marks** | Yellow marks on the picture's four corners. | Larger red corner marks. |
| **Top edge** | A thin yellow bar along the top of the picture. | A red bar. |
| **Name only** | A thin yellow outline. | A red caption with a pulsing dot, and no outline. |

A maximised tile has no gap round it, so **Outline between tiles** draws a thin outline inside its edge instead.

**Show activity** is on by default. Turn it off in **Settings → Home Assistant**, or right-click the wall and untick **Show activity**. The tiles go quiet while Ruru is not connected to the broker.

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
| `reconnect` | A camera's name. |
| `install` | Anything. |
| `display` | `ON` or `OFF`. |

Ruru ignores retained commands, unknown commands, and cameras that are not on the wall.

Discovery configs are retained under `<discovery prefix>/<component>/<device id>/<object id>/config`. Change **Discovery prefix** only if you changed it in Home Assistant's MQTT settings.

For activity, Ruru publishes `<frigate prefix>/onConnect` when it connects, so Frigate answers with every camera's activity on `<frigate prefix>/camera_activity`. It then follows `<camera>/motion`, `<camera>/<object>/active` and `<camera>/review_status` under the Frigate prefix. It never reads snapshots.
