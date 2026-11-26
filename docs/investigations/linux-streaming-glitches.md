# Linux streaming glitches: what we measured

This records an investigation into flicker and backwards-jumping timestamps on a Linux camera wall, made on 22–23 November 2026 against Ruru 0.1.2. It says what caused each symptom, how each cause was proved, what the fix does, and what was tried and rejected. The numbers come from one machine and one set of cameras, so treat them as a guide to scale, not as limits.

## The setup

- **Wall machine:** Ubuntu 26.04, GNOME on Wayland, Intel i5 Skylake (4 cores) with HD 530 graphics, one 1920×1080 monitor at 60 Hz during the tests. WebKitGTK 2.52.6 (`libwebkit2gtk-4.1`), GStreamer 1.28, and `intel-media-va-driver`, so H.264 decodes on the GPU through `vah264dec`.
- **Cameras:** ten, each with a 1920×1080 main stream and a 640×360 or 1280×720 sub stream, all H.264 with no B-frames, restreamed by go2rtc 1.9.13 in Frigate 0.18.3.
- **Layout measured:** two main streams and eight sub streams, and then ten main streams.
- **Playback path:** MSE only. Ubuntu's WebKitGTK is built without WebRTC, so `RTCPeerConnection` does not exist, whatever the webview settings say.

## Symptoms

- Tiles flickered.
- The cameras' burned-in timestamps sometimes jumped backwards.
- Playback felt worse than the cameras' frame rates should allow.

## Causes

### 1. Every change of `playbackRate` restarts WebKitGTK's decoder

The player used to speed playback up to 1.08 when it was more than 1.5 s behind the newest frame and slow it to 0.95 when it was less than 0.35 s behind. A tile whose lag sat near either threshold flipped between rates all the time, because each arriving frame moves the lag by a whole frame interval.

WebKitGTK carries out a rate change as a flushing seek in GStreamer. The decoder restarts from the previous keyframe.

| Evidence | Result |
| --- | --- |
| Real layout on the wall, 3 minutes, old player | maingate: 83 rate changes and 40 decoder restarts. driveway: 13 and 7. |
| Synthetic stream on the wall, screen captured at 60 fps, rate left alone | 0 blank screen frames in 30 s |
| The same, with the rate toggled every 3 s | The 25 fps tile went transparent for 1–2 screen frames at 6 of 10 toggles, each time exactly at the toggle |
| The same, with a white box behind the video | The white showed through at those moments: the video element stops painting and the page behind it is visible |

In Ruru the element behind a tile's video is the camera's snapshot, fetched when the cameras were last loaded. So each restart flashed a picture that could be hours old, with its old burned-in time. That is both the flicker and most of the backwards timestamps.

### 2. At a rate other than 1, WebKitGTK can show a frame twice

With the old player holding 1.08 on a 5 fps synthetic stream, the wall's screen showed frame 2332, then frame 2331 again for about 150 ms, then 2332. `requestVideoFrameCallback` reported `mediaTime` going backwards at the same moments (34.20 s, then 34.03 s).

With software decoding the same rate did worse. A 5 fps stream held at 1.08 painted 2–13 frames in each 10 s, where 50 arrived, with freezes of 2–5 s. The player then saw the tile fall 5 s behind, skipped ahead again and again, marked it stalled (which dims it) and reconnected it.

### 3. A hardware decoder holds frames back, and a frame that is ready late is never shown

On the wall, four 15 fps sub streams showed 9–11.6 frames a second and a 6 fps one showed 5.1. `getVideoPlaybackQuality()` still counted every frame as decoded and none as dropped, so the stream info overlay looked right.

`vah264dec` holds each frame of these Main-profile streams until about six more have arrived. In a pipeline that is not marked live, GStreamer's H.264 decoders do not output frames early. A frame is then ready about six frame intervals after it arrives: 0.4 s at 15 fps, 1 s at 6 fps. If playback is closer to the newest frame than that, the frame's turn has passed and the sink discards it.

