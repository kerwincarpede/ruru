---
title: Watch your cameras
description: Maximise a tile, use the tile menu, go full screen, and read what a tile says when its picture stops.
sidebar:
  order: 1
---

When Ruru starts, the Ruru owl in the middle of the window says **Looking for cameras** while Ruru asks Frigate for its cameras, then **Connecting to your cameras** with a count such as **2 of 5 cameras connected**. The wall appears once every tile plays, or after 20 seconds if a camera is slow, and that camera's tile then says what is wrong. The same happens after you choose **Start streams**.

If Ruru can't read Frigate's cameras, the owl says what went wrong: **Ruru can't reach Frigate** when nothing answers, **Frigate turned Ruru away** when Frigate answers with an error, or **That doesn't look like Frigate** when something else answers. The error itself shows underneath. Ruru tries again every 5 seconds until Frigate answers. Choose **Try again** to try at once, or **Settings** to fix the address.

If Frigate has no cameras yet, the owl says so. Add a camera to Frigate's config, then come back to the Ruru window or choose **Check again**. If you hide every camera, the owl says **Every camera is hidden**. Choose **Show all cameras** to put them all back in Frigate's order, or **Edit layout** to pick which ones.

Each tile shows the camera's latest snapshot until its video starts, then plays live. A tile with neither a snapshot nor video, usually because the camera is offline or still starting, shows a small owl and **Waiting for a picture**. The camera's name sits in the tile's bottom corner.

## Maximise a camera

**Double-click** a tile, or right-click it and choose **Maximise**, to fill the window with that camera. The picture keeps moving and sharpens once the main stream arrives.

Double-click again, choose **Restore**, or press `Esc` to go back to the wall.

## The right-click menu

Right-click a tile for that camera's menu:

| Item | What it does |
| --- | --- |
| **Maximise** or **Restore** | Fills the window with the camera, or goes back to the wall. |
| **Reconnect** | Starts the camera's video again. |
| **Hide** | Takes the camera off the wall. Bring it back from [**Edit layout**](/ruru/wall/arrange/#hide-and-show-cameras). |
| **Show stream info** | Shows playback details on every tile. See [Stream info](/ruru/wall/streams/#stream-info). |
| **Automatic**, **Main stream**, **Sub stream** | Which of the camera's streams the tile plays. Only on cameras that have both. See [Streams](/ruru/wall/streams/). |

The wall's own items follow below: **Settings…**, **Edit layout**, **Stop streams** (or **Start streams**), **Fit to window**, **Show activity** while **Connect to Home Assistant** is on, and **Enter full screen**. Right-click anywhere else on the wall for just those.

The arrow keys move through the menu, `Home` and `End` jump to the first and last items, and `Esc` closes it.

## Motion, objects and alerts

With [Home Assistant](/ruru/guides/home-assistant/#activity-on-the-tiles) connected, a tile is marked in yellow while its camera sees motion, shows a chip such as **Person** for each kind of object moving, and is marked in red with **Alert** in its caption during a Frigate alert. Choose how tiles are marked with **Activity style** in **Settings → Home Assistant**. Untick **Show activity** in the right-click menu to hide them.

## Full screen

Press `F11` (`Ctrl+⌘ F` on macOS), or right-click and choose **Enter full screen**, to fill the screen. Press it again, or choose **Exit full screen**, to leave.

Ruru starts full screen next time if you left it that way, which suits a wall display that powers on with the computer.

The toolbar with **Edit layout** and the gear for **Settings** hides while you watch. Move the pointer to show it.

## Stopping the streams

Right-click the wall and choose **Stop streams** to stop every tile's stream. The tiles make way for a sleeping Ruru owl in the middle of the window, which says the streams are off and how to turn them back on. Choose **Start streams** under the owl, or right-click anywhere and choose **Start streams**, to play them again. **Edit layout** comes back once the streams are on. Home Assistant can do the same with its [Streams switch](/ruru/guides/home-assistant/#streams).

## When a picture stops

Ruru reconnects on its own when a camera or the network drops. While it does, the tile keeps its last frame, dims it, and says how old it is in its caption:

- **Reconnecting · 12 s old**: the stream dropped and Ruru is connecting again.
- **Frozen · 12 s old**: the stream is connected, but its picture stopped moving.
- **Reconnecting…**: Ruru is trying again before any picture has arrived.
- **Can't play this stream**: the stream doesn't play on this computer. See [Troubleshooting](/ruru/reference/troubleshooting/).

The caption clears as soon as new video arrives. To force a fresh start, right-click the tile and choose **Reconnect**.

Ruru stops every stream while its window is hidden, and starts them again when it comes back.
