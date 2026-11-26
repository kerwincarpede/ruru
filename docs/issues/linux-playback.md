# Linux playback

Status: partly fixed. The flicker and the backwards timestamps came from the MSE player changing `playbackRate`, and the player no longer does. [Linux streaming glitches: what we measured](../investigations/linux-streaming-glitches.md) has the causes, the proof and the numbers, and answers the questions below about timestamps, flicker, WebCodecs and `WEBKIT_DISABLE_DMABUF_RENDERER`. Tiles that stayed jerky came from frames shown after their turn, and the player now measures that and stays far enough behind: see [Late frames on the wall: what we measured](../investigations/late-frames-on-the-wall.md). The Raspberry Pi 5 and how **Automatic** should choose a stream are still open. The rest of this page is the problem as first described.

Ruru plays worse on Linux than on Windows and macOS. This page collects what we have seen, what we have measured, and what we still need to find out. Any fix must also work on a Raspberry Pi 5 (see [Running Ruru on a Raspberry Pi 5](https://kerwincarpede.github.io/ruru/guides/raspberry-pi/)).

## The machine

The wall PC where the problem was measured:

- Ubuntu 26.04, GNOME on Wayland
- Intel Core i5 (Skylake) with HD 530 graphics, 4 cores
- Two 1080p monitors at 60 Hz
- 10 Frigate cameras on the wall

## Symptoms

- Playback feels poor next to Windows and macOS.
- Tiles flicker.
- The timestamps the cameras burn into their video sometimes jump backwards, as if older video is shown again.
- CPU use is high.

## Findings so far

### WebRTC is not available

Ubuntu's and Debian's WebKitGTK are built without WebRTC (`ENABLE_WEB_RTC` off). On WebKitGTK 2.52.6, `RTCPeerConnection` is undefined even with the `enable-webrtc` setting turned on before the page loads. This holds on `http`, `https` and `tauri://` origins, and WebKit's feature list has no peer-connection flag.

So Ruru always plays over MSE on these systems. **Show stream info** shows **MSE**, not **MSE fallback**, because the player only says "fallback" when `RTCPeerConnection` exists (`src/ruru/src/wall/player.ts`).

Some of our own text says more than this. The comment at the top of `src/ruru/src-tauri/src/webview.rs`, the README ("Live, with as little delay as possible") and the Linux note in [docs/development.md](../development.md#connecting-to-frigate) read as if turning the setting on gives WebRTC on Linux. On these builds it does not. Correcting them is a follow-up.

### No hardware decoding without a VA-API driver

WebKitGTK plays video through GStreamer, which needs a VA-API driver to decode on the GPU. For Intel graphics that is `intel-media-va-driver`.

- **Without the driver**, every stream is decoded in software. WebKitWebProcess uses about 200% CPU (of 400% on 4 cores).
- **With the driver**, GStreamer loads `vah264dec`, no software decoder threads run, and decoding costs a fraction of that.

Ruru's `.deb` does not ask for a VA-API driver today. One option is to add `Recommends: va-driver-all`.

### Ruru already shows every frame the cameras send

With **Show stream info** on, each tile's displayed FPS matched its stream's source rate, with 0 dropped frames.

| Stream | Picture | Source rate |
| --- | --- | --- |
| Sub streams | varies | about 4.5–15 FPS |
| Main streams | 1920×1080 H.264 | about 11–26 FPS, 2–4× the sub streams |

So low frame rates on **Automatic** mostly come from the sub streams' own rate. With frames kept on the GPU, the wall PC decoded 8 more 1080p main streams at full rate, with no drops, for about 29% CPU.

### Drawing now costs more than decoding

With hardware decoding, Ruru full screen and WebKit's default renderer, the machine uses about 141–217% of its 400% CPU:

| Process | CPU |
| --- | --- |
| Kernel | 45–117% |
| WebKit | 62–91% |
| Ruru UI process | 18–70% |
| gnome-shell | about 29% |

A profile of the UI process shows most of its time in Mesa's EGL. The kernel is allocating and zeroing fresh GPU buffer pages, and cairo and pixman copy whole frames. This looks like WebKitGTK (GTK 3) allocating and reading back a full-window frame on nearly every refresh, because ten videos that are not in step keep changing the page.

Machine CPU with different WebKit and GTK switches:

| Variant | Machine CPU (of 400%) |
| --- | --- |
| Default | 141% |
| `WEBKIT_DISABLE_DMABUF_RENDERER=1` | about 96% (kernel about 4%) |
| `GDK_BACKEND=x11` | 160% |
| `GDK_BACKEND=x11` and `WEBKIT_DISABLE_DMABUF_RENDERER=1` | 147% |

We have not yet checked whether the wall looks as good and plays as smoothly with `WEBKIT_DISABLE_DMABUF_RENDERER=1`.

### MSE adds 1–2 seconds of delay

MSE keeps seconds of video buffered, so about 1–2 seconds of delay is part of how it works. WebRTC avoids most of it, which is why Ruru prefers it elsewhere.

## Open questions

### Why do timestamps jump backwards?

Suspects:

- How the player chases the live edge over MSE: changing `playbackRate`, skipping ahead and trimming the buffer (`src/ruru/src/wall/player.ts`).
- A reconnect appending video again from an older keyframe.
- The swap from snapshot to video, and from sub stream to main stream.
- The decoder reordering frames, or joining a stream partway through a group of pictures.

### Why do tiles flicker?

Suspects:

- The DMABuf renderer and how WebKit composites the page.
- `<video>` elements being mounted again, or the dimmed last frame shown for a stale tile.

### Could WebCodecs replace MSE on Linux?

WebKitGTK 2.52.6 has `VideoDecoder`, and `VideoDecoder.isConfigSupported` reports 1080p H.264 as supported, with hardware decoding preferred. A WebCodecs mode would:

- read the same go2rtc fMP4 WebSocket that MSE uses
- decode with `VideoDecoder` and draw each frame to a canvas
- have no MSE buffer and no live-edge chasing
- fall back to MSE where it cannot play

It would start behind a toggle on the wall. This is the preferred first experiment, not a decision.

### Should Ruru set WebKit switches at startup on Linux?

For example `WEBKIT_DISABLE_DMABUF_RENDERER=1`, once its picture quality and smoothness are checked. Any switch has to be safe on every Linux desktop Ruru supports, X11 and Wayland.

### How should Automatic choose between main and sub streams?

When decoding is cheap (a GPU with a VA-API driver), main streams cost little more than sub streams. When it is expensive (software decoding, or a Raspberry Pi 5), they cost a lot more. Automatic picks by tile size today and does not know which case it is in.

### Other ways to get WebRTC

Each of these was considered and each is costly. None is planned.

- A custom or Flatpak WebKitGTK built with WebRTC.
- A native GStreamer pipeline with `webrtcbin` in the Rust backend.
- A Chromium-based engine such as CEF.

## Follow-ups already known

- Correct the WebRTC wording in `src/ruru/src-tauri/src/webview.rs`, the README and [docs/development.md](../development.md).
- Decide whether the `.deb` should recommend a VA-API driver.
