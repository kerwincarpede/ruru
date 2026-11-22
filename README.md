<div align="center">

# Ruru

### Eyes on every camera.

**A fast, free, low-latency camera wall for [Frigate](https://frigate.video/), on Windows, macOS and Linux.**<br>
Point it at your Frigate server, and every camera is live on one screen, laid out how you want.

<a href="LICENSE"><img alt="MIT license" src="https://img.shields.io/badge/license-MIT-blue"></a>

</div>

---

> **Ruru is in early development.** It opens a placeholder window for now; this page describes what Ruru is being built to do.

## Download

Download the installer for your platform from the [latest release](https://github.com/kerwincarpede/ruru/releases/latest): `.msi` or `-setup.exe` for Windows, the universal `.dmg` for macOS, and `.AppImage`, `.deb` or `.rpm` for Linux. Ruru checks for a newer Stable release when it starts and asks before installing it.

Each merge to `main` is also published as an **Edge** pre-release on the [releases page](https://github.com/kerwincarpede/ruru/releases). Edge builds are installed by hand.

The installers are not signed with a paid certificate, so Windows SmartScreen and macOS Gatekeeper warn on first launch. On macOS, choose **Done**, then **Open Anyway** in **System Settings → Privacy & Security**.

## Why Ruru?

Frigate is great at recording and detecting, but watching all your cameras at once, live, on a spare monitor or a wall display, shouldn't mean a browser tab full of lagging tiles. Ruru is a desktop app built for that one job:

1. **Enter your Frigate address.**
2. **Every camera appears**, live, within a second or two.
3. **Drag and resize** tiles until the wall looks right. Ruru remembers it.

Ruru is named after the ruru, the morepork: a small New Zealand owl that keeps watch through the night.

## What it will do

<table>
<tr>
<td width="50%" valign="top">

### Sync from Frigate
Connect to your Frigate server once, and Ruru reads its camera list for you. Add a camera to Frigate and it shows up in Ruru. No stream URLs to copy, no camera passwords to type in twice.

</td>
<td width="50%" valign="top">

### Live, with as little delay as possible
Video plays straight from Frigate's built-in restreamer (go2rtc) over WebRTC, so what you see is close to real time. Ruru never decodes, copies or re-encodes your video itself.

</td>
</tr>
<tr>
<td valign="top">

### Arrange your wall
Drag tiles to move them and pull their edges to resize them on a snapping grid. Make the front door big and the side gate small. Your layout is saved and comes back exactly as you left it.

</td>
<td valign="top">

### Built for a screen that's always on
Runs full screen on a spare monitor or a wall-mounted display, reconnects on its own when a camera or the network drops, and stays light enough to leave running all day.

</td>
</tr>
</table>

## How it works

Ruru is a [Tauri](https://tauri.app/) desktop app: a Rust backend and a React + TypeScript interface.

- **Discovery:** the Rust backend reads your camera list from Frigate's HTTP API (`/api/config`).
- **Playback:** each tile opens a WebRTC connection to the camera's stream on Frigate's go2rtc restreamer, the same path Frigate's own live view uses. Video goes from Frigate to the tile without passing through Ruru's backend.
- **Layout:** tile positions and sizes are saved on your computer, per Frigate server.

Nothing leaves your computer except requests to the Frigate server you point it at, and a check of Ruru's GitHub releases for updates. No analytics, no telemetry, no cloud account.

## Inspiration

Ruru is inspired by [CCTV Viewer](https://github.com/iEvgeny/cctv-viewer), a simple Qt app for watching many RTSP streams at once. Ruru takes the same idea and builds it around Frigate, so your cameras are found for you.

## Contributing

Ideas and bug reports are welcome. [Open an issue](https://github.com/kerwincarpede/ruru/issues) to get started.

## License

[MIT](LICENSE).
