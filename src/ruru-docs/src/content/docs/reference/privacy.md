---
title: How it works and privacy
description: What Ruru talks to, how video reaches the screen, and what it never sends.
sidebar:
  label: How it works and privacy
  order: 4
---

Ruru is a [Tauri](https://tauri.app/) desktop app: a Rust backend and a React and TypeScript interface.

## What Ruru talks to

Only two places:

1. **Your Frigate server**, at the address you enter.
2. **GitHub**, to check for a newer release of Ruru on your update channel.

No analytics, no telemetry, no cloud account.

## How it works

- **Discovery:** the backend reads your cameras and their streams from Frigate's HTTP API (`/api/version`, `/api/config` and `/api/go2rtc/streams`) when Ruru starts and whenever its window comes back into focus.
- **Playback:** each tile connects to the camera's stream on Frigate's go2rtc restreamer over WebRTC, the same path Frigate's own live view uses, and falls back to MSE. It shows the camera's latest snapshot until the video starts, reconnects on its own, and stops while the window is hidden.
- **Video stays between Frigate and the screen:** it goes from Frigate to the tile without passing through Ruru's backend. Ruru never records, copies or re-encodes it.
- **Settings:** the Frigate address, full screen, the wall options, the update channel, and each server's tile positions and sizes are saved in `settings.json` on your computer. See [Settings](/ruru/reference/settings/#where-settings-are-kept).

## Open source

Ruru is free and MIT licensed. Read the code on [GitHub](https://github.com/kerwincarpede/ruru).
