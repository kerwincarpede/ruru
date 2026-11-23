---
title: How it works and privacy
description: What Ruru talks to, how video reaches the screen, and what it never sends.
sidebar:
  label: How it works and privacy
  order: 4
---

Ruru is a [Tauri](https://tauri.app/) desktop app: a Rust backend and a React and TypeScript interface.

## What Ruru talks to

Only these places:

1. **Your Frigate server**, at the address you enter.
2. **GitHub**, to check for a newer release of Ruru on your update channel: at startup, when you ask, and every 6 hours while Ruru is connected to Home Assistant.
3. **Your MQTT broker**, only if you turn on **Connect to Home Assistant** in **Settings → Home Assistant**. Ruru connects to the broker you enter and nowhere else. See [Home Assistant](/ruru/guides/home-assistant/).

No analytics, no telemetry, no cloud account.

## How it works

- **Discovery:** the backend reads your cameras and their streams from Frigate's HTTP API (`/api/version`, `/api/config` and `/api/go2rtc/streams`) when Ruru starts and whenever its window comes back into focus.
- **Playback:** each tile connects to the camera's stream on Frigate's go2rtc restreamer over WebRTC, the same path Frigate's own live view uses, and falls back to MSE. It shows the camera's latest snapshot until the video starts, reconnects on its own, and stops while the window is hidden.
- **Video stays between Frigate and the screen:** it goes from Frigate to the tile without passing through Ruru's backend. Ruru never records, copies or re-encodes it.
- **Home Assistant:** over MQTT, Ruru publishes its version, the maximised camera, whether it is full screen and shown, whether each camera's tile has a problem, and the installed and newest versions. It takes commands from Home Assistant to maximise a camera, restore the wall, change full screen, stop or start the streams, turn the display off or on, and install an update. It sends no video or snapshots. On the same broker it asks Frigate for its cameras' activity, with `<frigate prefix>/onConnect`, and reads Frigate's motion, object and review topics to draw activity on the tiles. It does not read Frigate's snapshots.
- **Settings:** the Frigate address, full screen, the wall options, the update channel, whether updates install automatically, the Home Assistant connection, and each server's tile positions and sizes are saved in `settings.json` on your computer. The broker password goes in your computer's keychain, or in `settings.json` when there is no keychain Ruru can use. See [Settings](/ruru/reference/settings/#where-settings-are-kept).

## Open source

Ruru is free and MIT licensed. Read the code on [GitHub](https://github.com/kerwincarpede/ruru).