| Evidence | Result |
| --- | --- |
| One pause of 0.5 s, 40 s into playback | garage_sub and front_yard_sub went from 9 to 15 fps and backyard_sub from 5 to 6, and stayed there |
| A pause of 1 ms | Fixed only the tiles whose lag happened to move past the threshold |
| The same streams with software decoding | All 15 frames shown at 0.6 s behind |

Streams whose decoder holds nothing back (Baseline profile, or High with reordering switched off in the stream) showed every frame at 0.4 s behind.

### 4. A hardware-decoded video cannot be copied to a canvas

`drawImage(video)` on the wall gives a fully transparent canvas. Ruru's tile keeps a "frozen frame" on a canvas while a stream reconnects, so on this machine that frame is empty and the old snapshot shows instead. This is not fixed yet.

### What was ruled out

- **The feed.** All 20 go2rtc streams, read for 90 s each: every one starts on a keyframe, with one frame in each fMP4 fragment, no backward or broken decode times, no composition offsets, and less than 0.1 s of drift from the wall clock.
- **B-frames.** None on any camera.
- **Old frames after a seek.** Skipping ahead with `currentTime` painted no blank and no older frame in the captures.
- **Pausing.** `pause()` followed by `play()` restarts the decoder too, but painted no blank and no older frame in 15 tries.

## The fix

The MSE player now plays at normal speed and never changes `playbackRate`.

- Playback starts once 0.5 s of video has arrived.
- More than 1.5 s behind the newest frame, it skips to 0.5 s behind, once, and then leaves playback alone for 5 s.
- Less than 0.35 s behind, it pauses until it is 0.5 s behind again.
- Every 4 s it compares the frames that arrived with the frames `requestVideoFrameCallback` reported as shown. If fewer than 90% were shown, it stays 0.2 s further behind, up to 2 s more. A webview that reports no frames at all is left alone. This check missed tiles that showed nearly every frame, but late. [Late frames on the wall](late-frames-on-the-wall.md) records that and the check that replaced it.
- The snapshot is hidden while a tile plays, so nothing old can show through.

Measured on the wall with the real layout for 15 minutes:

| | Old player | New player |
| --- | --- | --- |
| Rate changes | 83 on one tile in 3 minutes | 0 |
| Skips ahead | — | 0 |
| Backwards presentation times | Seen at 1.08 | 0 |
| Pauses to fall back | — | At most 1 on each tile |
| 15 fps sub streams shown | 9–11.6 fps | 15.0 fps |
| Every tile, share of source frames shown | 60–100% | 98–100% |
| Distance behind the newest frame | 0.2–1.6 s | 0.3–1.4 s |

A 2.5 s network stall, made by pausing a stand-in go2rtc, produced one or two skips on each tile and no blank or repeated frame on screen.

## What the wall costs

Full screen, with the new player. CPU is a share of 400% (four cores). GPU figures are how busy each engine was, from the `i915` counters.

| Setup | Machine | WebKit web process | Kernel | Render engine | Video engine | Frames shown |
| --- | --- | --- | --- | --- | --- | --- |
| 2 main + 8 sub, default renderer | 201% | 54% | 36% | 37% | 21% | 97–100% |
| 10 main, default renderer | 230% | 79% | 48% | 37% | 48% | 99–100%, 25 fps each |
| 2 main + 8 sub, `WEBKIT_DISABLE_DMABUF_RENDERER=1` | 226% | 158% | 30% | 6% | 16% | not countable |
| 10 main, `WEBKIT_DISABLE_DMABUF_RENDERER=1` | 274% | 203% | 30% | 5% | 26% | not countable |

- **Main streams everywhere are affordable on this machine:** 29 points more CPU for 252 frames a second instead of 142.
- **Leave the DMABuf renderer on.** Without it the web process uses about three times the CPU, and `requestVideoFrameCallback` never fires, so frames shown cannot be counted.
- These figures include the measuring page's own per-frame callbacks and a `perf` counter session, so the app alone costs a little less.

## WebCodecs, tried and set aside

A prototype read the same fMP4 WebSocket, split it into H.264 access units, decoded them with `VideoDecoder` and drew each `VideoFrame` to a 2D canvas.

