---
title: Troubleshooting
description: Fixes for the most common Ruru problems.
sidebar:
  order: 3
---

## Test connection fails

- Check that the address opens Frigate in a browser on the same computer.
- Use Frigate's unauthenticated port, usually 5000, not the login port 8971. Ruru can't log in to Frigate yet.
- If Frigate runs in Docker, its container must publish port 5000.
- Include `http://` and the port, such as `http://frigate.local:5000`.

## A camera is missing

Ruru shows the cameras Frigate has. Check that the camera is in Frigate's config, then switch to another window and back to Ruru: it reads the camera list again when its window comes back into focus.

If the camera is there but hidden, choose **Edit layout** and then **Show** with the camera's name.

## A tile says **Reconnecting** or **Frozen**

The camera's stream dropped or stopped moving, and Ruru is getting it back. Check the camera in Frigate's own live view. Right-click the tile and choose **Reconnect** to start it again by hand. See [When a picture stops](/ruru/wall/watch/#when-a-picture-stops).

## A tile says **Can't play this stream**

The stream's video doesn't play on this computer, often because of its codec. If the camera has a second stream, Ruru plays that instead and says so. Otherwise, set the camera to send H.264, which every platform plays.

## The wall lags or drops frames

- Turn on **Show stream info** to see each tile's frame rate and dropped frames.
- Big walls of main streams are hard work. Leave tiles on **Automatic**, or choose **Sub stream** on small ones.
- Hide cameras you don't need.

## Linux: video is a second or so behind

Most Linux distributions build their webview without WebRTC, so Ruru plays over MSE, which buffers a little. That delay is expected. **Show stream info** shows **MSE** on each tile.

## Linux: high CPU use

Ruru plays video through GStreamer, which decodes on the graphics card only with a VA-API driver. Without one, every stream is decoded in software. On Intel graphics, install `intel-media-va-driver`; on Debian and Ubuntu, `va-driver-all` covers the common drivers.

## Windows or macOS warns about the app

Ruru isn't signed with a paid certificate, so SmartScreen and Gatekeeper warn the first time. See [Install](/ruru/get-started/install/) for the steps past it.

## Still stuck?

[Open an issue](https://github.com/kerwincarpede/ruru/issues) with your platform, Ruru version (in **Settings → Updates**) and what you see. Please don't attach pictures from your cameras.
