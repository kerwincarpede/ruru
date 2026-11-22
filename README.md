<div align="center">

# Ruru

### Eyes on every camera.

**A fast, free, low-latency camera wall for [Frigate](https://frigate.video/), on Windows, macOS and Linux.**<br>
Point it at your Frigate server, and every camera is live on one screen, laid out how you want.

<a href="LICENSE"><img alt="MIT license" src="https://img.shields.io/badge/license-MIT-blue"></a>

</div>

---

## Get started

1. Open Ruru and choose **Connect to Frigate**.
2. Enter the address you open Frigate at, such as `http://frigate.local:5000`, choose **Test connection** to check it, then **Save**.
3. Every camera appears on the wall and plays live.

Open **Settings** again from the gear at the top right (it shows when you move the pointer), with `Ctrl+,` (`⌘ ,` on macOS), or from the menu you get by right-clicking the wall.

Ruru connects to Frigate's unauthenticated port, usually 5000. Logging in to Frigate's port 8971 is not supported yet.

### Using the wall

- **Double-click** a tile to fill the window with that camera at full quality. Double-click again or press `Esc` to go back.
- Choose **Edit layout** to drag tiles, resize them from their corners, or **Hide** them. **Reset to Frigate order** puts every camera back. Choose **Done** when the wall looks right. Ruru remembers the layout for each Frigate server.
- Press `F11` (`Ctrl+⌘ F` on macOS), or right-click and choose **Enter full screen**, to fill the screen. Ruru starts full screen next time if you left it that way.

## Download

Download the installer for your platform from the [latest release](https://github.com/kerwincarpede/ruru/releases/latest): `.msi` or `-setup.exe` for Windows, the universal `.dmg` for macOS, and `.AppImage`, `.deb` or `.rpm` for Linux. Ruru checks for a newer Stable release when it starts and asks before installing it.

On Linux you can install the latest Stable release with one command. It uses the `.deb` on Debian and Ubuntu, the `.rpm` on Fedora and openSUSE, and the `.AppImage` anywhere else:

```sh
curl -fsSL https://raw.githubusercontent.com/kerwincarpede/ruru/main/install.sh | sh
```

Set `RURU_FORMAT` to `deb`, `rpm` or `appimage` to choose the installer, or `RURU_VERSION` (for example `0.1.2`) to install a specific release. The package installs ask for your password through `sudo`. The AppImage goes in `~/.local/bin` and needs no password.

Each merge to `main` is also published as an **Edge** pre-release on the [releases page](https://github.com/kerwincarpede/ruru/releases). Edge builds are installed by hand.

The installers are not signed with a paid certificate, so Windows SmartScreen and macOS Gatekeeper warn on first launch. On macOS, choose **Done**, then **Open Anyway** in **System Settings → Privacy & Security**.

## Why Ruru?

Frigate is great at recording and detecting, but watching all your cameras at once, live, on a spare monitor or a wall display, shouldn't mean a browser tab full of lagging tiles. Ruru is a desktop app built for that one job:

1. **Enter your Frigate address.**
2. **Every camera appears**, live, within a second or two.
3. **Drag and resize** tiles until the wall looks right. Ruru remembers it.

Ruru is named after the ruru, the morepork: a small New Zealand owl that keeps watch through the night.

## What it does

<table>
<tr>
<td width="50%" valign="top">

### Sync from Frigate
Connect to your Frigate server once, and Ruru reads its camera list for you. Add a camera to Frigate and it shows up in Ruru. No stream URLs to copy, no camera passwords to type in twice.

</td>
<td width="50%" valign="top">

### Live, with as little delay as possible
Video plays straight from Frigate's built-in restreamer (go2rtc) over WebRTC, so what you see is close to real time, with MSE as a fallback where WebRTC is not available. The wall plays each camera's smaller sub stream, and a maximised camera its main stream. Ruru never decodes, copies or re-encodes your video itself.

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

- **Discovery:** the Rust backend reads your cameras and their streams from Frigate's HTTP API (`/api/version`, `/api/config` and `/api/go2rtc/streams`) when Ruru starts and whenever its window comes back into focus.
- **Playback:** each tile opens a WebRTC connection to the camera's stream on Frigate's go2rtc restreamer, the same path Frigate's own live view uses, and falls back to MSE. It shows the camera's latest snapshot until the video starts, reconnects on its own, and stops while the window is hidden. Video goes from Frigate to the tile without passing through Ruru's backend.
- **Layout and settings:** the Frigate address, full screen, and each server's tile positions and sizes are saved in `settings.json` in Ruru's config folder on your computer.

Nothing leaves your computer except requests to the Frigate server you point it at, and a check of Ruru's GitHub releases for updates. No analytics, no telemetry, no cloud account.

## Inspiration

Ruru is inspired by [CCTV Viewer](https://github.com/iEvgeny/cctv-viewer), a simple Qt app for watching many RTSP streams at once. Ruru takes the same idea and builds it around Frigate, so your cameras are found for you.

## Contributing

Ideas and bug reports are welcome. [Open an issue](https://github.com/kerwincarpede/ruru/issues) to get started.

## License

[MIT](LICENSE).
