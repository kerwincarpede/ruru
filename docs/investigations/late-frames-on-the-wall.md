# Late frames on the wall: what we measured

This records an investigation into jerky playback on a Linux camera wall, made on 26 November 2026 against Ruru 0.16.0. It follows [Linux streaming glitches](linux-streaming-glitches.md), which removed the flicker but left some tiles jerky. The numbers come from one machine and one set of cameras, so treat them as a guide to scale, not as limits.

## The setup

- **Wall machine:** Ubuntu 26.04.1, GNOME on Wayland, Intel i5-6600T (4 cores) with HD 530 graphics. WebKitGTK 2.52.6 and `intel-media-va-driver` 26.1.2, so H.264 decodes on the GPU through `vah264dec`. Frigate 0.18.3 runs on the same machine, which was about 64% busy across its four cores.
- **Cameras:** ten. The wall plays two 1920×1080 main streams (12.5 and 25 frames a second) and eight 640×360 or 1280×720 sub streams (5 to 15 frames a second), all H.264 over MSE.
- **Dynamic wall:** on.

## Symptoms

- Some tiles moved in jerks, while others beside them were smooth.
- Which tiles were jerky changed from one day to the next.
- It seemed worse after the Dynamic wall changes.

## What was ruled out

- **The feed.** Twelve go2rtc streams, timed for 150 s each on the wall machine: every fragment in order, a keyframe every 1 to 2 s, and frames arriving at most 90 ms later than their timestamps said. Replaying the player's rules over those arrival times gave no pause and no skip on any stream.
- **A busy page.** The web process's main thread used about 16% of a core, and in the runs below it was never held up for more than 25 ms after the first seconds.
- **Software decoding.** No software decoder threads ran.
- **Skipping ahead.** No tile skipped in any run, so the change that lets a short burst of frames pass without a skip is not involved.

## Cause

### Playback starts with no room to spare

