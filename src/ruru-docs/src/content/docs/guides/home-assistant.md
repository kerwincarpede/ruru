---
title: Home Assistant
description: Show the wall in Home Assistant as a device, with its state and a problem sensor for each camera.
sidebar:
  order: 2
---

Ruru can connect to the MQTT broker that Home Assistant uses. Each computer running Ruru then shows up in Home Assistant as a device, found through [MQTT discovery](https://www.home-assistant.io/integrations/mqtt/#mqtt-discovery). Nothing is sent until you turn it on.

## Before you start

You need an MQTT broker that Home Assistant is connected to, such as the Mosquitto broker add-on, and a login for Ruru on it. With the add-on, a Home Assistant user works as the login.

## Connect

1. Open **Settings** and choose **Home Assistant**.
2. Turn on **Connect to Home Assistant**.
3. In **Broker**, enter the broker's address, such as `homeassistant.local`. Keep **Port** at 1883, or turn on **Use TLS** for 8883.
4. Enter the **Username** and **Password**.
5. Choose **Test connection**. Ruru says **Connected to the broker at homeassistant.local:1883.** when it works.
6. Choose **Save**.

Ruru keeps the password in your computer's keychain. When there is no keychain Ruru can use, such as on a Raspberry Pi without a desktop keyring, it keeps the password in `settings.json` and the page says so.

## What Home Assistant sees

The device is called **Ruru on** and the computer's name, such as **Ruru on kitchen-pi**. It has:

| Entity | What it shows |
| --- | --- |
| **Version** | The version of Ruru running. |
| **Maximised camera** | The camera filling the window, or `none`. |
| **Full screen** | On while Ruru is full screen. |
| **Window shown** | Off while the window is minimised or hidden. |
| A **problem** sensor for each camera, such as **Front door problem** | On when the camera's tile can't play its stream, or has been frozen or reconnecting for 30 seconds. |

Every entity shows as unavailable while Ruru is not connected, such as when the computer is off. Problem sensors follow the cameras on the wall: hiding a camera removes its sensor, and showing it adds the sensor back.

If the connection drops, Ruru connects again on its own, waiting a little longer after each failure, up to a minute.

## Topics

Ruru publishes under `ruru/<device id>/`, where the device id is made once for each computer and kept in `settings.json`:

| Topic | Payload |
| --- | --- |
| `ruru/<device id>/availability` | `online`, or `offline` when Ruru goes away. |
| `ruru/<device id>/state` | JSON with `version`, `maximised`, `full_screen` and `window_shown`. |
| `ruru/<device id>/problem/<camera>` | `ON` or `OFF`. |

Discovery configs are retained under `<discovery prefix>/<component>/<device id>/<object id>/config`. Change **Discovery prefix** only if you changed it in Home Assistant's MQTT settings.
