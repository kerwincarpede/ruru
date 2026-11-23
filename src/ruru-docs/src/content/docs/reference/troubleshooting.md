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

## Ruru says Waiting for Frigate…

Frigate isn't answering yet, or answered with a server error such as HTTP 500. This is normal for a short while after a reboot, when Ruru starts before Frigate. Ruru keeps asking on its own, after 2, 5 and 10 seconds and then every 30 seconds, and fills the wall with your cameras as soon as Frigate answers. You don't need to click the wall or restart Ruru.

If the message stays for more than a few minutes, check that Frigate is running, then choose **Settings** and use **Test connection** to check the address. Test connection shows the full error.

## Ruru says it can't reach Frigate

Ruru can't read the cameras from the Frigate address in Settings. It keeps trying on its own, waiting longer after each failure up to every 30 seconds. The owl's heading says why:

- **Waiting for Frigate…**: see [Ruru says Waiting for Frigate…](#ruru-says-waiting-for-frigate).
- **Ruru can't reach Frigate**: the address isn't one Ruru can use. Check it in Settings.
- **Frigate turned Ruru away**: Frigate answered with an HTTP error, such as 401. Check the address, and that Frigate allows access without signing in on this port.
- **That doesn't look like Frigate**: something else answered. Check the address and port.

Choose **Settings** to fix the address and follow [Test connection fails](#test-connection-fails), or **Try again** once Frigate is back.

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

## Home Assistant's entities keep flipping

If the **Streams** switch, **Version** or **Update** in Home Assistant keep changing back and forth, two copies of Ruru are sharing one device id. Both connect to the broker under the same name, so each keeps pushing the other off. Opening Ruru again on the same computer only brings the running copy to the front, so the other copy is on another computer, usually one whose `settings.json` was copied, such as from a cloned SD card. On that computer, quit Ruru, delete `deviceId` under `mqtt` in [`settings.json`](/ruru/reference/settings/#where-settings-are-kept), then start Ruru and choose **Save** in **Settings → Home Assistant**. Ruru makes a new device id, and that computer shows up in Home Assistant as a device of its own.

## Windows or macOS warns about the app

Ruru isn't signed with a paid certificate, so SmartScreen and Gatekeeper warn the first time. See [Install](/ruru/get-started/install/) for the steps past it.

## Still stuck?

[Open an issue](https://github.com/kerwincarpede/ruru/issues) with your platform, Ruru version (in **Settings → Updates**) and what you see. Please don't attach pictures from your cameras.