The hardware decoder holds each frame back until five to nine more have arrived (cause 3 in [Linux streaming glitches](linux-streaming-glitches.md#3-a-hardware-decoder-holds-frames-back-and-a-frame-that-is-ready-late-is-never-shown)). The first frame of a stream reached the screen once this much video had arrived:

| Stream's frame rate | Video that arrived before the first frame showed |
| --- | --- |
| 5 and 6 frames a second | 1.0 s |
| 10 and 12.5 | 0.46–0.67 s |
| 15 | 0.52–0.68 s |
| 25 | 0.32–0.68 s |

The player asked for 0.5 s of video before it started, and WebKitGTK then waited for that first frame. So a slow stream began exactly as far behind the newest frame as its decoder held frames back, and a faster one often began within a few hundredths of a second of it. Each later frame was ready at its turn or just after it, depending on when the frames after it arrived.

### A frame ready after its turn is shown late, not dropped

A frame that missed its turn by up to about 0.2 s was still shown, as soon as it was ready. The tile then held one frame too long and the next too briefly. On the two worst tiles in each run of the released player:

| Tile | Frames shown | Frames shown at the wrong time | Late by |
| --- | --- | --- | --- |
| 5 frames a second sub stream | 96.5–98.6% | 3–21% | 180–210 ms |
| 6 frames a second sub stream | 98.7–100% | 1–33% | 110–160 ms |
| 15 frames a second sub stream | 98% | 12% | 35–60 ms |

"At the wrong time" means the gap between two frames on screen differed from the gap between their timestamps by more than 25 ms. On the smooth tiles in the same runs that happened to 3 frames at most in 160 s.

### The player's own check could not see it

Every 4 s the player compared the frames shown with the frames that arrived, and stayed 0.2 s further behind when fewer than 90% were shown. These tiles showed 96–100% of their frames, so the check never acted, and they stayed jerky for as long as they played.

Two more faults in that check:

- Staying 0.2 s further behind only took effect when playback was within 0.05 s of where it started. A slow stream that began 1 s behind needed four rounds before anything changed.
- The distance was learned again on every connection.

### Why it changed from day to day, and with the Dynamic wall

- Whether a tile began just inside or just outside its decoder's delay depended on how its first frames happened to arrive. In four runs of the same player the jerky tiles were a 5 and a 15 frames a second one, then five tiles, then the 5 and 6 frames a second ones twice.
- The cameras' clocks run up to 360 parts in a million fast or slow against the wall's, so a tile's distance behind drifts by up to 1.3 s an hour. A smooth tile could drift into its decoder's delay and turn jerky.
- A single Dynamic wall hero is now 20 grid columns wide where it was 12: about 1593 pixels on a 1920-pixel wall, where it was about 954. **Automatic** plays the main stream once a tile is 960 pixels wide for a 640-pixel sub stream, so five of this wall's cameras now change stream when they become the hero and again when they stop. Each change is a new connection, which starts with no room to spare again.

## The fix

The player now checks each frame it shows, not only how many.

- `requestVideoFrameCallback` gives the frame's timestamp. A frame shown on time is reported 7–20 ms after its turn, and no more than 35 ms after in these runs. A late one is reported as late as it was.
- Every 4 s, if more than one frame and more than 5% of the frames shown were over 40 ms late, the player works out how far behind the late frames needed it to be: the least distance behind in those 4 s, plus the lateness, plus 0.1 s. It pauses once until it is that far behind. One late frame alone is ignored, and the worst frame is left out of the sum, because a busy page reports a frame late too.
- The distance is worked out from what was measured, not stepped, so a tile settles in one pause and does not creep further behind each time it drifts.
- Frames shown in the first second after playback starts, resumes or skips are not judged, while the decoder catches up.
- If the frames are still at least half as late at the next check, distance was not the cause: a busy computer shows frames late however far behind it plays. The player goes back to the distance it had and leaves late frames alone for 10 minutes, so it cannot creep further behind without helping.
- Each stream's distance is remembered for an hour, so a reconnect, or a change between the main and sub stream, starts there.
- The count of frames shown against frames arrived is still kept, for frames that are dropped without being shown.

Measured on the wall's own machine and cameras, the new player for 330 s and then the released one for 190 s, leaving out the first 20 s of each. Every player was stopped and started again 160 s into the new player's run, as a reconnect does.

| | Released player | New player | New player, after the reconnect |
| --- | --- | --- | --- |
| Seconds measured | 160 | 140 | 150 |
| Frames shown at the wrong time, whole wall | 323 of 20,559 | 37 of 17,998 | 15 of 19,288 |
| Worst tile | 31% of its frames, to the end | 2.9%, none after 70 s | 0.7%, none after 20 s |
| Tiles still jerky at the end | 1 | 0 | 0 |
| Frames shown | 98.6–100% | 99.9–100% | 99.9–100% |
| Pauses | 1 | 2 | 1 |
| Skips, backwards frames | 0 | 0 | 0 |
| Distance behind the newest frame, 10 to 25 frames a second | 0.5–1.0 s | 0.5–0.7 s | 0.5–0.75 s |
| Distance behind the newest frame, 5 and 6 frames a second | 1.0–1.3 s | 1.3 s | 1.3 s |

- In the new player's first 10 s, five tiles paused once each, the 5 and 6 frames a second ones among them. A 10 frames a second tile paused once at 35 s and the 5 frames a second tile once more at 65 s, and after that every tile was smooth.
- After the reconnect the 5 and 6 frames a second tiles started 1.3 s behind and did not pause. Two tiles that had not needed more distance before paused once each.
- In two earlier runs, a tile on a camera whose clock runs slow drifted into its decoder's delay. It showed 35 to 40 frames at the wrong time over 30 to 40 s, paused once and carried on smoothly.

## Not measured

- **The wall's own screen.** The runs used a second, headless display on the wall machine, while Ruru itself kept playing the same cameras on the real one. So the machine decoded every stream twice, and nothing was captured from the monitor.
- **Hours of playback.** The longest run of the player as merged was five and a half minutes, and of an earlier version of it ten. A stream whose clock drifts should need one short pause each time it drifts back into its decoder's delay, about every ten minutes at worst here, and that was seen only a few times.
- **A busy computer.** The rule that stops the player falling back when that does not help is covered by unit tests only.
- **Software decoding, Windows and macOS.** Their MSE players use the same logic and pass the unit tests. A decoder that holds nothing back shows no late frames, so nothing should change there.
- **A Raspberry Pi 5.**

## How it was measured

Real cameras were measured with counters only. No video was kept and nothing was captured from a screen.

- **Feed timing.** A Python script on the wall machine opened go2rtc's MSE WebSocket for each stream and read each fragment's `tfdt` and `trun` boxes in memory, with the time it arrived.
- **Player behaviour.** A GTK 3 window (`python3-gi`, WebKit2 4.1, the engine Tauri uses) loaded a page that ran Ruru's real `player.ts`, bundled with `rolldown`, on ten tiles of the wall's sizes. The page counted calls to `pause()` and changes of `currentTime`, and for every `requestVideoFrameCallback` compared the frame's timestamp with the play position and with the frame before it.
- **Display.** The window ran on its own display: `gnome-shell --headless --virtual-monitor 1920x1080` under `dbus-run-session`, with its own `XDG_RUNTIME_DIR` and `HOME`. Hardware decoding and WebKit's DMABuf renderer work there as they do on the monitor.
- **Reconnects** were made by stopping and starting every player in the page.

## Follow-ups

1. Start a stream's first connection far enough behind, from how much video arrived before its first frame showed, so it does not need the first pause.
2. Let a tile come closer again when its frames have room to spare, so a tile that fell back while the machine was busy does not stay there until it reconnects.
3. Show frames shown late in the stream info overlay.
4. Measure the wall's own screen for some hours.
