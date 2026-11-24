<div align="center">

# Ruru

### Eyes on every camera.

**A fast, free, low-latency camera wall for [Frigate](https://frigate.video/), on Windows, macOS and Linux.**<br>
Point it at your Frigate server, and every camera is live on one screen, laid out how you want.

<a href="LICENSE"><img alt="MIT license" src="https://img.shields.io/badge/license-MIT-blue"></a>

**[Read the Ruru guide →](https://kerwincarpede.github.io/ruru/)**

</div>

---

## Get started

1. Open Ruru and choose **Connect to Frigate**.
2. Enter the address you open Frigate at, such as `http://frigate.local:5000`, choose **Test connection** to check it, then **Save**.
3. Every camera appears on the wall and plays live.

Open **Settings** again from the gear at the top right (it shows when you move the pointer), with `Ctrl+,` (`⌘ ,` on macOS), or from the menu you get by right-clicking the wall.

Ruru connects to Frigate's unauthenticated port, usually 5000. Logging in to Frigate's port 8971 is not supported yet.

### Using the wall

- **Double-click** a tile, or right-click it and choose **Maximise**, to fill the window with that camera. The picture keeps moving and sharpens once the main stream arrives. Double-click again, choose **Restore** or press `Esc` to go back.
- **Right-click** a tile for that camera's menu: **Maximise** or **Restore**, **Reconnect**, **Hide**, **Show stream info**, and its stream. The wall's own items follow below. The arrow keys move through the menu and `Esc` closes it.
- Choose **Edit layout** to drag tiles, resize them from their corners, or **Hide** them. **Lock to 16:9** keeps a tile widescreen as you resize it. Untick it to resize freely. **Fit to window**, on by default, shrinks the wall so every tile fits the window without scrolling; it is also in the right-click menu. **Reset to Frigate order** puts every camera back and clears stream choices. Choose **Done** when the wall looks right. Ruru remembers the layout for each Frigate server, and **Lock to 16:9**, **Fit to window** and **Show stream info** for next time.
- A tile whose picture stops moving dims its last frame and says how old it is, such as **Reconnecting · 12 s old**, until new video arrives. After 30 seconds, or straight away when it has no frame to keep, the tile shows the Ruru owl and **Reconnecting…** instead of an old picture. When more than half the wall has been reconnecting for 10 seconds, such as while Frigate restarts, the whole window says **Reconnecting to Frigate** until the cameras come back.
- With **Settings → Home Assistant** on, each tile shows what Frigate sees: a yellow mark while there is motion, a chip such as **Person** for each kind of object moving, and a red mark with **Alert** in the caption during an alert. Pick how tiles are marked with **Activity style** in **Settings → Appearance**. Turn it off with **Show activity** in the right-click menu or in **Settings → Appearance**.
- Press `F11` (`Ctrl+⌘ F` on macOS), or right-click and choose **Enter full screen**, to fill the screen. Ruru starts full screen next time if you left it that way.

## Download

Download the installer for your platform from the [latest release](https://github.com/kerwincarpede/ruru/releases/latest): `.msi` or `-setup.exe` for Windows, the universal `.dmg` for macOS, and `.AppImage`, `.deb` or `.rpm` for Linux. Ruru checks for a newer release when it starts and asks before installing it.

On Linux you can install the latest Stable release with one command. It uses the `.deb` on Debian and Ubuntu, the `.rpm` on Fedora and openSUSE, and the `.AppImage` anywhere else:

```sh
curl -fsSL https://raw.githubusercontent.com/kerwincarpede/ruru/main/install.sh | sh
```

Set `RURU_FORMAT` to `deb`, `rpm` or `appimage` to choose the installer, or `RURU_VERSION` (for example `0.1.2`) to install a specific release. The package installs ask for your password through `sudo`. The AppImage goes in `~/.local/bin` and needs no password.

### Stable and Edge

Ruru updates from one of two channels. Pick one with **Update channel** in **Settings → Updates**, which also shows the version you have and has **Check for updates**.

- **Stable** (default): get updates after they've been tried on Edge.
- **Edge**: get every change as soon as it's built, from each merge to `main`. You may run into bugs. **Edit layout** and **Settings → Updates** show **Edge** next to the version, such as **Ruru 0.4.0 · Edge**.

Switching channel checks the new one straight away. Ruru never installs an older version, so moving from Edge back to Stable keeps the version you have until Stable passes it. Every Edge build is also on the [releases page](https://github.com/kerwincarpede/ruru/releases) as a pre-release.

### Automatic updates

Ruru asks before it installs an update. To skip the question, turn on **Install updates automatically** in **Settings → Updates**. Ruru then checks your channel at startup, every 6 hours and as soon as you turn it on, and installs a newer version and restarts on its own. Your layout and full screen come back as they were. On Linux, the `.deb` and `.rpm` installs still ask for your password to update; the AppImage does not.

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
Video plays straight from Frigate's built-in restreamer (go2rtc) over WebRTC, so what you see is close to real time, with MSE as a fallback where WebRTC is not available. On Linux that is the usual case: most distributions, Ubuntu and Debian among them, build their webview (WebKitGTK) without WebRTC, so tiles play over MSE, half a second to a second or so behind the camera. When a server's WebRTC does not connect, Ruru uses MSE for that server for the next 10 minutes, then tries WebRTC again. With **Automatic**, each tile plays the camera's smaller sub stream until the tile is about one and a half times wider, in screen pixels, than the sub stream's picture, and then its main stream. The menu shows which one Automatic is playing, such as **Automatic (Main)**. Right-click a camera that has both feeds and choose **Main stream** or **Sub stream** to always use that feed. If a stream will not play on your computer, the tile shows the camera's other stream and says so, such as **Main stream can't play · showing sub stream**, without changing your choice. Ruru never decodes, copies or re-encodes your video itself.

Right-click a tile and choose **Show stream info** to see playback diagnostics on every tile. The overlay shows the stream name, connection type, picture size and displayed frames per second. Dropped frames are counted over the last sample (about one second). A dash means no measurement is available yet. For MSE, seconds buffered is the distance to the end of the received video, not the delay since the camera captured it. Low FPS with few drops can be a low-rate source; try the main stream on that tile. If dropped frames increase, try the sub stream instead.

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
- **Home Assistant:** when you turn it on in **Settings → Home Assistant**, Ruru connects to the MQTT broker that Home Assistant uses and shows up there as a device, with its version, the maximised camera, whether it is full screen and shown, and a problem sensor for each camera on the wall. Home Assistant can maximise a camera, restore the wall, turn full screen on or off, stop or start every stream, and install a pending update, after which Ruru restarts full screen. Its **Display** switch turns the screen off and on, on Windows, macOS, and Linux with X11 (`xset`) or a wlroots compositor such as labwc (`wlopm`). On the same broker it follows Frigate's motion, object and review topics to draw activity on the tiles.
- **Layout and settings:** the Frigate address, full screen, the wall options, the update channel, whether updates install automatically, the Home Assistant connection, and each server's tile positions and sizes are saved in `settings.json` in Ruru's config folder on your computer. The broker password goes in your computer's keychain, or in `settings.json` when there is no keychain Ruru can use.

Nothing leaves your computer except requests to the Frigate server you point it at, a check of Ruru's GitHub releases for updates, and, only if you turn it on, the connection to your MQTT broker. No analytics, no telemetry, no cloud account.

## Inspiration

Ruru is inspired by [CCTV Viewer](https://github.com/iEvgeny/cctv-viewer), a simple Qt app for watching many RTSP streams at once. Ruru takes the same idea and builds it around Frigate, so your cameras are found for you.

## Documentation

| | |
| --- | --- |
| 📘 [Get started](https://kerwincarpede.github.io/ruru/get-started/) | Install Ruru and connect it to Frigate |
| 🧱 [The wall](https://kerwincarpede.github.io/ruru/wall/) | Watch, arrange and choose streams |
| 🍓 [Raspberry Pi 5](https://kerwincarpede.github.io/ruru/guides/raspberry-pi/) | Run the wall on the Pi that runs Frigate |
| 🏠 [Home Assistant](https://kerwincarpede.github.io/ruru/guides/home-assistant/) | Show and control the wall in Home Assistant as a device |
| ⌨️ [Keyboard shortcuts](https://kerwincarpede.github.io/ruru/reference/keyboard-shortcuts/) | Every key, on every platform |
| 🛟 [Troubleshooting](https://kerwincarpede.github.io/ruru/reference/troubleshooting/) | Fixes for the most common problems |
| 🛠️ [Developing Ruru](docs/development.md) | Build from source, run the checks, and contribute |

## Contributing

Ideas and bug reports are welcome. [Open an issue](https://github.com/kerwincarpede/ruru/issues) to get started.

## License

[MIT](LICENSE).
