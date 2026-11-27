# Wall playback on Linux with synthetic streams

The second investigation used a stand-in Frigate with synthetic H.264 patterns on the Linux wall machine. The patterns made it possible to identify an individual frame on screen and compare it with the player’s timestamps. The owner’s cameras, display and MQTT broker were outside the test.

## Blank frames and jumps during activity

- Switching the wall’s fit container blanked tiles in 13 of 15 overview-to-hero or hero-to-overview changes. Keeping the container in place blanked none in five changes.
- A fixed-position takeover blanked the enlarged tile for three frames in two of five entries. The surrounding hero arrangement also changed when the takeover started.
- Automatic quality changes during hero and takeover entries switched streams and jumped 0.5–1.3 s in the footage. Picking the Automatic stream from the saved layout keeps the same stream as the tile moves.
- The layout library’s 200 ms slide made the page hitch during changes. Editing the layout still uses the transitions.

## Late frames and flashes during steady playback

- WebKitGTK’s `expectedDisplayTime` was at or after the callback timestamp. Subtracting the apparent delay therefore did not correct the samples. Across runs, 93–100% of reported lateness above 40 ms fell within 100 ms of an animation-frame gap over 40 ms.
- On `vah264dec`, playback lag of about 14 frames at 25 fps, 16 at 10 fps or 18–20 at 15 fps produced a distinctive flash. The frame on screen briefly jumped ahead by 16–20 frames. The flash rate ranged from 0.3 to 3.25 per second. Software decoding produced no such flashes, and rewriting the H.264 sequence parameter set did not fix the hardware flashes.
- Counting video frame callbacks missed frames the webview presented between callbacks. Treating that shortfall as a reason to pause repeatedly could push playback into the range where hardware flashes appeared.

The MSE player uses the reported number of frames presented, ignores lateness near main-thread hitches and lets playback settle after a view change or stream start. If more lag fails to improve frame timing or delivery, the player restores its earlier target and rests before trying again. The target is bounded by 12 measured frame intervals with a minimum cap of 0.5 s. A sustained dip below the target’s low-side margin allows the stream to get ahead before playing again.

For a steady run, collect the local `Ruru playback` journal lines. Each contains numeric counters for the MSE streams seen during the minute. Compare arrived and presented frames across the steady portion of the run, then check the synthetic frame numbers for hardware flashes. The counters include successful connections, pauses by reason, skips, late frames, worst lateness and the last measured lag. They carry no stream names or URLs and stay on the machine.

[The first investigation](late-frames-on-the-wall.md) describes the original measurements and the decoder’s first-frame hold-back.