| Test on the wall | Machine | Web process | Video engine | Result |
| --- | --- | --- | --- | --- |
| Synthetic 5 and 25 fps streams, screen captured | — | — | — | Every frame painted in order, no blanks, 30–50 ms from arrival to screen at 25 fps |
| 10 main, decode only, nothing drawn | 137% | 41% | 54% | Every frame decoded, 0–0.26 s after it arrived |
| 2 main + 8 sub, drawn | 192% | 133% | 14% | Mains showed 57–75% of their frames; subs 99–100% |
| 10 main, drawn | 217% | 151% | 16% | 28–36% of frames, 1–2 s late |
| 10 main, canvas sized to the tile | 222% | 158% | 23% | 30–36% of frames |

- **It decodes on the GPU.** The video engine was 54% busy with ten main streams and the Intel driver was loaded in the web process.
- **Drawing is the limit.** Each `drawImage` of a 1080p frame costs about 11 ms on the page's main thread, whatever the canvas size, so ten main streams get about 90 frames a second between them.
- `hardwareAcceleration: "prefer-software"` changed nothing.
- One main stream gave `EncodingError: Decode error` on its first frame.
- With no buffer, late and bunched frames from the network go straight to the screen.

WebCodecs would need another way to present frames, such as WebGL or a canvas in a worker for each tile, before it could carry a wall. Neither was tried.

## Not measured

- **Raspberry Pi 5.** It has no H.264 hardware decoder, so every stream is decoded in software. Nothing was run there. The only figure is that Frigate's own sub stream decoders use 2–5% of a core each at its detection frame rate. WebKitGTK 2.50 on arm64, and drawing on V3D under `cage` or `labwc`, are untested.
- **The new player with software decoding.** The logic does not depend on the decoder, and the faults in the old player were reproduced with software decoding, but the new player was only run with hardware decoding.
- **Windows and macOS over MSE.** They use WebRTC first. Their MSE fallback now uses the same logic and passes the unit tests, but was not run on those systems.
- **X11.** Earlier figures showed `GDK_BACKEND=x11` costing more than Wayland, so it was not repeated.

## How it was measured

Real cameras were measured with counters only. Anything captured from the screen was a synthetic test pattern.

- **Feed timing.** A Node script opened go2rtc's MSE WebSocket for each stream and read the `tfdt` and `trun` boxes of each fragment in memory, without keeping any video.
- **Player behaviour.** A small GTK 3 window (`python3-gi`, WebKit2 4.1, the same engine Tauri uses) loaded a page that ran Ruru's real `player.ts`, bundled with `rolldown`, on a grid of tiles. The page logged rate changes, seeks, waits, decoded-frame counter resets, the distance behind the newest frame, and each `requestVideoFrameCallback`. It ran under `xvfb-run` on a development machine and in the wall's Wayland session through `systemd-run --user`.
- **Source frame rates** were read from go2rtc at the same time as each run, because some cameras change rate through the day.
- **What the screen showed.** A stand-in go2rtc served `ffmpeg` test patterns at 5 and 25 fps with the frame number drawn as 16 black or white blocks along the top. The wall's monitor was recorded at 60 fps through `org.gnome.Mutter.ScreenCast` into `pipewiresrc`, and a script read the frame number and checked for blank tiles in every recorded frame. Mutter gives no frames while a window is full screen, so these runs used a normal window.
- **Network stalls** were made by sending `SIGSTOP` to the stand-in go2rtc for 2.5 s.
- **CPU** came from `/proc/stat` and each process's `/proc/<pid>/stat` over 60 s. **GPU** came from `perf stat -a -e i915/rcs0-busy/,i915/vcs0-busy/`.

## Follow-ups

1. Keep a usable frozen frame when the video is hardware decoded, or fetch a new snapshot when a stream drops.
2. Let **Automatic** weigh what the machine can decode, not only the tile's size: main streams everywhere on a machine like this one, sub streams on one with no hardware decoder.
3. Have the `.deb` recommend a VA-API driver (`va-driver-all`).
4. Show frames presented in the stream info overlay, next to frames decoded, so missing frames can be seen.
5. Measure a Raspberry Pi 5.
