---
title: Streams and playback
description: How Ruru plays each camera with as little delay as possible, how it picks the main or sub stream, and what stream info shows.
sidebar:
  order: 3
---

Ruru plays video straight from Frigate's built-in restreamer, go2rtc, the same path Frigate's own live view uses. Video goes from Frigate to the tile without passing through anything else. Ruru never decodes, copies or re-encodes your video itself.

## WebRTC and MSE

Each tile plays over **WebRTC** first, so what you see is close to real time. Where WebRTC isn't available, it plays over **MSE** instead, which buffers a little and runs about half a second to a second or so behind the camera.

- When a server's WebRTC does not connect, Ruru uses MSE for that server for the next 10 minutes, then tries WebRTC again.
- On Linux, MSE is the usual case. Most distributions, Ubuntu and Debian among them, build their webview (WebKitGTK) without WebRTC.

MSE plays at normal speed through short bursts of incoming frames. If the tile stays behind for a second, it can skip ahead to catch up. If it falls more than five seconds behind, it catches up immediately.

Some computers' video decoders hold each frame back until several more have arrived. On a slow stream, such as one at 5 frames a second, that can be more than a second, and frames would reach the screen after their turn, which makes the picture jerk. When Ruru sees frames shown late, the tile pauses for a moment, once, and then plays further behind, by as much as those frames needed and at most two seconds more. Ruru remembers this for each stream for an hour, so a tile that reconnects or changes stream starts at the right distance.

## Main and sub streams

Most cameras send two streams: a full-size main stream for recording and a smaller sub stream for detection. Ruru finds both from Frigate's config. A camera with only one stream uses it for both.

Right-click a tile that has both to choose which one it plays:

- **Automatic** (the default): the tile plays the sub stream until it is about one and a half times wider, in screen pixels, than the sub stream's picture, and then the main stream. The menu shows which one Automatic is playing, such as **Automatic (Main)**. A maximised tile counts as the width of the window, so on **Automatic** it usually plays the main stream.
- **Main stream** or **Sub stream**: always play that stream on this tile.

If a stream won't play on your computer, the tile shows the camera's other stream and says so, such as **Main stream can't play · showing sub stream**, without changing your choice.

**Reset to Frigate order** in [**Edit layout**](/ruru/wall/arrange/) clears every tile's stream choice.

## Stream info

Choose **Show stream info** in **Settings → Appearance** or in a tile’s right-click menu to see playback details on every tile:

| Shows | Meaning |
| --- | --- |
| **fps** and state | Frames shown per second, and whether the tile is playing, stalled or reconnecting. A dash means no measurement yet. |
| **WebRTC** or **MSE** | How the tile is connected. |
| Stream name and size | The go2rtc stream it plays, and its picture size, such as `front_door · 1920×1080`. |
| **dropped / sample** | Frames dropped over the last sample, about one second. |
| **s buffered** | MSE only: the distance to the end of the video received so far. It isn't the delay since the camera captured the frame. |

Reading it:

- Low fps with few drops can simply be a low-rate camera stream. Try the main stream on that tile.
- If dropped frames climb, the computer is struggling. Try the sub stream instead.

Choose **Show stream info** again to hide it.
