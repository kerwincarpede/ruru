# Running Ruru on a Raspberry Pi 5

This page covers running the Ruru wall on the same Raspberry Pi 5 that runs Frigate, so one small computer records the cameras and shows them on a monitor.

Status: not yet verified end to end. Steps marked **not yet verified** have not been tried on a Pi 5 running Frigate. [What still needs checking](#what-still-needs-checking) lists them. Linux playback has known problems that apply here too, see [Linux playback](issues/linux-playback.md).

## The starting point

This guide assumes a Pi set up like this:

- Raspberry Pi 5 with 8 GB of RAM
- Raspberry Pi OS based on Debian 13 (trixie), from the Raspberry Pi apt archive, with its 6.12 kernel and 16 KB memory pages
- Frigate 0.18 in Docker (`frigate:<version>-standard-arm64`) with a Coral detector, recording 10 cameras
- No desktop: it boots to `multi-user.target`, with no WebKit installed and no monitor on HDMI

On such a Pi, Frigate uses about 1.0–1.4 of the 4 cores. The Pi is about 60% idle with about 4.3 GB of RAM free. That leaves Ruru about 2 cores, and Frigate needs some headroom on top of what it uses on average.

## What the Pi 5 can and cannot do

### H.264 is decoded in software

The Pi 5 has no hardware H.264 decoder. Its only video decoder is for H.265 (HEVC): `rpi-hevc-dec`, a stateless V4L2 decoder that GStreamer uses through `v4l2slh265dec` from `gstreamer1.0-plugins-bad`. There is no VA-API.

So every H.264 tile is decoded on the CPU. Frigate's `preset-rpi-64-h264` hardware acceleration preset does not change this on a Pi 5.

What to expect:

- Sub streams on every tile.
- The main stream only on the tile you maximise.

| Stream | CPU per stream on a Pi 5 |
| --- | --- |
| H.264 sub stream | TBD |
| H.264 1080p main stream | TBD |

### H.265 main streams

If your cameras can send their main stream as H.265, the Pi could decode it in hardware. This is an option, not a recommendation: it changes what Frigate records, and many browsers cannot play H.265, which affects Frigate's own web UI. Whether WebKitGTK on the Pi plays H.265 over MSE with the hardware decoder is not yet verified.

### WebKitGTK and WebRTC

Debian trixie has WebKitGTK 2.50.4 (`libwebkit2gtk-4.1-0`) and GStreamer 1.26.2. Assume it has no WebRTC, so Ruru plays every tile over MSE, about 1–2 seconds behind live. Whether WebCodecs works in WebKitGTK 2.50 is not yet verified.

## Choose a desktop

Ruru needs a graphical session. Use a small Wayland compositor rather than a full desktop, because the desktop costs CPU that Frigate and the tiles need. On a wall PC, GNOME's compositor alone uses about 29% of a core.

- **Kiosk (recommended):** `cage` runs Ruru as the only app, full screen. Nothing else is on screen. The Pi archive has cage 0.2.0.
- **Light desktop:** `labwc` is the compositor Raspberry Pi OS's own desktop uses. Use it if you also want a desktop on the Pi, with Ruru starting when you log in. The Pi archive has labwc 0.9.2.

## Set up the Pi

### 1. Connect a monitor

Connect the monitor to HDMI before you boot the Pi. Whether Ruru picks up a monitor connected later is not yet verified.

Use active cooling, such as the Raspberry Pi Active Cooler. Decoding video in software keeps the CPU busy, and a hot Pi slows itself down.

### 2. Install Ruru

The one-line installer picks the arm64 `.deb` on a Pi:

```sh
curl -fsSL https://raw.githubusercontent.com/kerwincarpede/ruru/main/install.sh | sh
```

Ruru also ships `_aarch64.AppImage` and `.aarch64.rpm` builds on the [releases page](https://github.com/kerwincarpede/ruru/releases/latest). The `.deb` installs WebKitGTK and what it needs.

Running Ruru under the 16 KB page kernel is not yet verified. If it fails to start, the Pi 5 can boot a 4 KB page kernel with `kernel=kernel8.img` in `/boot/firmware/config.txt`. Check that Frigate still works after that change.

### 3. Install video and graphics packages

GStreamer's software H.264 decoder is in `gstreamer1.0-libav`. Install it with the other GStreamer plugins, the Mesa drivers for the Pi's V3D graphics, and a font:

```sh
sudo apt update
sudo apt install gstreamer1.0-plugins-good gstreamer1.0-plugins-bad \
  gstreamer1.0-libav libgl1-mesa-dri fonts-dejavu-core
```

Some of these may already be installed with Ruru or Raspberry Pi OS. Whether this list is complete for a Pi that started without a desktop is not yet verified.

### 4. Install a compositor and start Ruru on boot

These steps are not yet verified.

**Kiosk with cage.** Install cage:

```sh
sudo apt install cage
```

Log the Pi's user in on the console automatically: run `sudo raspi-config` and choose **System Options → Boot / Auto Login → Console Autologin**. Then start cage from the login shell on the first console only, by adding this to the end of `~/.bash_profile` (or `~/.profile` if you have no `~/.bash_profile`):

```sh
if [ "$(tty)" = /dev/tty1 ]; then
  exec cage -- ruru
fi
```

Check the command name with `dpkg -L ruru | grep bin/`. You can also run cage from a systemd service instead of a login shell; the cage project's wiki describes one.

**Light desktop with labwc.** Install labwc and set the Pi to boot to the desktop:

```sh
sudo apt install labwc
sudo systemctl set-default graphical.target
```

Add `ruru &` to `~/.config/labwc/autostart` so Ruru starts when you log in. Raspberry Pi OS also needs a display manager to log you in to labwc; which one to use on a Pi that started without a desktop is not yet verified.

To go back to no desktop:

```sh
sudo systemctl set-default multi-user.target
```

### 5. Connect Ruru to Frigate

Frigate runs on the same Pi, so its address is `http://localhost:5000`, or the port you published Frigate's unauthenticated port on. Ruru does not support Frigate's login port, 8971.

Docker only lets Ruru reach port 5000 if Frigate's container publishes it. If only Ruru on the Pi needs it, publish it to the Pi alone, so the unauthenticated port stays off your network. In Docker Compose:

```yaml
ports:
  - "127.0.0.1:5000:5000"
```

Choose **Connect to Frigate** in Ruru, enter the address, choose **Test connection**, then **Save**.

## Keep Frigate healthy

Frigate's recording matters more than the wall. Watch the Pi after you add Ruru:

- **CPU:** check Frigate's **System** page for detection and recording falling behind, and `top` for overall use. If the Pi is short of CPU, use sub streams on every tile and hide tiles you don't need.
- **Temperature:** `vcgencmd measure_temp` prints the CPU temperature.
- **Throttling:** `vcgencmd get_throttled` prints `throttled=0x0` when the Pi has never slowed itself down since boot. Any other value means it has throttled or had too little power.

## What still needs checking

- CPU cost of each H.264 sub and main stream on a Pi 5, and how many tiles fit in about 2 cores.
- Ruru under the 16 KB page kernel.
- The package list in step 3 on a Pi that started without a desktop.
- Starting Ruru in cage from autologin on tty1, and from a systemd service.
- labwc with Ruru in autostart, and which display manager to use.
- Connecting the monitor after boot.
- H.265 playback over MSE with the Pi's hardware decoder.
- WebCodecs in WebKitGTK 2.50.
- Frigate's health over a long run with the wall on screen.
